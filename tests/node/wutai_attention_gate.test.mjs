import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapperPath = join(repoRoot, "scripts", "wutai_run.mjs");
const attentionPath = join(repoRoot, "scripts", "wutai_attention_gate.mjs");
const wutaiPath = join(repoRoot, "scripts", "wutai.mjs");
const exampleAttentionPolicy = join(
  repoRoot,
  "config",
  "wutai-attention-policy.example.json",
);

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function latestPacket(outputRoot) {
  const entries = await readdir(outputRoot);
  assert.equal(entries.length, 1);
  const packetDir = join(outputRoot, entries[0]);
  const manifest = await readJson(join(packetDir, "manifest.json"));
  const attestation = await readOptionalJson(join(packetDir, "attestation.json"));
  return { packetDir, manifest, attestation };
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function runWrapper(args, outputRoot) {
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      ...args,
      "--",
      process.execPath,
      "-e",
      "console.log('attention packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
}

async function createSignedPacket(outputRoot) {
  const keyRoot = await mkdtemp(join(tmpdir(), "wutai-attention-key-"));
  const signingKeyPath = join(keyRoot, "signing-key.pem");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await writeFile(
    signingKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "utf8",
  );
  runWrapper(["--signing-key", signingKeyPath], outputRoot);
  const packet = await latestPacket(outputRoot);
  const trustedProducersPath = await writeTrustedProducerPolicy(
    keyRoot,
    packet.attestation.signature.publicKeySha256,
  );
  return { ...packet, trustedProducersPath };
}

async function writeTrustedProducerPolicy(root, publicKeySha256) {
  const policyPath = join(root, "trusted-producers.json");
  await writeFile(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wutai.trusted_producer_policy",
        policyId: "test-attention-trusted-producers",
        keys: [
          {
            keyId: "test-attention-key",
            label: "Test attention key",
            publicKeySha256,
            producerAdapter: "wutaiRunCli",
            allowedPacketTypes: ["local_script"],
            status: "active",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return policyPath;
}

async function writeAttentionPolicy(root, body) {
  const policyPath = join(root, "attention-policy.json");
  await writeFile(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wutai.attention_policy",
        policyId: "test-attention-policy",
        ...body,
      },
      null,
      2,
    ),
    "utf8",
  );
  return policyPath;
}

async function writeConsumerAttestationCheck(packetDir, overrides = {}) {
  const manifestContent = await readFile(join(packetDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestContent);
  const check = {
    schemaVersion: 3,
    kind: "wutai.consumer_attestation_check",
    taskId: manifest.taskId,
    generatedAt: "2026-07-02T00:00:00.000Z",
    status: "passed",
    gateDecision: "accepted",
    attentionOutcome: "attention_null",
    causalCredit: "packet_changed_moat",
    wedgeOutcome: "wedge_null",
    moatOutcome: "scoped_ratified",
    moatSignal: "moat_win",
    experimentCell: "wedge_null_moat_win",
    packet: {
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      producerAdapter: manifest.producer.adapter,
      manifestSha256: sha256Hex(manifestContent),
      trustVerdict: "trusted",
    },
    reviewer: {
      id: "external-reviewer",
      role: "maintainer",
      source: "test",
    },
    ratification: {
      decision: "ratified",
      declaredScope: "I ratify only the manifest-bound packet artifacts.",
      excludedScope: "I do not ratify trace completeness or runtime sandboxing.",
      scopeReasons: [],
      wedgeSignals: [],
    },
    policy: {
      requiredDecision: "scoped_ratified",
      disallowedReviewers: [],
      blockedPacketAction: "fail",
    },
    checks: [],
    limitation: "Test fixture.",
    ...overrides,
  };
  await writeFile(
    join(packetDir, "consumer-attestation-check.json"),
    JSON.stringify(check, null, 2),
    "utf8",
  );
  return check;
}

function runAttention(packetDir, args = [], entrypoint = attentionPath) {
  const commandArgs =
    entrypoint === wutaiPath
      ? [entrypoint, "attention-decision", ...args, packetDir]
      : [entrypoint, ...args, packetDir];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"kind": "wutai.attention_decision"/);
  return { result, decision: JSON.parse(result.stdout) };
}

test("attention decision requires human attention for unsigned review-required packets", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-review-"));
  runWrapper([], outputRoot);
  const { packetDir } = await latestPacket(outputRoot);

  const { result, decision } = runAttention(packetDir, [], wutaiPath);

  assert.equal(result.status, 10);
  assert.equal(decision.decision, "human_attention_required");
  assert.equal(decision.attention.required, true);
  assert.equal(
    decision.attention.reasons.some((reason) => reason.id === "untrusted_producer"),
    true,
  );
  assert.equal(decision.accountability.humanReviewEvidence, "not_recorded");
});

test("attention decision auto accepts trusted packets under policy while recording no human review", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-auto-"));
  const { packetDir, trustedProducersPath } = await createSignedPacket(outputRoot);

  const { result, decision } = runAttention(
    packetDir,
    [
      "--write-artifacts",
      "--trusted-producers",
      trustedProducersPath,
      "--attention-policy",
      exampleAttentionPolicy,
    ],
  );

  assert.equal(result.status, 0);
  assert.equal(decision.decision, "auto_accepted_under_policy");
  assert.equal(decision.attention.required, false);
  assert.equal(
    decision.permissionBasis.every((basis) => basis.grantEligible === true),
    true,
  );
  assert.equal(
    decision.permissionBasis.some(
      (basis) => basis.evaluationMethod === "deterministic_external_check",
    ),
    true,
  );
  assert.equal(
    decision.riskSignals.every((signal) => signal.grantEligible === false),
    true,
  );
  assert.equal(
    decision.attention.reasons.some((reason) => reason.id === "no_human_review"),
    true,
  );
  assert.equal(decision.accountability.accountableSeatStatus, "assigned");
  assert.equal(
    (await readJson(join(packetDir, "attention-decision.json"))).decision,
    "auto_accepted_under_policy",
  );
});

test("model-backed external checks cannot grant auto acceptance", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-model-check-"));
  const policyRoot = await mkdtemp(join(tmpdir(), "wutai-attention-model-policy-"));
  runWrapper([], outputRoot);
  const { packetDir } = await latestPacket(outputRoot);
  const policyPath = await writeAttentionPolicy(policyRoot, {
    autoAcceptTrusted: true,
    externalChecks: [
      {
        checkId: "ai_review_passed",
        label: "AI review passed",
        status: "pass",
        determinism: "model_backed",
        source: "external-ai-reviewer",
      },
    ],
  });

  const { result, decision } = runAttention(packetDir, [
    "--attention-policy",
    policyPath,
  ]);

  assert.equal(result.status, 10);
  assert.equal(decision.decision, "human_attention_required");
  assert.equal(
    decision.permissionBasis.some((basis) => basis.basisId === "ai_review_passed"),
    false,
  );
  assert.equal(
    decision.riskSignals.some(
      (signal) =>
        signal.signalId === "ai_review_passed" &&
        signal.evaluationMethod === "model_backed_external_check" &&
        signal.grantEligible === false,
    ),
    true,
  );
});

test("model-backed external checks require attention even for trusted packets", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-trusted-model-"));
  const policyRoot = await mkdtemp(join(tmpdir(), "wutai-attention-trusted-policy-"));
  const { packetDir, trustedProducersPath } = await createSignedPacket(outputRoot);
  const policyPath = await writeAttentionPolicy(policyRoot, {
    autoAcceptTrusted: true,
    externalChecks: [
      {
        checkId: "ai_review_passed",
        label: "AI review passed",
        status: "pass",
        determinism: "model_backed",
        source: "external-ai-reviewer",
      },
    ],
  });

  const { result, decision } = runAttention(packetDir, [
    "--trusted-producers",
    trustedProducersPath,
    "--attention-policy",
    policyPath,
  ]);

  assert.equal(result.status, 10);
  assert.equal(decision.decision, "human_attention_required");
  assert.equal(
    decision.permissionBasis.some((basis) => basis.grantEligible === true),
    true,
  );
  assert.equal(
    decision.attention.reasons.some(
      (reason) => reason.id === "model_backed_external_check",
    ),
    true,
  );
});

test("attention decision accepts scoped ratification when a current check is present", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-ratified-"));
  const { packetDir, trustedProducersPath } = await createSignedPacket(outputRoot);
  await writeConsumerAttestationCheck(packetDir);

  const { result, decision } = runAttention(packetDir, [
    "--trusted-producers",
    trustedProducersPath,
  ]);

  assert.equal(result.status, 0);
  assert.equal(decision.decision, "scoped_ratified");
  assert.equal(decision.accountability.humanReviewEvidence, "scoped_ratification");
  assert.equal(decision.accountability.scopedRatification.accepted, true);
  assert.equal(decision.accountability.scopedRatification.reviewer.id, "external-reviewer");
});

test("attention decision blocks tampered packets", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-blocked-"));
  runWrapper([], outputRoot);
  const { packetDir } = await latestPacket(outputRoot);
  await writeFile(join(packetDir, "trace.json"), "{\"tampered\":true}\n", "utf8");

  const { result, decision } = runAttention(packetDir);

  assert.equal(result.status, 20);
  assert.equal(decision.decision, "blocked_or_unowned");
  assert.equal(
    decision.attention.reasons.some((reason) => reason.id === "packet_blocked"),
    true,
  );
});

test("attention decision blocks trusted auto acceptance when policy requires a missing seat", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-attention-no-seat-"));
  const policyRoot = await mkdtemp(join(tmpdir(), "wutai-attention-policy-"));
  const { packetDir, trustedProducersPath } = await createSignedPacket(outputRoot);
  const policyPath = await writeAttentionPolicy(policyRoot, {
    autoAcceptTrusted: true,
    requireAccountableSeatForAutoAccept: true,
    accountableSeats: [],
  });

  const { result, decision } = runAttention(packetDir, [
    "--trusted-producers",
    trustedProducersPath,
    "--attention-policy",
    policyPath,
  ]);

  assert.equal(result.status, 20);
  assert.equal(decision.decision, "blocked_or_unowned");
  assert.equal(decision.accountability.accountableSeatStatus, "missing");
  assert.equal(
    decision.attention.reasons.some(
      (reason) => reason.id === "accountable_seat_missing",
    ),
    true,
  );
});
