import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runnerPath = join(repoRoot, "examples", "adapter-proof-runner.mjs");
const registryPath = join(repoRoot, "config", "wutai-adapter-registry.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runProof(adapterId) {
  const outputRoot = await mkdtemp(join(tmpdir(), `wutai-${adapterId}-proof-`));
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      "--adapter",
      adapterId,
      "--quiet",
      "--write-derived-artifacts",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      `console.log('${adapterId} proof packet')`,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 10);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "wutai.adapter_proof_result");
  assert.equal(payload.adapter.adapterId, adapterId);
  assert.equal(payload.verdict, "review_required");
  assert.equal(payload.trustVerdict.inputs.producerAdapter, adapterId);
  return payload;
}

test("adapter registry declares v0.5 proof producers", async () => {
  const registry = await readJson(registryPath);

  assert.equal(registry.kind, "wutai.adapter_registry");
  const adapters = new Map(registry.adapters.map((adapter) => [adapter.adapterId, adapter]));
  for (const adapterId of ["codexCli", "claudeCode", "githubActions"]) {
    const adapter = adapters.get(adapterId);
    assert.ok(adapter, `${adapterId} should be registered`);
    assert.equal(adapter.integrationStatus, "proof_harness");
    assert.equal(adapter.packetTypes.includes("local_script"), true);
    assert.match(adapter.boundary, /packet|Packet|Wutai/);
  }
});

test("adapter proof runner writes reviewable packets for Codex, Claude, and CI producers", async () => {
  for (const adapterId of ["codexCli", "claudeCode", "githubActions"]) {
    const payload = await runProof(adapterId);
    const manifest = await readJson(join(payload.packetDir, "manifest.json"));
    const trace = await readJson(join(payload.packetDir, "trace.json"));
    const verdict = await readJson(join(payload.packetDir, "trust-verdict.json"));
    const provenance = await readJson(join(payload.packetDir, "provenance.json"));

    assert.equal(manifest.kind, "wutai.work_packet_manifest");
    assert.equal(manifest.packetType, "local_script");
    assert.equal(manifest.producer.adapter, adapterId);
    assert.equal(trace.captureMode, "external_agent_adapter");
    assert.equal(trace.exitCode, 0);
    assert.match(trace.stdoutSummary, new RegExp(`${adapterId} proof packet`));
    assert.equal(verdict.kind, "wutai.trust_verdict");
    assert.equal(verdict.verdict, "review_required");
    assert.equal(provenance.kind, "wutai.packet_provenance_check");
  }
});
