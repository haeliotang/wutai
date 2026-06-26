import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapperPath = join(repoRoot, "scripts", "wutai_run.mjs");

async function latestPacket(outputRoot) {
  const entries = await readdir(outputRoot);
  assert.equal(entries.length, 1);
  const packetDir = join(outputRoot, entries[0]);
  const manifest = JSON.parse(
    await readFile(join(packetDir, "manifest.json"), "utf8"),
  );
  const trace = JSON.parse(await readFile(join(packetDir, "trace.json"), "utf8"));
  const audit = JSON.parse(await readFile(join(packetDir, "audit.json"), "utf8"));
  const ledger = JSON.parse(await readFile(join(packetDir, "ledger.json"), "utf8"));
  const report = await readFile(join(packetDir, "report.md"), "utf8");
  return { packetDir, manifest, trace, audit, ledger, report };
}

test("wutai_run writes a completed local-script work packet", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-pass-"));
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.log('wutai cli pass'); console.error('diagnostic line')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  const { manifest, trace, audit, ledger, report } = await latestPacket(outputRoot);

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.kind, "wutai.work_packet_manifest");
  assert.equal(manifest.packetType, "local_script");
  assert.equal(manifest.status, "completed");
  assert.equal(manifest.producer.adapter, "wutaiRunCli");
  assert.equal(manifest.session.importedTrace, false);
  assert.equal(manifest.session.exitCode, 0);
  assert.equal(manifest.audit.toolCallCount, 1);
  assert.equal(manifest.audit.runtimeEventCount, 1);
  assert.equal(manifest.evidence.status, "not_available");
  assert.deepEqual(
    manifest.artifacts.map((item) => item.name),
    ["report.md", "trace.json", "ledger.json", "audit.json"],
  );
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifacts[2].role, "session_ledger");
  assert.equal(trace.captureMode, "cli_wrapper");
  assert.equal(trace.exitCode, 0);
  assert.match(trace.stdoutSummary, /wutai cli pass/);
  assert.match(trace.stderrSummary, /diagnostic line/);
  assert.equal(audit.runtimeEvents[0].exitCode, 0);
  assert.equal(ledger.task.status, "completed");
  assert.match(report, /Wutai CLI Run Packet/);
});

test("wutai_run writes a failed packet and preserves the child exit code", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-fail-"));
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      "console.error('planned failure'); process.exit(7)",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 7);
  const { manifest, trace, ledger } = await latestPacket(outputRoot);

  assert.equal(manifest.status, "failed");
  assert.equal(manifest.session.exitCode, 7);
  assert.equal(trace.exitCode, 7);
  assert.match(trace.stderrSummary, /planned failure/);
  assert.equal(ledger.task.status, "failed");
  assert.equal(
    manifest.coverage.enforcement.includes(
      "No policy engine, sandbox, credential broker, or destructive-command blocker is implemented.",
    ),
    true,
  );
});
