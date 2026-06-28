import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { createPacket, writePacket } from "../../sdk/node/index.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gatePath = join(repoRoot, "scripts", "wutai_attestation_gate.mjs");
const wutaiPath = join(repoRoot, "scripts", "wutai.mjs");

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function createSdkPacket(outputRoot, overrides = {}) {
  const packet = createPacket({
    taskId: overrides.taskId ?? `consumer_gate_${Date.now().toString(36)}`,
    argv: [process.execPath, "-e", "console.log('consumer gate packet')"],
    title: "Consumer gate packet test",
    userRequest: "Record a packet for consumer attestation gate testing.",
    workingDirectory: repoRoot,
    exitCode: 0,
    stdoutSummary: "consumer gate packet",
    stderrSummary: "No output captured.",
    producer: {
      name: "test external agent",
      adapter: "testExternalAgent",
      runtime: "node",
    },
    ...overrides,
  });
  return writePacket(packet, { outputDir: outputRoot });
}

async function packetSubject(packetDir) {
  const manifestContent = await readFile(join(packetDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestContent);
  return {
    manifest,
    manifestSha256: sha256Hex(manifestContent),
    subject: {
      manifestSha256: sha256Hex(manifestContent),
      packetId: manifest.packetId,
      taskId: manifest.taskId,
      producerAdapter: manifest.producer.adapter,
    },
  };
}

async function writeConsumerAttestation(packetDir, overrides = {}) {
  const { subject } = await packetSubject(packetDir);
  const {
    subject: subjectOverrides = {},
    reviewer: reviewerOverrides = {},
    ...topLevelOverrides
  } = overrides;
  const attestation = {
    schemaVersion: 1,
    kind: "wutai.consumer_attestation",
    subject: {
      ...subject,
      ...subjectOverrides,
    },
    reviewer: {
      id: "external-reviewer",
      name: "External Reviewer",
      role: "maintainer",
      source: "test",
      ...reviewerOverrides,
    },
    decision: "ratified",
    reviewedAt: "2026-06-28T00:00:00.000Z",
    statement: "Reviewed the packet artifacts and ratify this result.",
    ...topLevelOverrides,
  };
  await writeFile(
    join(packetDir, "consumer-attestation.json"),
    JSON.stringify(attestation, null, 2),
    "utf8",
  );
  return attestation;
}

function runGate(packetDir, args = [], entrypoint = gatePath) {
  const commandArgs =
    entrypoint === wutaiPath
      ? [entrypoint, "attest-packet", ...args, packetDir]
      : [entrypoint, ...args, packetDir];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"kind": "wutai.consumer_attestation_check"/);
  return { result, check: JSON.parse(result.stdout) };
}

function hasFailedCheck(check, name) {
  return check.checks.some((item) => item.name === name && item.status === "failed");
}

test("consumer attestation gate passes a ratified non-self review", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-consumer-pass-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "consumer_attestation_pass",
  });
  await writeConsumerAttestation(packetDir);

  const { result, check } = runGate(
    packetDir,
    ["--write-artifacts", "--disallow-reviewer", "haeliotang"],
    wutaiPath,
  );

  assert.equal(result.status, 0);
  assert.equal(check.status, "passed");
  assert.equal(check.packet.trustVerdict, "review_required");
  assert.equal(check.reviewer.id, "external-reviewer");
  assert.equal(
    (await readJson(join(packetDir, "consumer-attestation-check.json"))).status,
    "passed",
  );
});

test("consumer attestation gate fails when the reviewer is self-disallowed", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-consumer-self-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "consumer_attestation_self",
  });
  await writeConsumerAttestation(packetDir, {
    reviewer: { id: "haeliotang", source: "test" },
  });

  const { result, check } = runGate(packetDir, [
    "--disallow-reviewer",
    "haeliotang",
  ]);

  assert.equal(result.status, 20);
  assert.equal(check.status, "failed");
  assert.equal(hasFailedCheck(check, "reviewer_not_self"), true);
});

test("consumer attestation gate fails a stale manifest hash", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-consumer-stale-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "consumer_attestation_stale",
  });
  await writeConsumerAttestation(packetDir, {
    subject: { manifestSha256: "0".repeat(64) },
  });

  const { result, check } = runGate(packetDir, [
    "--disallow-reviewer",
    "haeliotang",
  ]);

  assert.equal(result.status, 20);
  assert.equal(check.status, "failed");
  assert.equal(hasFailedCheck(check, "subject_manifest_hash"), true);
});

test("consumer attestation gate fails a rejected consumer decision", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-consumer-rejected-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "consumer_attestation_rejected",
  });
  await writeConsumerAttestation(packetDir, {
    decision: "rejected",
  });

  const { result, check } = runGate(packetDir, [
    "--disallow-reviewer",
    "haeliotang",
  ]);

  assert.equal(result.status, 20);
  assert.equal(check.status, "failed");
  assert.equal(hasFailedCheck(check, "consumer_decision"), true);
});

test("consumer attestation gate fails a packet blocked by the verifier", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-consumer-blocked-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "consumer_attestation_blocked",
  });
  await writeConsumerAttestation(packetDir);
  await writeFile(join(packetDir, "trace.json"), "{\"tampered\":true}\n", "utf8");

  const { result, check } = runGate(packetDir, [
    "--disallow-reviewer",
    "haeliotang",
  ]);

  assert.equal(result.status, 20);
  assert.equal(check.status, "failed");
  assert.equal(check.packet.trustVerdict, "blocked");
  assert.equal(hasFailedCheck(check, "packet_trust_verdict"), true);
});
