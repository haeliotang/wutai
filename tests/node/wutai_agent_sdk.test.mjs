import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createPacket,
  verifyPacket,
  writePacket,
} from "../../sdk/node/index.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const verifierPath = join(repoRoot, "scripts", "wutai_verify_packet.mjs");
const externalWrapperPath = join(repoRoot, "examples", "external-agent-wrapper.mjs");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function createSdkPacket(outputRoot, overrides = {}) {
  const packet = createPacket({
    taskId: overrides.taskId ?? `sdk_packet_${Date.now().toString(36)}`,
    argv: [process.execPath, "-e", "console.log('sdk packet')"],
    title: "SDK packet test",
    userRequest: "Record an SDK packet test.",
    workingDirectory: repoRoot,
    exitCode: 0,
    stdoutSummary: "sdk packet",
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

test("Node SDK is available through the package export", async () => {
  const sdk = await import("wutai/node");

  assert.equal(typeof sdk.createPacket, "function");
  assert.equal(typeof sdk.writePacket, "function");
  assert.equal(typeof sdk.verifyPacket, "function");
});

test("Node SDK writes a non-Wutai external-agent packet that the CLI verifier can review", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-sdk-review-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "sdk_review_packet",
  });
  const manifest = await readJson(join(packetDir, "manifest.json"));

  assert.equal(manifest.kind, "wutai.work_packet_manifest");
  assert.equal(manifest.packetType, "local_script");
  assert.equal(manifest.producer.adapter, "testExternalAgent");
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.name),
    ["report.md", "policy.json", "trace.json", "ledger.json", "audit.json"],
  );

  const cli = spawnSync(process.execPath, [verifierPath, packetDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(cli.stderr, "");
  assert.equal(cli.status, 10);
  const verdict = JSON.parse(cli.stdout);
  assert.equal(verdict.kind, "wutai.trust_verdict");
  assert.equal(verdict.verdict, "review_required");
  assert.equal(verdict.inputs.producerAdapter, "testExternalAgent");
  assert.equal(verdict.policy.policyId, "personal-default");
});

test("Node SDK packet verification blocks tampered artifact bytes", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-sdk-tamper-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "sdk_tamper_packet",
  });

  await writeFile(join(packetDir, "trace.json"), '{"tampered":true}\n', "utf8");
  const { trustVerdict } = await verifyPacket(packetDir);

  assert.equal(trustVerdict.verdict, "blocked");
  assert.equal(trustVerdict.inputs.integrityStatus, "failed");
  assert.equal(
    trustVerdict.checks.some(
      (check) => check.name === "artifact_integrity" && check.status === "blocked",
    ),
    true,
  );
});

test("strict-local trust policy profile blocks unsigned external packets", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-sdk-strict-"));
  const { packetDir } = await createSdkPacket(outputRoot, {
    taskId: "sdk_strict_packet",
  });
  const { trustVerdict } = await verifyPacket(packetDir, {
    trustPolicyProfile: "strict-local",
  });

  assert.equal(trustVerdict.verdict, "blocked");
  assert.equal(trustVerdict.policy.policyId, "strict-local");
  assert.equal(
    trustVerdict.checks.some(
      (check) =>
        check.name === "trusted_producer_required" &&
        check.status === "blocked",
    ),
    true,
  );
});

test("external-agent wrapper runs a real command and emits a Wutai packet verdict", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-external-wrapper-"));
  const result = spawnSync(
    process.execPath,
    [
      externalWrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('external wrapper')",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 10);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "wutai.external_agent_wrapper_result");
  assert.equal(payload.verdict, "review_required");
  assert.equal(payload.trustVerdict.inputs.producerAdapter, "wutaiExternalAgentExample");

  const entries = await readdir(outputRoot);
  assert.equal(entries.length, 1);
  const manifest = await readJson(join(outputRoot, entries[0], "manifest.json"));
  const trace = await readJson(join(outputRoot, entries[0], "trace.json"));
  assert.equal(manifest.producer.adapter, "wutaiExternalAgentExample");
  assert.equal(trace.captureMode, "external_agent_adapter");
  assert.equal(trace.exitCode, 0);
  assert.match(trace.stdoutSummary, /external wrapper/);
});

test("v0.4 contract schemas and trust-policy profiles are valid JSON", async () => {
  const schemasDir = join(repoRoot, "schemas");
  const schemaFiles = (await readdir(schemasDir)).filter((name) =>
    name.endsWith(".schema.json"),
  );
  assert.deepEqual(schemaFiles.sort(), [
    "cli-policy-preflight.schema.json",
    "local-script-trace.schema.json",
    "session-audit.schema.json",
    "session-ledger.schema.json",
    "trust-policy.schema.json",
    "trust-verdict.schema.json",
    "work-packet-manifest.schema.json",
  ]);

  for (const schemaFile of schemaFiles) {
    const schema = await readJson(join(schemasDir, schemaFile));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.type, "object");
  }

  const profiles = await readJson(
    join(repoRoot, "config", "wutai-trust-policy-profiles.json"),
  );
  assert.equal(profiles.kind, "wutai.trust_policy_profile_config");
  assert.equal(profiles.defaultProfile, "personal-default");
  assert.deepEqual(Object.keys(profiles.profiles).sort(), [
    "ci-review",
    "personal-default",
    "strict-local",
  ]);
});
