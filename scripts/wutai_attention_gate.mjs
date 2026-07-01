#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { verifyPacketDirectory } from "./wutai_verify_packet.mjs";

const ATTENTION_DECISION_NAME = "attention-decision.json";
const CONSUMER_ATTESTATION_CHECK_NAME = "consumer-attestation-check.json";

const DEFAULT_ATTENTION_POLICY = {
  schemaVersion: 1,
  kind: "wutai.attention_policy",
  policyId: "wutai-default-attention-policy-v0.9",
  sourceLabel: "built-in default",
  autoAcceptTrusted: true,
  requireAccountableSeatForAutoAccept: false,
  accountableSeats: [],
  reasonSeats: {
    no_human_review: "maintainer",
    trust_verdict_review_required: "maintainer",
    untrusted_producer: "maintainer",
    policy_warning: "maintainer",
    high_risk_allow: "security_reviewer",
    reviewer_required: "maintainer",
    scoped_ratification_missing: "maintainer",
    accountable_seat_missing: "owner",
    packet_blocked: "owner",
  },
};

function usage() {
  return `Usage:
  wutai attention-decision [options] <packet-dir>
  npm run wutai:attention -- [options] <packet-dir>

Options:
  --attention-policy <path>          Attention policy JSON. Default: built-in v0.9 policy.
  --consumer-attestation-check <path> Scoped ratification check JSON. Default: <packet-dir>/consumer-attestation-check.json when present.
  --trusted-producers <path>         Trusted producer policy JSON for packet verification.
  --trust-policy <path>              Trust verdict policy JSON for packet verification.
  --trust-policy-profile <id>        Trust policy profile for packet verification. Default: personal-default.
  --write-artifacts                  Write verifier artifacts and attention-decision.json into the packet directory.
  --help                             Show this message.

Exit codes:
  0 auto accepted or scoped ratified, 10 human attention required, 20 blocked or unowned, 2 usage or packet-read error.`;
}

function parseArgs(argv) {
  const options = {
    attentionPolicy: null,
    consumerAttestationCheck: null,
    trustedProducers: null,
    trustPolicy: null,
    trustPolicyProfile: null,
    writeArtifacts: false,
    help: false,
    packetDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--attention-policy") {
      index += 1;
      if (!argv[index]) throw new Error("--attention-policy requires a value.");
      options.attentionPolicy = argv[index];
    } else if (arg === "--consumer-attestation-check") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--consumer-attestation-check requires a value.");
      }
      options.consumerAttestationCheck = argv[index];
    } else if (arg === "--trusted-producers") {
      index += 1;
      if (!argv[index]) throw new Error("--trusted-producers requires a value.");
      options.trustedProducers = argv[index];
    } else if (arg === "--trust-policy") {
      index += 1;
      if (!argv[index]) throw new Error("--trust-policy requires a value.");
      options.trustPolicy = argv[index];
    } else if (arg === "--trust-policy-profile") {
      index += 1;
      if (!argv[index]) throw new Error("--trust-policy-profile requires a value.");
      options.trustPolicyProfile = argv[index];
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

function parseJson(content, name) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePolicy(raw, sourceLabel) {
  if (!raw) return DEFAULT_ATTENTION_POLICY;
  if (!isRecord(raw)) throw new Error("Attention policy must be a JSON object.");
  if (raw.kind && raw.kind !== "wutai.attention_policy") {
    throw new Error(`Unsupported attention policy kind: ${String(raw.kind)}.`);
  }
  return {
    ...DEFAULT_ATTENTION_POLICY,
    schemaVersion: 1,
    kind: "wutai.attention_policy",
    policyId:
      typeof raw.policyId === "string" && raw.policyId.trim()
        ? raw.policyId.trim()
        : DEFAULT_ATTENTION_POLICY.policyId,
    sourceLabel,
    autoAcceptTrusted:
      typeof raw.autoAcceptTrusted === "boolean"
        ? raw.autoAcceptTrusted
        : DEFAULT_ATTENTION_POLICY.autoAcceptTrusted,
    requireAccountableSeatForAutoAccept:
      typeof raw.requireAccountableSeatForAutoAccept === "boolean"
        ? raw.requireAccountableSeatForAutoAccept
        : DEFAULT_ATTENTION_POLICY.requireAccountableSeatForAutoAccept,
    accountableSeats: Array.isArray(raw.accountableSeats)
      ? raw.accountableSeats.filter(isRecord)
      : [],
    reasonSeats: {
      ...DEFAULT_ATTENTION_POLICY.reasonSeats,
      ...(isRecord(raw.reasonSeats) ? raw.reasonSeats : {}),
    },
  };
}

async function loadAttentionPolicy(path) {
  if (!path) return DEFAULT_ATTENTION_POLICY;
  return normalizePolicy(
    parseJson(await readFile(resolve(path), "utf8"), basename(path)),
    basename(path),
  );
}

async function readOptionalJson(path) {
  try {
    return parseJson(await readFile(path, "utf8"), basename(path));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function packetFromVerification(artifacts, trustVerdict) {
  const manifest =
    artifacts["provenance.json"]?.manifest ?? artifacts.provenance?.manifest ?? {};
  return {
    packetId: manifest.packetId ?? null,
    packetType: manifest.packetType ?? trustVerdict.inputs?.packetType ?? null,
    taskId: manifest.taskId ?? trustVerdict.taskId,
    producerAdapter:
      manifest.producerAdapter ?? trustVerdict.inputs?.producerAdapter ?? null,
    manifestSha256: manifest.sha256 ?? null,
    trustVerdict: trustVerdict.verdict,
  };
}

function checkStatus(trustVerdict, name) {
  return trustVerdict.checks?.find((check) => check.name === name)?.status;
}

function seatFor(policy, reasonId) {
  const seat = policy.reasonSeats?.[reasonId];
  return typeof seat === "string" && seat.trim() ? seat.trim() : "maintainer";
}

function addReason(reasons, policy, id, severity, message, evidence = undefined) {
  reasons.push({
    id,
    severity,
    requiredSeat: seatFor(policy, id),
    message,
    ...(evidence ? { evidence } : {}),
  });
}

function matchesSeatRule(rule, packet) {
  const match = isRecord(rule.match) ? rule.match : {};
  return (
    (!match.packetType || match.packetType === packet.packetType) &&
    (!match.producerAdapter || match.producerAdapter === packet.producerAdapter)
  );
}

function findAccountableSeat(policy, packet) {
  const rule = policy.accountableSeats.find((item) => matchesSeatRule(item, packet));
  if (!rule) return null;
  return {
    id: typeof rule.id === "string" ? rule.id : null,
    role: typeof rule.role === "string" ? rule.role : null,
    source: typeof rule.source === "string" ? rule.source : "attention_policy",
    reason: typeof rule.reason === "string" ? rule.reason : null,
  };
}

function scopedRatificationFromCheck(check, packet) {
  if (!isRecord(check)) {
    return {
      status: "not_recorded",
      accepted: false,
      stale: false,
    };
  }
  const checkPacket = isRecord(check.packet) ? check.packet : {};
  const stale =
    check.kind !== "wutai.consumer_attestation_check" ||
    checkPacket.packetId !== packet.packetId ||
    checkPacket.manifestSha256 !== packet.manifestSha256;
  const accepted =
    !stale &&
    check.gateDecision === "accepted" &&
    check.moatOutcome === "scoped_ratified";
  return {
    status: stale ? "stale" : accepted ? "accepted" : "not_accepted",
    accepted,
    stale,
    path: check.__path ?? null,
    gateDecision: check.gateDecision ?? null,
    moatOutcome: check.moatOutcome ?? null,
    attentionOutcome: check.attentionOutcome ?? null,
    causalCredit: check.causalCredit ?? null,
    reviewer: isRecord(check.reviewer) ? check.reviewer : null,
    declaredScope: check.ratification?.declaredScope ?? null,
    excludedScope: check.ratification?.excludedScope ?? null,
  };
}

function buildReasons({ trustVerdict, policy, packet, scopedRatification, accountableSeat }) {
  const reasons = [];

  if (trustVerdict.verdict === "blocked") {
    addReason(
      reasons,
      policy,
      "packet_blocked",
      "blocker",
      "Packet trust verdict is blocked.",
      `blocked=${trustVerdict.metrics?.blocked ?? 0}`,
    );
    return reasons;
  }

  if (trustVerdict.verdict === "review_required") {
    addReason(
      reasons,
      policy,
      "trust_verdict_review_required",
      "review",
      "Packet trust verdict requires review.",
      `reviewRequired=${trustVerdict.metrics?.reviewRequired ?? 0}`,
    );
  }

  if (checkStatus(trustVerdict, "trusted_producer_required") === "review_required") {
    addReason(
      reasons,
      policy,
      "untrusted_producer",
      "review",
      "Producer is not trusted by the selected local producer policy.",
      `producer=${String(packet.producerAdapter ?? "missing")}`,
    );
  }

  if (checkStatus(trustVerdict, "policy_override_review") === "review_required") {
    addReason(
      reasons,
      policy,
      "policy_warning",
      "review",
      "Policy review reported warnings or overrides.",
    );
  }

  if (checkStatus(trustVerdict, "high_risk_allow") === "review_required") {
    addReason(
      reasons,
      policy,
      "high_risk_allow",
      "review",
      "High-risk action was allowed and requires attention.",
    );
  }

  if (checkStatus(trustVerdict, "rule_reviewer_required") === "review_required") {
    addReason(
      reasons,
      policy,
      "reviewer_required",
      "review",
      "Trust policy requires a human reviewer for a matched rule.",
    );
  }

  if (!scopedRatification.accepted) {
    addReason(
      reasons,
      policy,
      "no_human_review",
      "audit",
      "No current scoped human ratification evidence is accepted for this packet.",
      `status=${scopedRatification.status}`,
    );
  }

  if (policy.requireAccountableSeatForAutoAccept && !accountableSeat) {
    addReason(
      reasons,
      policy,
      "accountable_seat_missing",
      "blocker",
      "Attention policy requires an accountable seat before auto acceptance.",
    );
  }

  return reasons;
}

function decisionFor({ trustVerdict, policy, scopedRatification, reasons, accountableSeat }) {
  if (trustVerdict.verdict === "blocked") return "blocked_or_unowned";
  if (reasons.some((reason) => reason.id === "accountable_seat_missing")) {
    return "blocked_or_unowned";
  }
  if (scopedRatification.accepted) return "scoped_ratified";
  if (trustVerdict.verdict === "trusted" && policy.autoAcceptTrusted) {
    if (!policy.requireAccountableSeatForAutoAccept || accountableSeat) {
      return "auto_accepted_under_policy";
    }
  }
  return "human_attention_required";
}

function summaryFor(decision, reasons) {
  if (decision === "scoped_ratified") {
    return "Attention decision: accepted through scoped human ratification.";
  }
  if (decision === "auto_accepted_under_policy") {
    return "Attention decision: auto accepted under policy; no accepted scoped human review is recorded.";
  }
  if (decision === "blocked_or_unowned") {
    return `Attention decision: blocked or unowned due to ${reasons
      .filter((reason) => reason.severity === "blocker")
      .map((reason) => reason.id)
      .join(", ")}.`;
  }
  return `Attention decision: human attention required for ${reasons
    .filter((reason) => reason.severity !== "audit")
    .map((reason) => reason.id)
    .join(", ") || "policy review"}.`;
}

function exitCodeForDecision(decision) {
  if (decision === "auto_accepted_under_policy" || decision === "scoped_ratified") {
    return 0;
  }
  if (decision === "human_attention_required") return 10;
  return 20;
}

export async function runAttentionDecisionGate(packetDir, options = {}) {
  const resolvedPacketDir = resolve(packetDir);
  const generatedAt = new Date().toISOString();
  const attentionPolicy = await loadAttentionPolicy(options.attentionPolicy);
  const { artifacts, trustVerdict } = await verifyPacketDirectory(resolvedPacketDir, {
    trustedProducers: options.trustedProducers,
    trustPolicy: options.trustPolicy,
    trustPolicyProfile: options.trustPolicyProfile,
    writeArtifacts: options.writeArtifacts,
  });
  const packet = packetFromVerification(artifacts, trustVerdict);
  const checkPath = options.consumerAttestationCheck
    ? resolve(options.consumerAttestationCheck)
    : join(resolvedPacketDir, CONSUMER_ATTESTATION_CHECK_NAME);
  const rawCheck = await readOptionalJson(checkPath);
  const check = rawCheck ? { ...rawCheck, __path: basename(checkPath) } : null;
  const scopedRatification = scopedRatificationFromCheck(check, packet);
  const accountableSeat = findAccountableSeat(attentionPolicy, packet);
  const reasons = buildReasons({
    trustVerdict,
    policy: attentionPolicy,
    packet,
    scopedRatification,
    accountableSeat,
  });
  const decision = decisionFor({
    trustVerdict,
    policy: attentionPolicy,
    scopedRatification,
    reasons,
    accountableSeat,
  });
  const artifact = {
    schemaVersion: 1,
    kind: "wutai.attention_decision",
    taskId: trustVerdict.taskId,
    generatedAt,
    decision,
    summary: summaryFor(decision, reasons),
    packet,
    attention: {
      required: decision === "human_attention_required",
      reasons,
    },
    accountability: {
      accountableSeatStatus: accountableSeat ? "assigned" : "missing",
      accountableSeat,
      scopedRatification,
      humanReviewEvidence: scopedRatification.accepted
        ? "scoped_ratification"
        : "not_recorded",
    },
    policy: {
      policyId: attentionPolicy.policyId,
      sourceLabel: attentionPolicy.sourceLabel,
      autoAcceptTrusted: attentionPolicy.autoAcceptTrusted,
      requireAccountableSeatForAutoAccept:
        attentionPolicy.requireAccountableSeatForAutoAccept,
    },
    inputs: {
      trustVerdict: trustVerdict.verdict,
      trustVerdictPolicyId: trustVerdict.policy?.policyId,
      consumerAttestationCheckPath: rawCheck ? basename(checkPath) : null,
      trustChecks: trustVerdict.checks?.map((checkItem) => ({
        name: checkItem.name,
        status: checkItem.status,
        ruleId: checkItem.ruleId,
      })),
    },
    limitation:
      "This decision routes attention over packet artifacts and local policy. It does not prove silent human review, reviewer identity, trace completeness, or runtime sandboxing.",
  };

  if (options.writeArtifacts) {
    await writeFile(
      join(resolvedPacketDir, ATTENTION_DECISION_NAME),
      JSON.stringify(artifact, null, 2),
      "utf8",
    );
  }

  return {
    packetDir: resolvedPacketDir,
    artifact,
    trustVerdict,
  };
}

export async function runAttentionDecisionGateCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.packetDir) {
    console.error(usage());
    return 2;
  }

  const { artifact } = await runAttentionDecisionGate(options.packetDir, options);
  console.log(JSON.stringify(artifact, null, 2));
  return exitCodeForDecision(artifact.decision);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAttentionDecisionGateCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
