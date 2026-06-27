#!/usr/bin/env node
import { createHash, verify as verifyData } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import {
  buildTrustVerdictArtifact,
  DEFAULT_TRUST_POLICY,
  normalizeTrustPolicy,
  TRUST_VERDICT_ARTIFACT_NAME,
} from "./trust_verdict.mjs";

const INTEGRITY_ARTIFACT_NAME = "integrity.json";
const PROVENANCE_ARTIFACT_NAME = "provenance.json";
const POLICY_REVIEW_ARTIFACT_NAME = "policy-review.json";
const ATTESTATION_ARTIFACT_NAME = "attestation.json";
const REQUIRED_CLI_PACKET_ARTIFACTS = [
  "report.md",
  "policy.json",
  "trace.json",
  "ledger.json",
  "audit.json",
];
const EMPTY_TRUSTED_PRODUCER_POLICY = {
  schemaVersion: 1,
  kind: "wutai.trusted_producer_policy",
  policyId: "local-empty",
  sourceLabel: "none",
  keys: [],
};

function usage() {
  return `Usage:
  wutai verify-packet [options] <packet-dir>
  npm run wutai:verify -- [options] <packet-dir>

Options:
  --trusted-producers <path>  Trusted producer policy JSON.
  --trust-policy <path>       Trust verdict policy JSON.
  --write-artifacts           Write integrity/provenance/policy-review/trust-verdict artifacts into the packet directory.
  --help                      Show this message.

Exit codes:
  0 trusted, 10 review_required, 20 blocked, 2 usage or packet-read error.`;
}

function parseArgs(argv) {
  const options = {
    trustedProducers: null,
    trustPolicy: null,
    writeArtifacts: false,
    help: false,
    packetDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--trusted-producers") {
      index += 1;
      if (!argv[index]) throw new Error("--trusted-producers requires a value.");
      options.trustedProducers = argv[index];
    } else if (arg === "--trust-policy") {
      index += 1;
      if (!argv[index]) throw new Error("--trust-policy requires a value.");
      options.trustPolicy = argv[index];
    } else if (arg === "--write-artifacts") {
      options.writeArtifacts = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.packetDir) {
      options.packetDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function byteLength(content) {
  return Buffer.byteLength(content, "utf8");
}

function safeJson(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseJson(content, name) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function parseTrustedProducerPolicy(content, sourceLabel = "local policy") {
  const root = parseJson(content, sourceLabel);
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("Trusted producer policy must be a JSON object.");
  }
  if (root.kind && root.kind !== "wutai.trusted_producer_policy") {
    throw new Error(`Unsupported trusted producer policy kind: ${String(root.kind)}.`);
  }
  if (!Array.isArray(root.keys)) {
    throw new Error("Trusted producer policy must define a keys array.");
  }
  return {
    schemaVersion: 1,
    kind: "wutai.trusted_producer_policy",
    policyId:
      typeof root.policyId === "string" && root.policyId.trim()
        ? root.policyId.trim()
        : "local-policy",
    sourceLabel,
    keys: root.keys.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`Trusted producer key ${index + 1} must be an object.`);
      }
      const publicKeySha256 =
        typeof item.publicKeySha256 === "string"
          ? item.publicKeySha256.trim().toLowerCase()
          : "";
      if (!/^[a-f0-9]{64}$/.test(publicKeySha256)) {
        throw new Error(
          `Trusted producer key ${index + 1} must provide a 64-character publicKeySha256.`,
        );
      }
      return {
        keyId:
          typeof item.keyId === "string" && item.keyId.trim()
            ? item.keyId.trim()
            : `key-${index + 1}`,
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : `key-${index + 1}`,
        publicKeySha256,
        producerAdapter:
          typeof item.producerAdapter === "string" && item.producerAdapter.trim()
            ? item.producerAdapter.trim()
            : undefined,
        allowedPacketTypes: normalizeStringList(item.allowedPacketTypes),
        status: item.status === "revoked" ? "revoked" : "active",
        note:
          typeof item.note === "string" && item.note.trim()
            ? item.note.trim()
            : undefined,
      };
    }),
  };
}

function evaluateTrustedProducerKey(policy, { publicKeySha256, producerAdapter, packetType }) {
  if (!policy || policy.keys.length === 0) {
    return {
      trusted: false,
      status: "not_provided",
      message: "No local trusted producer policy is loaded.",
    };
  }
  if (!publicKeySha256) {
    return {
      trusted: false,
      status: "unknown_key",
      message: "Attestation does not provide a public key hash to match.",
    };
  }

  const matchingKeys = policy.keys.filter(
    (key) => key.publicKeySha256 === publicKeySha256.toLowerCase(),
  );
  if (matchingKeys.length === 0) {
    return {
      trusted: false,
      status: "unknown_key",
      message:
        "The attestation key is not present in the local trusted producer policy.",
    };
  }
  const revoked = matchingKeys.find((key) => key.status === "revoked");
  if (revoked) {
    return {
      trusted: false,
      status: "revoked",
      key: revoked,
      message: "The attestation key is explicitly revoked by the local policy.",
    };
  }
  const producerMatches = matchingKeys.filter(
    (key) => !key.producerAdapter || key.producerAdapter === producerAdapter,
  );
  if (producerMatches.length === 0) {
    return {
      trusted: false,
      status: "producer_mismatch",
      key: matchingKeys[0],
      message:
        "The attestation key is known, but it is not trusted for this producer adapter.",
    };
  }
  const packetTypeMatched = producerMatches.find(
    (key) =>
      !key.allowedPacketTypes?.length ||
      (packetType && key.allowedPacketTypes.includes(packetType)),
  );
  if (!packetTypeMatched) {
    return {
      trusted: false,
      status: "packet_type_mismatch",
      key: producerMatches[0],
      message:
        "The attestation key is known, but it is not trusted for this packet type.",
    };
  }
  return {
    trusted: true,
    status: "trusted",
    key: packetTypeMatched,
    message: "The attestation key matches the local trusted producer policy.",
  };
}

function verifyAttestationSignature(attestation, manifestContent) {
  const signature = attestation.signature;
  if (signature?.algorithm !== "ECDSA_P256_SHA256") {
    return {
      verified: false,
      message: `Unsupported attestation signature algorithm: ${String(signature?.algorithm ?? "missing")}.`,
    };
  }
  if (!signature.publicKeyPem || !signature.signatureBase64) {
    return {
      verified: false,
      message: "Attestation signature is missing publicKeyPem or signatureBase64.",
    };
  }

  try {
    const verified = verifyData(
      "sha256",
      Buffer.from(manifestContent, "utf8"),
      { key: signature.publicKeyPem, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature.signatureBase64, "base64"),
    );
    return {
      verified,
      message: verified
        ? "Attestation signature verifies the selected manifest bytes."
        : "Attestation signature does not verify the selected manifest bytes.",
    };
  } catch (error) {
    return {
      verified: false,
      message: `Could not verify attestation signature: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function buildIntegrityArtifact(taskId, generatedAt, manifest, contentByName, importMode) {
  const checks = [];
  for (const manifestArtifact of manifest.artifacts ?? []) {
    const content = contentByName.get(manifestArtifact.name);
    if (!content) {
      checks.push({
        name: manifestArtifact.name,
        role: manifestArtifact.role,
        expectedSha256: manifestArtifact.sha256,
        expectedBytes: manifestArtifact.bytes,
        status: "missing",
        message: "Manifest lists this artifact, but it was not selected for import.",
      });
      continue;
    }
    if (!manifestArtifact.sha256) {
      checks.push({
        name: manifestArtifact.name,
        role: manifestArtifact.role,
        actualSha256: sha256Hex(content),
        expectedBytes: manifestArtifact.bytes,
        actualBytes: byteLength(content),
        status: "unverifiable",
        message: "Manifest does not provide a SHA-256 hash for this artifact.",
      });
      continue;
    }
    const actualSha256 = sha256Hex(content);
    const actualBytes = byteLength(content);
    const matches = actualSha256 === manifestArtifact.sha256;
    checks.push({
      name: manifestArtifact.name,
      role: manifestArtifact.role,
      expectedSha256: manifestArtifact.sha256,
      actualSha256,
      expectedBytes: manifestArtifact.bytes,
      actualBytes,
      status: matches ? "passed" : "mismatch",
      message: matches
        ? "Selected artifact matches the manifest SHA-256."
        : "Selected artifact does not match the manifest SHA-256.",
    });
  }

  const metrics = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    mismatched: checks.filter((check) => check.status === "mismatch").length,
    missing: checks.filter((check) => check.status === "missing").length,
    unverifiable: checks.filter((check) => check.status === "unverifiable").length,
  };
  const status =
    metrics.mismatched > 0 || metrics.missing > 0
      ? "failed"
      : metrics.unverifiable > 0 || metrics.total === 0
        ? "incomplete"
        : "passed";
  return {
    schemaVersion: 1,
    kind: "wutai.packet_integrity_check",
    taskId,
    generatedAt,
    importMode,
    status,
    summary:
      status === "passed"
        ? `Verified ${metrics.passed} artifact hashes from the manifest.`
        : status === "failed"
          ? `Manifest hash check found ${metrics.mismatched} mismatch and ${metrics.missing} missing artifact.`
          : "Manifest hash check could not verify every artifact.",
    metrics,
    checks,
    limitation:
      "This verifies selected artifact bytes against manifest hashes. It does not prove the manifest itself was signed or produced by a trusted runtime.",
  };
}

function buildProvenanceArtifact({
  taskId,
  generatedAt,
  manifest,
  manifestContent,
  contentByName,
  importMode,
  trustedProducerPolicy,
}) {
  const manifestSha256 = sha256Hex(manifestContent);
  const manifestBytes = byteLength(manifestContent);
  let attestation = {
    present: false,
    verified: false,
    trustedKey: false,
  };
  let trustPolicy = {
    provided: trustedProducerPolicy.keys.length > 0,
    policyId: trustedProducerPolicy.policyId,
    sourceLabel: trustedProducerPolicy.sourceLabel,
    keyCount: trustedProducerPolicy.keys.length,
    status: "not_evaluated",
    message: "No verified attestation was available for trusted-key evaluation.",
  };
  const checks = [
    {
      name: "manifest.json",
      status: "passed",
      message: "Selected manifest parsed as a Wutai CLI wrapper packet.",
      evidence: `kind=${manifest.kind ?? "unknown"} packetType=${manifest.packetType ?? "unknown"} producer=${manifest.producer?.adapter ?? "unknown"}`,
    },
    {
      name: "manifest_sha256",
      status: "passed",
      message: "Recorded the selected manifest byte hash for local provenance.",
      evidence: manifestSha256,
    },
  ];

  const missingRequired = REQUIRED_CLI_PACKET_ARTIFACTS.filter(
    (name) => !contentByName.has(name),
  );
  checks.push({
    name: "required_artifacts",
    status: missingRequired.length ? "failed" : "passed",
    message: missingRequired.length
      ? `Missing required CLI packet artifacts: ${missingRequired.join(", ")}.`
      : "All required CLI packet artifacts were selected.",
  });

  const manifestArtifactNames = new Set(
    manifest.artifacts?.map((artifact) => artifact.name) ?? [],
  );
  const missingFromManifest = REQUIRED_CLI_PACKET_ARTIFACTS.filter(
    (name) => !manifestArtifactNames.has(name),
  );
  checks.push({
    name: "manifest_inventory",
    status: missingFromManifest.length ? "warning" : "passed",
    message: missingFromManifest.length
      ? `Manifest artifact inventory omits: ${missingFromManifest.join(", ")}.`
      : "Manifest artifact inventory includes the required CLI packet artifacts.",
    evidence: `${manifestArtifactNames.size} manifest artifact entries`,
  });

  const expectedKinds = [
    ["policy.json", "wutai.cli_policy_preflight"],
    ["trace.json", "wutai.local_script_trace"],
    ["ledger.json", "wutai.session_ledger"],
    ["audit.json", "wutai.session_audit"],
  ];
  for (const [name, expectedKind] of expectedKinds) {
    const content = contentByName.get(name);
    if (!content) {
      checks.push({
        name,
        status: "failed",
        message: `${name} was not selected, so its schema kind could not be checked.`,
      });
      continue;
    }
    const parsed = safeJson(content);
    const actualKind = parsed?.kind;
    const artifactTaskId =
      name === "ledger.json" ? parsed?.task?.taskId : parsed?.taskId;
    checks.push({
      name,
      status:
        actualKind === expectedKind && (!artifactTaskId || artifactTaskId === taskId)
          ? "passed"
          : "failed",
      message:
        actualKind === expectedKind
          ? "Artifact schema kind matches the expected Wutai CLI packet contract."
          : `Artifact schema kind mismatch: expected ${expectedKind}, got ${String(actualKind ?? "missing")}.`,
      evidence: `kind=${String(actualKind ?? "missing")} taskId=${String(artifactTaskId ?? "missing")}`,
    });
  }

  const attestationContent = contentByName.get(ATTESTATION_ARTIFACT_NAME);
  if (!attestationContent) {
    checks.push({
      name: "trusted_signature",
      status: "warning",
      message: "No manifest signature or trusted producer attestation was selected.",
    });
  } else {
    attestation = {
      present: true,
      verified: false,
      trustedKey: false,
    };
    const parsed = safeJson(attestationContent);
    if (!parsed) {
      checks.push({
        name: ATTESTATION_ARTIFACT_NAME,
        status: "failed",
        message: "attestation.json is not a JSON object.",
      });
    } else {
      const publicKeyPem = parsed.signature?.publicKeyPem;
      const publicKeySha256 = publicKeyPem ? sha256Hex(publicKeyPem) : undefined;
      const claimedPublicKeySha256 = parsed.signature?.publicKeySha256;
      const kindMatches = parsed.kind === "wutai.packet_attestation";
      const subjectMatches =
        parsed.subject?.manifestSha256 === manifestSha256 &&
        parsed.subject?.manifestBytes === manifestBytes &&
        (!parsed.taskId || parsed.taskId === taskId);
      const publicKeyMatches =
        Boolean(publicKeyPem) &&
        Boolean(claimedPublicKeySha256) &&
        claimedPublicKeySha256 === publicKeySha256;
      attestation = {
        present: true,
        verified: false,
        trustedKey: false,
        algorithm: parsed.signature?.algorithm,
        publicKeySha256: claimedPublicKeySha256,
      };
      checks.push({
        name: ATTESTATION_ARTIFACT_NAME,
        status: kindMatches ? "passed" : "failed",
        message: kindMatches
          ? "Attestation schema kind matches the Wutai packet attestation contract."
          : `Attestation schema kind mismatch: expected wutai.packet_attestation, got ${String(parsed.kind ?? "missing")}.`,
        evidence: `kind=${String(parsed.kind ?? "missing")} taskId=${String(parsed.taskId ?? "missing")}`,
      });
      checks.push({
        name: "attestation_subject",
        status: subjectMatches ? "passed" : "failed",
        message: subjectMatches
          ? "Attestation subject matches the selected manifest hash, byte count, and task id."
          : "Attestation subject does not match the selected manifest hash, byte count, or task id.",
        evidence: `subjectManifestSha256=${String(parsed.subject?.manifestSha256 ?? "missing")} selectedManifestSha256=${manifestSha256}`,
      });
      checks.push({
        name: "attestation_public_key",
        status: publicKeyMatches ? "passed" : "failed",
        message: publicKeyMatches
          ? "Attestation public key hash matches the embedded public key."
          : "Attestation public key hash does not match the embedded public key.",
        evidence: `claimed=${String(claimedPublicKeySha256 ?? "missing")} actual=${String(publicKeySha256 ?? "missing")}`,
      });
      const signatureResult =
        kindMatches && subjectMatches && publicKeyMatches
          ? verifyAttestationSignature(parsed, manifestContent)
          : {
              verified: false,
              message:
                "Skipped signature verification because attestation schema, subject, or public key hash failed.",
            };
      attestation.verified = signatureResult.verified;
      checks.push({
        name: "attestation_signature",
        status: signatureResult.verified ? "passed" : "failed",
        message: signatureResult.message,
        evidence: `algorithm=${String(parsed.signature?.algorithm ?? "missing")}`,
      });
      if (signatureResult.verified) {
        const trustResult = evaluateTrustedProducerKey(trustedProducerPolicy, {
          publicKeySha256: claimedPublicKeySha256,
          producerAdapter: manifest.producer?.adapter,
          packetType: manifest.packetType,
        });
        attestation.trustedKey = trustResult.trusted;
        trustPolicy = {
          provided: trustedProducerPolicy.keys.length > 0,
          policyId: trustedProducerPolicy.policyId,
          sourceLabel: trustedProducerPolicy.sourceLabel,
          keyCount: trustedProducerPolicy.keys.length,
          status: trustResult.status,
          matchedKeyId: trustResult.key?.keyId,
          matchedLabel: trustResult.key?.label,
          message: trustResult.message,
        };
        checks.push({
          name: "trusted_key",
          status: trustResult.trusted
            ? "passed"
            : trustResult.status === "revoked"
              ? "failed"
              : "warning",
          message: trustResult.message,
          evidence: `publicKeySha256=${String(claimedPublicKeySha256 ?? "missing")}`,
        });
      }
    }
  }

  const metrics = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warnings: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  };
  const status =
    metrics.failed > 0 ? "failed" : metrics.warnings > 0 ? "warning" : "passed";
  return {
    schemaVersion: 1,
    kind: "wutai.packet_provenance_check",
    taskId,
    generatedAt,
    importMode,
    status,
    summary:
      status === "failed"
        ? `Packet provenance check found ${metrics.failed} failed check and ${metrics.warnings} warning.`
        : status === "passed" && attestation.verified && attestation.trustedKey
          ? "Packet attestation signature verified and trusted producer key matched."
          : status === "warning" && attestation.verified
            ? `Packet attestation signature verified with ${metrics.warnings} trust warning; producer identity is not trusted.`
            : status === "warning"
              ? `Packet provenance recorded with ${metrics.warnings} warning; the packet is not signed or trusted.`
              : "Packet provenance checks passed for the selected CLI wrapper packet.",
    manifest: {
      sha256: manifestSha256,
      bytes: manifestBytes,
      kind: manifest.kind,
      schemaVersion: manifest.schemaVersion,
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      taskId: manifest.taskId,
      sessionId: manifest.sessionId,
      generatedAt: manifest.generatedAt,
      producerName: manifest.producer?.name,
      producerAdapter: manifest.producer?.adapter,
      producerRuntime: manifest.producer?.runtime,
    },
    attestation,
    trustPolicy,
    metrics,
    checks,
    limitation:
      "This records selected packet provenance, schema consistency, and optional attestation signature validity. It does not prove the producer key is trusted, the signing key was protected, or the command ran in a sandbox.",
  };
}

function policyRules(policy) {
  return Array.isArray(policy.matchedRules)
    ? policy.matchedRules.filter(
        (rule) => Boolean(rule) && typeof rule === "object" && !Array.isArray(rule),
      )
    : [];
}

function policyDecisionAllows(decision) {
  return decision === "allow" || decision === "allow_with_override";
}

function ruleEffectiveAction(rule) {
  return optionalString(rule.effectiveAction) ?? optionalString(rule.ruleOverride?.effectiveAction);
}

function ruleDefaultAction(rule) {
  return optionalString(rule.defaultAction) ?? optionalString(rule.ruleOverride?.baseEffectiveAction);
}

function ruleReviewReason(rule) {
  const explicitReason = optionalString(rule.ruleOverride?.reason);
  if (explicitReason) return explicitReason;
  const defaultAction = ruleDefaultAction(rule);
  const effectiveAction = ruleEffectiveAction(rule);
  if (rule.profileEscalated === true && defaultAction && effectiveAction) {
    return `Policy profile escalated ${defaultAction} to ${effectiveAction}.`;
  }
  return undefined;
}

function buildPolicyReviewArtifact(taskId, generatedAt, contentByName) {
  const policyContent = contentByName.get("policy.json");
  const checks = [];
  const failedPolicyReview = (summary, message) => {
    checks.push({ name: "policy_json", status: "failed", message });
    return {
      schemaVersion: 1,
      kind: "wutai.cli_policy_override_review",
      taskId,
      generatedAt,
      status: "failed",
      summary,
      policy: { matchedRuleCount: 0 },
      explicitOverride: { requested: false, applied: false, appliedRuleIds: [] },
      ruleOverrides: [],
      metrics: {
        matchedRuleCount: 0,
        ruleOverrideCount: 0,
        missingOverrideReasonCount: 0,
        explicitOverrideWithoutReason: false,
        highRiskAllowCount: 0,
        warnings: 0,
        failed: 1,
      },
      checks,
      limitation:
        "This review interprets imported policy metadata only. It does not enforce execution, sandbox the command, or verify that the policy engine itself was tamper-resistant.",
    };
  };

  if (!policyContent) {
    return failedPolicyReview(
      "Policy override review failed because policy.json is missing.",
      "policy.json was not selected, so rule-level policy review could not run.",
    );
  }
  const parsed = safeJson(policyContent);
  if (!parsed) {
    return failedPolicyReview(
      "Policy override review failed because policy.json is invalid.",
      "policy.json is not a JSON object.",
    );
  }

  const kind = optionalString(parsed.kind);
  checks.push({
    name: "policy_schema",
    status: kind === "wutai.cli_policy_preflight" ? "passed" : "failed",
    message:
      kind === "wutai.cli_policy_preflight"
        ? "policy.json matches the Wutai CLI policy preflight contract."
        : `policy.json kind mismatch: expected wutai.cli_policy_preflight, got ${String(kind ?? "missing")}.`,
    evidence: `kind=${String(kind ?? "missing")}`,
  });
  const decision = optionalString(parsed.decision);
  const highestSeverity = optionalString(parsed.highestSeverity);
  const rules = policyRules(parsed);
  const matchedRuleCount =
    typeof parsed.riskProfile?.matchedRuleCount === "number"
      ? parsed.riskProfile.matchedRuleCount
      : rules.length;
  checks.push({
    name: "policy_decision",
    status: decision ? "passed" : "warning",
    message: decision
      ? `Policy decision recorded as ${decision}.`
      : "Policy decision is missing from policy.json.",
    evidence: `highestSeverity=${String(highestSeverity ?? "missing")}`,
  });

  const explicitOverride = {
    requested: parsed.override?.requested === true,
    applied: parsed.override?.applied === true,
    reason: optionalString(parsed.override?.reason),
    appliedRuleIds: stringList(parsed.override?.appliedRuleIds),
  };
  const explicitOverrideWithoutReason =
    explicitOverride.applied && !explicitOverride.reason;
  const ruleOverrides = rules
    .map((rule, index) => {
      const defaultAction = ruleDefaultAction(rule);
      const effectiveAction = ruleEffectiveAction(rule);
      const explicitRuleOverride = rule.ruleOverride?.applied === true;
      const profileEscalated = rule.profileEscalated === true;
      const actionChanged =
        Boolean(defaultAction) &&
        Boolean(effectiveAction) &&
        defaultAction !== effectiveAction;
      if (!explicitRuleOverride && !profileEscalated && !actionChanged) return null;
      return {
        ruleId: optionalString(rule.ruleId) ?? `rule_${index + 1}`,
        category: optionalString(rule.category),
        severity: optionalString(rule.severity),
        defaultAction,
        effectiveAction,
        overrideable:
          typeof rule.overrideable === "boolean" ? rule.overrideable : undefined,
        profileEscalated,
        source: explicitRuleOverride
          ? "explicit_rule_override"
          : profileEscalated
            ? "policy_profile"
            : "effective_action_change",
        reason: ruleReviewReason(rule),
        message: optionalString(rule.message),
        reviewScope: stringList(rule.reviewScope),
      };
    })
    .filter(Boolean);
  const missingOverrideReasonCount = rules.filter((rule) => {
    const explicitRuleOverride = rule.ruleOverride?.applied === true;
    const defaultAction = ruleDefaultAction(rule);
    const effectiveAction = ruleEffectiveAction(rule);
    const actionChanged =
      Boolean(defaultAction) &&
      Boolean(effectiveAction) &&
      defaultAction !== effectiveAction;
    return (
      (explicitRuleOverride || (actionChanged && rule.profileEscalated !== true)) &&
      !ruleReviewReason(rule)
    );
  }).length;
  const highRiskRuleAllowCount = rules.filter((rule) => {
    const severity = optionalString(rule.severity);
    const defaultAction = ruleDefaultAction(rule);
    const effectiveAction = ruleEffectiveAction(rule);
    return (
      severity === "high" &&
      (effectiveAction === "allow" ||
        (defaultAction === "deny" && effectiveAction === "allow"))
    );
  }).length;
  const highRiskAllowCount =
    highRiskRuleAllowCount +
    (highRiskRuleAllowCount === 0 &&
    highestSeverity === "high" &&
    policyDecisionAllows(decision)
      ? 1
      : 0);

  checks.push({
    name: "rule_action_changes",
    status: "passed",
    message: ruleOverrides.length
      ? `Recorded ${ruleOverrides.length} rule-level default/effective action change.`
      : "No rule-level overrides or effective action changes were recorded.",
    evidence: `matchedRules=${matchedRuleCount}`,
  });
  checks.push({
    name: "override_rationale",
    status:
      missingOverrideReasonCount > 0 || explicitOverrideWithoutReason
        ? "warning"
        : "passed",
    message:
      missingOverrideReasonCount > 0 || explicitOverrideWithoutReason
        ? "One or more policy overrides are missing rationale."
        : "Policy override rationale is present when required.",
    evidence: `missingRuleReasons=${missingOverrideReasonCount} explicitOverrideWithoutReason=${String(explicitOverrideWithoutReason)}`,
  });
  checks.push({
    name: "high_risk_allow",
    status: highRiskAllowCount > 0 ? "warning" : "passed",
    message:
      highRiskAllowCount > 0
        ? "High-risk policy outcome allowed execution after override."
        : "No high-risk allow outcome was recorded.",
    evidence: `highRiskAllowCount=${highRiskAllowCount}`,
  });
  const failed = checks.filter((check) => check.status === "failed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const status =
    failed > 0 ? "failed" : warnings > 0 ? "warning" : "passed";
  return {
    schemaVersion: 1,
    kind: "wutai.cli_policy_override_review",
    taskId,
    generatedAt,
    status,
    summary:
      status === "failed"
        ? "Policy override review failed because the imported policy contract is invalid."
        : status === "warning"
          ? `Policy override review found ${warnings} warning across ${ruleOverrides.length} rule-level action change.`
          : `Policy override review passed with ${ruleOverrides.length} rule-level action change recorded.`,
    policy: {
      decision,
      highestSeverity,
      profileId: optionalString(parsed.profile?.profileId),
      profileName: optionalString(parsed.profile?.name),
      matchedRuleCount,
    },
    explicitOverride,
    ruleOverrides,
    metrics: {
      matchedRuleCount,
      ruleOverrideCount: ruleOverrides.length,
      missingOverrideReasonCount,
      explicitOverrideWithoutReason,
      highRiskAllowCount,
      warnings,
      failed,
    },
    checks,
    limitation:
      "This review interprets imported policy metadata only. It does not enforce execution, sandbox the command, or verify that the policy engine itself was tamper-resistant.",
  };
}

async function readPacketDirectory(packetDir) {
  const entries = await readdir(packetDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const contentByName = new Map();
  for (const name of files) {
    contentByName.set(name, await readFile(join(packetDir, name), "utf8"));
  }
  return contentByName;
}

async function loadTrustedProducerPolicy(path) {
  if (!path) return EMPTY_TRUSTED_PRODUCER_POLICY;
  return parseTrustedProducerPolicy(
    await readFile(resolve(path), "utf8"),
    basename(path),
  );
}

async function loadTrustPolicy(path) {
  if (!path) return DEFAULT_TRUST_POLICY;
  return normalizeTrustPolicy(
    parseJson(await readFile(resolve(path), "utf8"), basename(path)),
    basename(path),
  );
}

export async function verifyPacketDirectory(packetDir, options = {}) {
  const resolvedPacketDir = resolve(packetDir);
  const contentByName = await readPacketDirectory(resolvedPacketDir);
  const manifestContent = contentByName.get("manifest.json");
  if (!manifestContent) {
    throw new Error("Packet directory must contain manifest.json.");
  }
  const manifest = parseJson(manifestContent, "manifest.json");
  if (
    manifest.kind !== "wutai.work_packet_manifest" ||
    manifest.packetType !== "local_script" ||
    manifest.producer?.adapter !== "wutaiRunCli"
  ) {
    throw new Error("This is not a Wutai CLI wrapper packet manifest.");
  }

  const taskId = manifest.taskId || `cli_verify_${Date.now().toString(36)}`;
  const generatedAt = new Date().toISOString();
  const trustedProducerPolicy = await loadTrustedProducerPolicy(
    options.trustedProducers,
  );
  const trustPolicy = await loadTrustPolicy(options.trustPolicy);
  const integrity = buildIntegrityArtifact(
    taskId,
    generatedAt,
    manifest,
    contentByName,
    "directory",
  );
  const provenance = buildProvenanceArtifact({
    taskId,
    generatedAt,
    manifest,
    manifestContent,
    contentByName,
    importMode: "directory",
    trustedProducerPolicy,
  });
  const policyReview = buildPolicyReviewArtifact(taskId, generatedAt, contentByName);
  const policyContent = contentByName.get("policy.json");
  const policy = policyContent ? safeJson(policyContent) : null;
  const trustVerdict = buildTrustVerdictArtifact({
    taskId,
    generatedAt,
    manifest,
    policy,
    integrity,
    provenance,
    policyReview,
    trustPolicy,
  });

  const artifacts = {
    [INTEGRITY_ARTIFACT_NAME]: integrity,
    [PROVENANCE_ARTIFACT_NAME]: provenance,
    [POLICY_REVIEW_ARTIFACT_NAME]: policyReview,
    [TRUST_VERDICT_ARTIFACT_NAME]: trustVerdict,
  };
  if (options.writeArtifacts) {
    await Promise.all(
      Object.entries(artifacts).map(([name, content]) =>
        writeFile(join(resolvedPacketDir, name), JSON.stringify(content, null, 2), "utf8"),
      ),
    );
  }

  return {
    packetDir: resolvedPacketDir,
    artifacts,
    trustVerdict,
  };
}

function exitCodeForVerdict(verdict) {
  if (verdict === "trusted") return 0;
  if (verdict === "review_required") return 10;
  return 20;
}

export async function runVerifyPacketCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.packetDir) {
    console.error(usage());
    return 2;
  }
  const { trustVerdict } = await verifyPacketDirectory(options.packetDir, options);
  console.log(JSON.stringify(trustVerdict, null, 2));
  return exitCodeForVerdict(trustVerdict.verdict);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVerifyPacketCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
