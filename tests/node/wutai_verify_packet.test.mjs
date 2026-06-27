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
const verifierPath = join(repoRoot, "scripts", "wutai_verify_packet.mjs");
const wutaiPath = join(repoRoot, "scripts", "wutai.mjs");

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function latestPacket(outputRoot) {
  const entries = await readdir(outputRoot);
  assert.equal(entries.length, 1);
  const packetDir = join(outputRoot, entries[0]);
  const manifest = JSON.parse(await readFile(join(packetDir, "manifest.json"), "utf8"));
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

function verifyPacket(packetDir, args = [], entrypoint = verifierPath) {
  const commandArgs =
    entrypoint === wutaiPath
      ? [entrypoint, "verify-packet", ...args, packetDir]
      : [entrypoint, ...args, packetDir];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"kind": "wutai.trust_verdict"/);
  return { result, verdict: JSON.parse(result.stdout) };
}

async function writeTrustedProducerPolicy(root, publicKeySha256, status = "active") {
  const policyPath = join(root, `trusted-${status}.json`);
  await writeFile(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wutai.trusted_producer_policy",
        policyId: `test-${status}-trusted-producers`,
        keys: [
          {
            keyId: `test-${status}-key`,
            label: `Test ${status} key`,
            publicKeySha256,
            producerAdapter: "wutaiRunCli",
            allowedPacketTypes: ["local_script"],
            status,
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

async function writeTrustPolicy(root, body) {
  const policyPath = join(root, "trust-policy.json");
  await writeFile(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wutai.trust_policy",
        policyId: "test-trust-policy",
        ...body,
      },
      null,
      2,
    ),
    "utf8",
  );
  return policyPath;
}

async function updateManifestArtifactHash(packetDir, name) {
  const manifestPath = join(packetDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const content = await readFile(join(packetDir, name), "utf8");
  manifest.artifacts = manifest.artifacts.map((artifact) =>
    artifact.name === name
      ? {
          ...artifact,
          bytes: Buffer.byteLength(content, "utf8"),
          sha256: sha256Hex(content),
        }
      : artifact,
  );
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

test("wutai verify-packet trusts a signed packet with a matching local producer policy", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-trusted-"));
  const keyRoot = await mkdtemp(join(tmpdir(), "wutai-verify-key-"));
  const signingKeyPath = join(keyRoot, "signing-key.pem");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await writeFile(
    signingKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "utf8",
  );
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--signing-key",
      signingKeyPath,
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('trusted packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir, attestation } = await latestPacket(outputRoot);
  const trustedProducersPath = await writeTrustedProducerPolicy(
    keyRoot,
    attestation.signature.publicKeySha256,
  );
  const { result, verdict } = verifyPacket(packetDir, [
    "--trusted-producers",
    trustedProducersPath,
  ]);

  assert.equal(result.status, 0);
  assert.equal(verdict.verdict, "trusted");
  assert.equal(verdict.metrics.blocked, 0);
  assert.equal(verdict.metrics.reviewRequired, 0);
  assert.equal(verdict.inputs.trustedProducer, true);
});

test("wutai verify-packet requires review for unsigned packets", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-unsigned-"));
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('unsigned packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir } = await latestPacket(outputRoot);
  const { result, verdict } = verifyPacket(packetDir, [], wutaiPath);

  assert.equal(result.status, 10);
  assert.equal(verdict.verdict, "review_required");
  assert.equal(
    verdict.checks.some((check) => check.name === "trusted_producer_required"),
    true,
  );
});

test("wutai verify-packet blocks revoked producer keys", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-revoked-"));
  const keyRoot = await mkdtemp(join(tmpdir(), "wutai-verify-revoked-key-"));
  const signingKeyPath = join(keyRoot, "signing-key.pem");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await writeFile(
    signingKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "utf8",
  );
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--signing-key",
      signingKeyPath,
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('revoked packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir, attestation } = await latestPacket(outputRoot);
  const trustedProducersPath = await writeTrustedProducerPolicy(
    keyRoot,
    attestation.signature.publicKeySha256,
    "revoked",
  );
  const { result, verdict } = verifyPacket(packetDir, [
    "--trusted-producers",
    trustedProducersPath,
  ]);

  assert.equal(result.status, 20);
  assert.equal(verdict.verdict, "blocked");
  assert.equal(verdict.inputs.provenanceStatus, "failed");
  assert.equal(
    verdict.checks.some((check) => check.name === "packet_provenance"),
    true,
  );
});

test("wutai verify-packet blocks tampered artifact bytes", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-tamper-"));
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('tamper packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir } = await latestPacket(outputRoot);
  await writeFile(join(packetDir, "trace.json"), '{"tampered":true}\n', "utf8");
  const { result, verdict } = verifyPacket(packetDir);

  assert.equal(result.status, 20);
  assert.equal(verdict.verdict, "blocked");
  assert.equal(verdict.inputs.integrityStatus, "failed");
});

test("wutai verify-packet requires review for high-risk overrides without rationale", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-missing-reason-"));
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--allow-high-risk",
      "--output-dir",
      outputRoot,
      "--",
      "sh",
      "-c",
      "printf missing_reason",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir } = await latestPacket(outputRoot);
  const { result, verdict } = verifyPacket(packetDir);

  assert.equal(result.status, 10);
  assert.equal(verdict.verdict, "review_required");
  assert.equal(
    verdict.checks.some((check) => check.name === "override_rationale"),
    true,
  );
  assert.equal(
    verdict.checks.some((check) => check.name === "high_risk_allow"),
    true,
  );
});

test("wutai verify-packet blocks invalid policy schema even when hashes match", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-invalid-policy-"));
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('invalid policy packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir } = await latestPacket(outputRoot);
  const policy = JSON.parse(await readFile(join(packetDir, "policy.json"), "utf8"));
  policy.kind = "wutai.invalid_policy";
  await writeFile(join(packetDir, "policy.json"), JSON.stringify(policy, null, 2), "utf8");
  await updateManifestArtifactHash(packetDir, "policy.json");
  const { result, verdict } = verifyPacket(packetDir);

  assert.equal(result.status, 20);
  assert.equal(verdict.verdict, "blocked");
  assert.equal(verdict.inputs.integrityStatus, "passed");
  assert.equal(verdict.inputs.policyReviewStatus, "failed");
});

test("wutai verify-packet applies external rule-level trust policy", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-rule-policy-"));
  const policyRoot = await mkdtemp(join(tmpdir(), "wutai-verify-rule-policy-config-"));
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--dry-run",
      "--output-dir",
      outputRoot,
      "--",
      "npm",
      "install",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir } = await latestPacket(outputRoot);
  const trustPolicyPath = await writeTrustPolicy(policyRoot, {
    rulePolicies: {
      dependency_install_or_update: {
        action: "block",
        note: "Block dependency mutation at the local trust gate.",
      },
    },
  });
  const { result, verdict } = verifyPacket(packetDir, [
    "--trust-policy",
    trustPolicyPath,
  ]);

  assert.equal(result.status, 20);
  assert.equal(verdict.verdict, "blocked");
  assert.equal(verdict.policy.matchedRulePolicyCount, 1);
  assert.equal(
    verdict.checks.some(
      (check) =>
        check.name === "rule_trust_policy" &&
        check.ruleId === "dependency_install_or_update" &&
        check.status === "blocked",
    ),
    true,
  );
});

test("wutai verify-packet can write derived review artifacts", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-verify-write-"));
  const run = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('write artifacts')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 0);

  const { packetDir } = await latestPacket(outputRoot);
  const { result, verdict } = verifyPacket(packetDir, ["--write-artifacts"]);

  assert.equal(result.status, 10);
  assert.equal(verdict.verdict, "review_required");
  assert.equal(
    JSON.parse(await readFile(join(packetDir, "trust-verdict.json"), "utf8")).kind,
    "wutai.trust_verdict",
  );
  assert.equal(
    JSON.parse(await readFile(join(packetDir, "policy-review.json"), "utf8")).kind,
    "wutai.cli_policy_override_review",
  );
});
