import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapperPath = join(repoRoot, "scripts", "wutai_run.mjs");

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
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

async function latestPacket(outputRoot) {
  const entries = await readdir(outputRoot);
  assert.equal(entries.length, 1);
  const packetDir = join(outputRoot, entries[0]);
  const manifestContent = await readFile(join(packetDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestContent);
  const policy = JSON.parse(await readFile(join(packetDir, "policy.json"), "utf8"));
  const trace = JSON.parse(await readFile(join(packetDir, "trace.json"), "utf8"));
  const audit = JSON.parse(await readFile(join(packetDir, "audit.json"), "utf8"));
  const ledger = JSON.parse(await readFile(join(packetDir, "ledger.json"), "utf8"));
  const report = await readFile(join(packetDir, "report.md"), "utf8");
  const attestation = await readOptionalJson(join(packetDir, "attestation.json"));
  return {
    packetDir,
    manifest,
    manifestContent,
    policy,
    trace,
    audit,
    ledger,
    report,
    attestation,
  };
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
  const { manifest, policy, trace, audit, ledger, report } =
    await latestPacket(outputRoot);

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.kind, "wutai.work_packet_manifest");
  assert.equal(manifest.packetType, "local_script");
  assert.equal(manifest.status, "completed");
  assert.equal(manifest.producer.adapter, "wutaiRunCli");
  assert.equal(manifest.session.importedTrace, false);
  assert.equal(manifest.session.exitCode, 0);
  assert.equal(manifest.audit.toolCallCount, 1);
  assert.equal(manifest.audit.runtimeEventCount, 1);
  assert.equal(manifest.audit.policyDecision, "allow");
  assert.equal(manifest.evidence.status, "not_available");
  assert.deepEqual(
    manifest.artifacts.map((item) => item.name),
    ["report.md", "policy.json", "trace.json", "ledger.json", "audit.json"],
  );
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifacts[1].role, "policy_preflight");
  assert.equal(manifest.artifacts[3].role, "session_ledger");
  assert.equal(policy.schemaVersion, 2);
  assert.equal(policy.policyVersion, "wutai-cli-policy-v0.2");
  assert.equal(policy.profile.profileId, "standard");
  assert.match(policy.policyConfig.sourcePath, /wutai-cli-policy-profiles\.json$/);
  assert.equal(policy.policyConfig.defaultProfile, "standard");
  assert.equal(policy.engine.name, "wutai_cli_policy");
  assert.equal(policy.riskProfile.matchedRuleCount, 0);
  assert.equal(policy.executionMode, "execute");
  assert.equal(policy.dryRun, false);
  assert.equal(policy.decision, "allow");
  assert.deepEqual(policy.reviewScope, []);
  assert.equal(trace.captureMode, "cli_wrapper");
  assert.equal(trace.executed, true);
  assert.equal(trace.exitCode, 0);
  assert.match(trace.stdoutSummary, /wutai cli pass/);
  assert.match(trace.stderrSummary, /diagnostic line/);
  assert.equal(audit.runtimeEvents[0].exitCode, 0);
  assert.equal(ledger.task.status, "completed");
  assert.match(report, /Wutai CLI Run Packet/);
});

test("wutai_run writes an optional signed packet attestation", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-signed-"));
  const keyRoot = await mkdtemp(join(tmpdir(), "wutai-run-key-"));
  const signingKeyPath = join(keyRoot, "signing-key.pem");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await writeFile(
    signingKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "utf8",
  );

  const result = spawnSync(
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
      "console.log('signed packet')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  const { manifest, manifestContent, attestation } =
    await latestPacket(outputRoot);

  assert.ok(attestation);
  assert.equal(attestation.kind, "wutai.packet_attestation");
  assert.equal(attestation.taskId, manifest.taskId);
  assert.equal(attestation.subject.manifestSha256, sha256Hex(manifestContent));
  assert.equal(attestation.subject.manifestBytes, Buffer.byteLength(manifestContent));
  assert.equal(attestation.subject.packetId, manifest.packetId);
  assert.equal(attestation.signature.algorithm, "ECDSA_P256_SHA256");
  assert.match(attestation.signature.publicKeySha256, /^[a-f0-9]{64}$/);
  assert.match(attestation.signature.signatureBase64, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(attestation.trust.trustedKey, false);
  assert.match(attestation.limitation, /does not prove/);
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
  const { manifest, policy, trace, ledger } = await latestPacket(outputRoot);

  assert.equal(manifest.status, "failed");
  assert.equal(manifest.session.exitCode, 7);
  assert.equal(policy.decision, "allow");
  assert.equal(trace.exitCode, 7);
  assert.match(trace.stderrSummary, /planned failure/);
  assert.equal(ledger.task.status, "failed");
  assert.equal(
    manifest.coverage.enforcement.includes(
      "No sandbox, credential broker, or complete destructive-command policy is implemented.",
    ),
    true,
  );
});

test("wutai_run denies matched high-risk commands before execution", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-deny-"));
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      "sh",
      "-c",
      "echo should_not_run",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 3);
  const { manifest, policy, trace, audit, ledger } = await latestPacket(outputRoot);

  assert.equal(policy.decision, "deny");
  assert.equal(policy.highestSeverity, "high");
  assert.equal(policy.matchedRules[0].ruleId, "shell_interpreter_command_string");
  assert.equal(policy.matchedRules[0].category, "shell_boundary");
  assert.equal(policy.matchedRules[0].defaultAction, "deny");
  assert.equal(policy.matchedRules[0].overrideable, true);
  assert.equal(policy.override.requested, false);
  assert.equal(policy.override.applied, false);
  assert.equal(policy.reviewScope.includes("shell expansion"), true);
  assert.match(policy.decisionRationale.join(" "), /Denied because/);
  assert.equal(manifest.status, "cancelled");
  assert.equal(manifest.audit.toolCallCount, 0);
  assert.equal(manifest.audit.runtimeEventCount, 0);
  assert.equal(manifest.audit.policyDecision, "deny");
  assert.equal(trace.executed, false);
  assert.equal(trace.stdoutSummary, "No output captured.");
  assert.equal(audit.toolCalls.length, 0);
  assert.equal(audit.runtimeEvents.length, 0);
  assert.equal(ledger.task.status, "cancelled");
});

test("wutai_run records warning policy rules without blocking execution", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-warning-"));
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "--inspect=0",
      "-e",
      "console.log('inspect warning path')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  const { manifest, policy, trace, audit } = await latestPacket(outputRoot);

  assert.equal(policy.decision, "allow_with_warnings");
  assert.equal(policy.highestSeverity, "medium");
  assert.equal(policy.matchedRules[0].ruleId, "network_listener");
  assert.equal(policy.matchedRules[0].category, "network_boundary");
  assert.equal(policy.matchedRules[0].defaultAction, "warn");
  assert.equal(policy.matchedRules[0].effectiveAction, "warn");
  assert.equal(policy.matchedRules[0].profileEscalated, false);
  assert.equal(policy.riskProfile.actionCounts.warn, 1);
  assert.equal(policy.reviewScope.includes("local network listener"), true);
  assert.equal(manifest.audit.policyDecision, "allow_with_warnings");
  assert.equal(trace.executed, true);
  assert.match(trace.stdoutSummary, /inspect warning path/);
  assert.equal(audit.toolCalls.length, 1);
});

test("wutai_run writes a dry-run review packet without executing the command", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-dry-"));
  const sideEffectRoot = await mkdtemp(join(tmpdir(), "wutai-run-side-effect-"));
  const markerPath = join(sideEffectRoot, "marker.txt");
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--dry-run",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "executed")`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  await assert.rejects(() => access(markerPath));
  const { manifest, policy, trace, audit, ledger, report } =
    await latestPacket(outputRoot);

  assert.equal(policy.decision, "allow");
  assert.equal(policy.executionMode, "dry_run");
  assert.equal(policy.dryRun, true);
  assert.equal(policy.profile.profileId, "standard");
  assert.equal(manifest.status, "completed_with_warnings");
  assert.equal(manifest.session.dryRun, true);
  assert.equal(manifest.session.executionMode, "dry_run");
  assert.equal(manifest.session.exitCode, null);
  assert.equal(manifest.audit.executionMode, "dry_run");
  assert.equal(manifest.audit.toolCallCount, 0);
  assert.equal(trace.dryRun, true);
  assert.equal(trace.executed, false);
  assert.equal(trace.exitCode, null);
  assert.equal(audit.toolCalls.length, 0);
  assert.equal(audit.runtimeEvents.length, 0);
  assert.equal(ledger.task.status, "completed_with_warnings");
  assert.equal(ledger.task.permissions[0].status, "pending");
  assert.match(report, /Execution mode: dry_run/);
});

test("wutai_run strict policy profile escalates warning rules to deny", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-strict-"));
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--policy-profile",
      "strict",
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "--inspect=0",
      "-e",
      "console.log('strict profile should not execute')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 3);
  const { manifest, policy, trace, audit, ledger } = await latestPacket(outputRoot);

  assert.equal(policy.profile.profileId, "strict");
  assert.equal(policy.decision, "deny");
  assert.equal(policy.matchedRules[0].ruleId, "network_listener");
  assert.equal(policy.matchedRules[0].defaultAction, "warn");
  assert.equal(policy.matchedRules[0].effectiveAction, "deny");
  assert.equal(policy.matchedRules[0].profileEscalated, true);
  assert.equal(policy.riskProfile.defaultActionCounts.warn, 1);
  assert.equal(policy.riskProfile.actionCounts.deny, 1);
  assert.equal(manifest.status, "cancelled");
  assert.equal(manifest.audit.policyProfile, "strict");
  assert.equal(manifest.audit.executionMode, "execute");
  assert.equal(trace.executed, false);
  assert.equal(audit.toolCalls.length, 0);
  assert.equal(ledger.task.status, "cancelled");
});

test("wutai_run loads a custom policy profile config", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-profile-config-"));
  const configRoot = await mkdtemp(join(tmpdir(), "wutai-run-config-"));
  const configPath = join(configRoot, "profiles.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wutai.cli_policy_profile_config",
        defaultProfile: "review_all",
        profiles: {
          review_all: {
            profileId: "review_all",
            name: "Review All",
            description: "Escalate every warning rule into a review stop.",
            warningAction: "deny",
          },
        },
      },
      null,
      2,
    ),
  );
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--policy-config",
      configPath,
      "--output-dir",
      outputRoot,
      "--",
      process.execPath,
      "--inspect=0",
      "-e",
      "console.log('custom profile should not execute')",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 3);
  const { manifest, policy, trace } = await latestPacket(outputRoot);

  assert.equal(policy.profile.profileId, "review_all");
  assert.equal(policy.profile.name, "Review All");
  assert.equal(policy.policyConfig.sourcePath, configPath);
  assert.equal(policy.policyConfig.defaultProfile, "review_all");
  assert.equal(policy.policyConfig.profileCount, 1);
  assert.equal(policy.matchedRules[0].effectiveAction, "deny");
  assert.equal(manifest.audit.policyProfile, "review_all");
  assert.equal(trace.executed, false);
});

test("wutai_run applies rule-level policy overrides from config", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-rule-override-"));
  const configRoot = await mkdtemp(join(tmpdir(), "wutai-run-rule-config-"));
  const configPath = join(configRoot, "profiles.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wutai.cli_policy_profile_config",
        defaultProfile: "dependency_stop",
        profiles: {
          dependency_stop: {
            profileId: "dependency_stop",
            name: "Dependency Stop",
            description: "Escalate dependency mutation through a rule override.",
            warningAction: "warn",
            ruleOverrides: {
              dependency_install_or_update: {
                effectiveAction: "deny",
                severity: "high",
                reviewScope: ["dependency tree", "lockfile mutation"],
                reason: "Dependency mutation requires an explicit review gate.",
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--policy-config",
      configPath,
      "--output-dir",
      outputRoot,
      "--",
      "npm",
      "install",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 3);
  const { manifest, policy, trace } = await latestPacket(outputRoot);
  const matchedRule = policy.matchedRules[0];

  assert.equal(policy.profile.profileId, "dependency_stop");
  assert.equal(policy.profile.ruleOverrideCount, 1);
  assert.equal(policy.policyConfig.ruleOverrideCount, 1);
  assert.equal(policy.decision, "deny");
  assert.equal(policy.highestSeverity, "high");
  assert.equal(policy.riskProfile.ruleOverrideCount, 1);
  assert.equal(matchedRule.ruleId, "dependency_install_or_update");
  assert.equal(matchedRule.defaultAction, "warn");
  assert.equal(matchedRule.effectiveAction, "deny");
  assert.equal(matchedRule.severity, "high");
  assert.equal(matchedRule.profileEscalated, false);
  assert.equal(matchedRule.ruleOverride.applied, true);
  assert.equal(matchedRule.ruleOverride.baseEffectiveAction, "warn");
  assert.equal(matchedRule.ruleOverride.effectiveAction, "deny");
  assert.equal(
    matchedRule.ruleOverride.reason,
    "Dependency mutation requires an explicit review gate.",
  );
  assert.deepEqual(matchedRule.reviewScope, [
    "dependency tree",
    "lockfile mutation",
  ]);
  assert.equal(manifest.status, "cancelled");
  assert.equal(trace.executed, false);
});

test("wutai_run records explicit high-risk override", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "wutai-run-override-"));
  const result = spawnSync(
    process.execPath,
    [
      wrapperPath,
      "--quiet",
      "--allow-high-risk",
      "--override-reason",
      "reviewed shell boundary for test fixture",
      "--output-dir",
      outputRoot,
      "--",
      "sh",
      "-c",
      "printf wutai_override",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  const { manifest, policy, trace, audit } = await latestPacket(outputRoot);

  assert.equal(policy.decision, "allow_with_override");
  assert.equal(policy.allowHighRisk, true);
  assert.equal(policy.override.requested, true);
  assert.equal(policy.override.applied, true);
  assert.equal(policy.override.reason, "reviewed shell boundary for test fixture");
  assert.deepEqual(policy.override.appliedRuleIds, [
    "shell_interpreter_command_string",
  ]);
  assert.equal(policy.matchedRules[0].ruleId, "shell_interpreter_command_string");
  assert.equal(manifest.status, "completed");
  assert.equal(manifest.audit.policyDecision, "allow_with_override");
  assert.equal(trace.executed, true);
  assert.match(trace.stdoutSummary, /wutai_override/);
  assert.equal(audit.toolCalls.length, 1);
});
