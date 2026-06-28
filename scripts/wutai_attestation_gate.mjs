#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { verifyPacketDirectory } from "./wutai_verify_packet.mjs";

const CONSUMER_ATTESTATION_NAME = "consumer-attestation.json";
const CONSUMER_ATTESTATION_CHECK_NAME = "consumer-attestation-check.json";

function usage() {
  return `Usage:
  wutai attest-packet [options] <packet-dir>
  npm run wutai:attest -- [options] <packet-dir>

Options:
  --attestation <path>         Consumer attestation JSON. Default: <packet-dir>/consumer-attestation.json.
  --disallow-reviewer <id>     Reviewer id that cannot satisfy the gate. Repeatable.
  --trusted-producers <path>   Trusted producer policy JSON for packet verification.
  --trust-policy <path>        Trust verdict policy JSON for packet verification.
  --trust-policy-profile <id>  Trust policy profile for packet verification. Default: personal-default.
  --write-artifacts            Write verifier artifacts and consumer-attestation-check.json into the packet directory.
  --help                       Show this message.

Exit codes:
  0 passed, 20 failed, 2 usage or packet-read error.`;
}

function parseArgs(argv) {
  const options = {
    attestation: null,
    disallowedReviewers: [],
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
    } else if (arg === "--attestation") {
      index += 1;
      if (!argv[index]) throw new Error("--attestation requires a value.");
      options.attestation = argv[index];
    } else if (arg === "--disallow-reviewer") {
      index += 1;
      if (!argv[index]) throw new Error("--disallow-reviewer requires a value.");
      options.disallowedReviewers.push(argv[index]);
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

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
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

function normalizeReviewerId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function addCheck(checks, status, name, message, evidence = undefined) {
  checks.push({
    name,
    status,
    message,
    ...(evidence ? { evidence } : {}),
  });
}

function decisionStatus(checks) {
  return checks.some((check) => check.status === "failed") ? "failed" : "passed";
}

export async function runConsumerAttestationGate(packetDir, options = {}) {
  const resolvedPacketDir = resolve(packetDir);
  const generatedAt = new Date().toISOString();
  const manifestPath = join(resolvedPacketDir, "manifest.json");
  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = parseJson(manifestContent, "manifest.json");
  const manifestSha256 = sha256Hex(manifestContent);
  const attestationPath = resolve(
    options.attestation ?? join(resolvedPacketDir, CONSUMER_ATTESTATION_NAME),
  );
  const attestationContent = await readFile(attestationPath, "utf8");
  const attestation = parseJson(attestationContent, basename(attestationPath));
  const { trustVerdict } = await verifyPacketDirectory(resolvedPacketDir, {
    trustedProducers: options.trustedProducers,
    trustPolicy: options.trustPolicy,
    trustPolicyProfile: options.trustPolicyProfile,
    writeArtifacts: options.writeArtifacts,
  });

  const checks = [];
  const subject = isRecord(attestation.subject) ? attestation.subject : {};
  const reviewer = isRecord(attestation.reviewer) ? attestation.reviewer : {};
  const reviewerId = normalizeReviewerId(reviewer.id);
  const disallowedReviewers = (options.disallowedReviewers ?? [])
    .flatMap((item) => String(item).split(","))
    .map(normalizeReviewerId)
    .filter(Boolean);

  addCheck(
    checks,
    trustVerdict.verdict === "blocked" ? "failed" : "passed",
    "packet_trust_verdict",
    trustVerdict.verdict === "blocked"
      ? "Consumer attestation cannot pass a packet that Wutai blocked."
      : "Packet trust verdict is not blocked.",
    `verdict=${trustVerdict.verdict}`,
  );

  addCheck(
    checks,
    attestation.kind === "wutai.consumer_attestation" ? "passed" : "failed",
    "attestation_kind",
    attestation.kind === "wutai.consumer_attestation"
      ? "Consumer attestation kind matches the v0.6 contract."
      : `Consumer attestation kind mismatch: ${String(attestation.kind ?? "missing")}.`,
  );
  addCheck(
    checks,
    attestation.decision === "ratified" ? "passed" : "failed",
    "consumer_decision",
    attestation.decision === "ratified"
      ? "Consumer reviewer ratified the packet."
      : `Consumer reviewer decision is not ratified: ${String(attestation.decision ?? "missing")}.`,
  );
  addCheck(
    checks,
    reviewerId ? "passed" : "failed",
    "reviewer_identity",
    reviewerId
      ? "Consumer reviewer id is present."
      : "Consumer attestation must include reviewer.id.",
    reviewerId ? `reviewer=${reviewerId}` : undefined,
  );
  addCheck(
    checks,
    reviewerId && !disallowedReviewers.includes(reviewerId) ? "passed" : "failed",
    "reviewer_not_self",
    reviewerId && !disallowedReviewers.includes(reviewerId)
      ? "Consumer reviewer is not in the disallowed self/author list."
      : "Consumer reviewer is missing or matches a disallowed self/author id.",
    disallowedReviewers.length
      ? `disallowed=${disallowedReviewers.join(",")}`
      : "disallowed=none",
  );
  addCheck(
    checks,
    subject.manifestSha256 === manifestSha256 ? "passed" : "failed",
    "subject_manifest_hash",
    subject.manifestSha256 === manifestSha256
      ? "Consumer attestation subject matches the selected manifest hash."
      : "Consumer attestation subject manifest hash does not match the selected packet.",
    `expected=${manifestSha256} actual=${String(subject.manifestSha256 ?? "missing")}`,
  );
  addCheck(
    checks,
    subject.packetId === manifest.packetId &&
      subject.taskId === manifest.taskId &&
      subject.producerAdapter === manifest.producer?.adapter
      ? "passed"
      : "failed",
    "subject_packet_identity",
    "Consumer attestation subject must bind packetId, taskId, and producerAdapter.",
    `packetId=${String(subject.packetId ?? "missing")} taskId=${String(subject.taskId ?? "missing")} producer=${String(subject.producerAdapter ?? "missing")}`,
  );
  addCheck(
    checks,
    typeof attestation.statement === "string" && attestation.statement.trim()
      ? "passed"
      : "failed",
    "review_statement",
    "Consumer attestation must include a non-empty human review statement.",
  );
  addCheck(
    checks,
    typeof attestation.reviewedAt === "string" && attestation.reviewedAt.trim()
      ? "passed"
      : "failed",
    "review_timestamp",
    "Consumer attestation must record reviewedAt.",
  );

  const status = decisionStatus(checks);
  const artifact = {
    schemaVersion: 1,
    kind: "wutai.consumer_attestation_check",
    taskId: manifest.taskId,
    generatedAt,
    status,
    summary:
      status === "passed"
        ? "Consumer attestation gate passed with a non-self ratification over this packet."
        : `Consumer attestation gate failed ${checks.filter((check) => check.status === "failed").length} check${checks.filter((check) => check.status === "failed").length === 1 ? "" : "s"}.`,
    packet: {
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      producerAdapter: manifest.producer?.adapter,
      manifestSha256,
      trustVerdict: trustVerdict.verdict,
    },
    reviewer: {
      id: reviewer.id,
      name: reviewer.name,
      role: reviewer.role,
      source: reviewer.source,
    },
    policy: {
      requiredDecision: "ratified",
      disallowedReviewers,
      blockedPacketAction: "fail",
    },
    checks,
    limitation:
      "This gate records a consumer ratification over packet artifacts. It does not prove reviewer identity, provide sandbox execution, or make the packet safe.",
  };

  if (options.writeArtifacts) {
    await writeFile(
      join(resolvedPacketDir, CONSUMER_ATTESTATION_CHECK_NAME),
      JSON.stringify(artifact, null, 2),
      "utf8",
    );
  }

  return {
    packetDir: resolvedPacketDir,
    attestationPath,
    artifact,
    trustVerdict,
  };
}

export async function runConsumerAttestationGateCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.packetDir) {
    console.error(usage());
    return 2;
  }

  const { artifact } = await runConsumerAttestationGate(options.packetDir, options);
  console.log(JSON.stringify(artifact, null, 2));
  return artifact.status === "passed" ? 0 : 20;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runConsumerAttestationGateCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
