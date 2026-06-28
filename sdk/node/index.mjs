import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signData,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyPacketDirectory } from "../../scripts/wutai_verify_packet.mjs";

const DEFAULT_PRODUCER = {
  name: "wutai-agent-sdk",
  adapter: "wutaiAgentSdk",
  runtime: "node",
};

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function byteLength(content) {
  return Buffer.byteLength(content, "utf8");
}

function quoteArg(arg) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) return arg;
  return JSON.stringify(arg);
}

function commandLine(argv) {
  return argv.map(quoteArg).join(" ");
}

function artifact(taskId, name, type, content, createdAt) {
  return {
    artifactId: `${taskId}_artifact_${name.replace(/[^a-z0-9]+/gi, "_")}`,
    taskId,
    type,
    name,
    virtualPath: `artifacts/${taskId}/${name}`,
    content,
    createdAt,
  };
}

function artifactRole(name) {
  if (name === "report.md") return "primary_artifact";
  if (name === "policy.json") return "policy_preflight";
  if (name === "trace.json") return "runtime_trace";
  if (name === "ledger.json") return "session_ledger";
  if (name === "audit.json") return "audit_trail";
  return "supporting_artifact";
}

function event(taskId, index, timestamp, type, summary, details, visibility = "user") {
  return {
    eventId: `${taskId}_event_${index}`,
    taskId,
    timestamp,
    type,
    summary,
    ...(details ? { details } : {}),
    visibility,
  };
}

function statusFromExitCode(exitCode) {
  if (exitCode === null || exitCode === undefined) return "completed_with_warnings";
  return exitCode === 0 ? "completed" : "failed";
}

function defaultPolicy({
  taskId,
  generatedAt,
  command,
  argv,
  workingDirectory,
  executionMode,
}) {
  return {
    schemaVersion: 2,
    kind: "wutai.cli_policy_preflight",
    policyVersion: "external-agent-contract-v0.4",
    profile: {
      profileId: "external-agent-default",
      name: "External Agent Default",
      description:
        "External adapter declared this command as allowed; Wutai did not enforce execution.",
      ruleOverrideCount: 0,
    },
    engine: {
      name: "external_agent_policy_declaration",
      version: "0.4",
      ruleCount: 0,
    },
    decision: "allow",
    highestSeverity: "low",
    allowHighRisk: false,
    override: {
      requested: false,
      applied: false,
      reason: null,
      appliedRuleIds: [],
    },
    matchedRules: [],
    riskProfile: {
      matchedRuleCount: 0,
      severityCounts: {},
      defaultActionCounts: {},
      actionCounts: {},
      highestSeverity: "low",
      ruleOverrideCount: 0,
    },
    decisionRationale: [
      "External adapter declared no Wutai policy rule matches. This is a declaration, not runtime enforcement.",
    ],
    reviewScope: [],
    summary: "External adapter declared this command allowed with no matched policy rules.",
    limitation:
      "This policy record is supplied by an external adapter. Wutai can audit and verify the packet, but it did not enforce the external runtime boundary.",
    taskId,
    generatedAt,
    command,
    argv,
    workingDirectory,
    executionMode,
    dryRun: executionMode === "dry_run",
  };
}

function normalizePolicy(input, defaults) {
  if (!input) return defaultPolicy(defaults);
  return {
    schemaVersion: input.schemaVersion ?? 2,
    kind: "wutai.cli_policy_preflight",
    policyVersion: input.policyVersion ?? "external-agent-contract-v0.4",
    profile: input.profile ?? {
      profileId: "external-agent-declared",
      name: "External Agent Declared",
      description: "Policy outcome supplied by an external agent adapter.",
      ruleOverrideCount: input.riskProfile?.ruleOverrideCount ?? 0,
    },
    engine: input.engine ?? {
      name: "external_agent_policy_declaration",
      version: "0.4",
      ruleCount: input.matchedRules?.length ?? 0,
    },
    decision: input.decision ?? "allow",
    highestSeverity: input.highestSeverity ?? "low",
    allowHighRisk: input.allowHighRisk ?? false,
    override: input.override ?? {
      requested: false,
      applied: false,
      reason: null,
      appliedRuleIds: [],
    },
    matchedRules: input.matchedRules ?? [],
    riskProfile: input.riskProfile ?? {
      matchedRuleCount: input.matchedRules?.length ?? 0,
      severityCounts: {},
      defaultActionCounts: {},
      actionCounts: {},
      highestSeverity: input.highestSeverity ?? "low",
      ruleOverrideCount:
        input.matchedRules?.filter((rule) => rule.ruleOverride?.applied).length ?? 0,
    },
    decisionRationale: input.decisionRationale ?? [
      "Policy outcome supplied by an external agent adapter.",
    ],
    reviewScope: input.reviewScope ?? [],
    summary: input.summary ?? "External adapter supplied a policy outcome.",
    limitation:
      input.limitation ??
      "This policy record is supplied by an external adapter. Wutai did not enforce the external runtime boundary.",
    taskId: defaults.taskId,
    generatedAt: defaults.generatedAt,
    command: defaults.command,
    argv: defaults.argv,
    workingDirectory: defaults.workingDirectory,
    executionMode: defaults.executionMode,
    dryRun: defaults.executionMode === "dry_run",
  };
}

function buildReport({
  task,
  policy,
  command,
  workingDirectory,
  startedAt,
  completedAt,
  exitCode,
  stdoutSummary,
  stderrSummary,
  producer,
  executionMode,
}) {
  return `# Wutai External Agent Packet

## Command

\`${command}\`

## Producer

- Adapter: ${producer.adapter}
- Runtime: ${producer.runtime}

## Policy Declaration

- Decision: ${policy.decision}
- Execution mode: ${executionMode}
- Highest severity: ${policy.highestSeverity}
- Matched rules: ${policy.matchedRules.length ? policy.matchedRules.map((rule) => rule.ruleId).join(", ") : "none"}

## Result

- Working directory: \`${workingDirectory}\`
- Exit code: ${exitCode ?? "not recorded"}
- Started: ${startedAt}
- Completed: ${completedAt}

## Captured Output

- stdout summary: ${stdoutSummary || "No output captured."}
- stderr summary: ${stderrSummary || "No output captured."}

## Boundary

This packet was produced by an external adapter using the Wutai Node SDK. Wutai
can verify the packet contract, artifact hashes, optional attestation, and local
trust policy. Wutai did not sandbox, broker credentials for, or supervise the
external runtime that produced this packet.

## Task

${task.userRequest}
`;
}

function buildManifest({
  task,
  artifacts,
  generatedAt,
  producer,
  command,
  workingDirectory,
  startedAt,
  completedAt,
  exitCode,
  executionMode,
}) {
  const eventTypeCounts = task.events.reduce((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${task.taskId}_work_packet`,
    packetType: "local_script",
    taskId: task.taskId,
    sessionId: task.taskId,
    session: {
      sessionId: task.taskId,
      subject: task.title,
      command,
      workingDirectory,
      startedAt,
      completedAt,
      exitCode,
      importedTrace: false,
      executionMode,
      dryRun: executionMode === "dry_run",
    },
    title: task.title,
    status: task.status,
    userRequest: task.userRequest,
    generatedAt,
    producer,
    permissions: task.permissions,
    audit: {
      eventCount: task.events.length,
      eventTypeCounts,
      permissionDecisionCount: task.permissions.filter(
        (permission) => permission.status !== "pending",
      ).length,
      toolCallCount: eventTypeCounts.ToolCallCaptured ?? 0,
      runtimeEventCount: eventTypeCounts.RuntimeEventCaptured ?? 0,
      credentialPurposes: [],
      auditArtifacts: ["policy.json", "ledger.json", "audit.json"],
      policyDecision: task.policyDecision,
      policyProfile: task.policyProfile,
      executionMode,
    },
    artifacts: artifacts.map((item) => ({
      artifactId: item.artifactId,
      name: item.name,
      role: artifactRole(item.name),
      type: item.type,
      virtualPath: item.virtualPath,
      createdAt: item.createdAt,
      producer,
      bytes: byteLength(item.content),
      sha256: sha256Hex(item.content),
    })),
    evidence: {
      status: "not_available",
      readyForTrust: false,
      summary: "No Evidence Gate verification was run for this external-agent packet.",
      claimsArtifact: null,
      sourcesArtifact: null,
      unsupportedItems: [
        "The packet records external runtime output; it does not prove the command was safe.",
        "Policy metadata can be declared by the external adapter unless separately enforced upstream.",
      ],
      blindSpots: [
        "Wutai did not supervise the external process, filesystem access, network access, or credentials live.",
      ],
    },
    coverage: {
      captured: [
        "command_invocation",
        "working_directory",
        "exit_code",
        "bounded_stdout",
        "bounded_stderr",
        "policy_declaration",
        "session_ledger",
        "audit_trail",
        "artifact_hashes",
      ],
      blindSpots: [
        "The external process ran outside Wutai's runtime control.",
        "Filesystem, network, and credential access are reported by the adapter, not enforced by Wutai.",
      ],
      enforcement: [
        "The packet is reviewable by Wutai's manifest hash, provenance, policy-review, and trust-verdict gates.",
        "No runtime sandbox, credential broker, or live permission boundary is implied by this packet.",
      ],
    },
    humanReview: {
      attestation: "not_recorded",
      note: "Wutai prepared the review surface; no named human attestation is recorded in this packet.",
    },
  };
}

async function buildPacketAttestation({
  taskId,
  generatedAt,
  manifest,
  manifestContent,
  signingKeyPath,
}) {
  const resolvedKeyPath = resolve(signingKeyPath);
  const privateKey = createPrivateKey(
    await readFile(resolvedKeyPath, "utf8"),
  );
  const namedCurve = privateKey.asymmetricKeyDetails?.namedCurve;
  if (
    privateKey.asymmetricKeyType !== "ec" ||
    !["prime256v1", "P-256"].includes(namedCurve)
  ) {
    throw new Error("signingKeyPath must point to an EC P-256 private key PEM.");
  }

  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = String(publicKey.export({ type: "spki", format: "pem" }));
  const signature = signData("sha256", Buffer.from(manifestContent, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return {
    schemaVersion: 1,
    kind: "wutai.packet_attestation",
    taskId,
    generatedAt,
    subject: {
      manifestSha256: sha256Hex(manifestContent),
      manifestBytes: byteLength(manifestContent),
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      producerAdapter: manifest.producer?.adapter,
    },
    signature: {
      algorithm: "ECDSA_P256_SHA256",
      publicKeyPem,
      publicKeySha256: sha256Hex(publicKeyPem),
      signatureBase64: signature.toString("base64"),
    },
    trust: {
      trustedKey: false,
      note:
        "Signature validates the manifest against the included public key only; local trusted-producer policy decides trust.",
    },
    limitation:
      "This attestation detects manifest changes after signing. It does not prove external identity, protect the signing key, or sandbox the command.",
  };
}

export function createPacket(input) {
  if (!input || typeof input !== "object") {
    throw new Error("createPacket requires an input object.");
  }
  const argv = input.argv;
  if (!Array.isArray(argv) || !argv.every((item) => typeof item === "string")) {
    throw new Error("createPacket requires argv as an array of strings.");
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const taskId = input.taskId ?? `agent_${Date.now().toString(36)}`;
  const command = input.command ?? commandLine(argv);
  const workingDirectory = input.workingDirectory ?? process.cwd();
  const startedAt = input.startedAt ?? generatedAt;
  const completedAt = input.completedAt ?? generatedAt;
  const exitCode = input.exitCode ?? 0;
  const executionMode = input.executionMode ?? "execute";
  const producer = {
    ...DEFAULT_PRODUCER,
    ...(input.producer ?? {}),
  };
  const policy = normalizePolicy(input.policy, {
    taskId,
    generatedAt,
    command,
    argv,
    workingDirectory,
    executionMode,
  });
  const permission = {
    requestId: `${taskId}_permission_local_script_execution`,
    taskId,
    status: executionMode === "dry_run" ? "pending" : "approved",
    types: ["local_script_execution"],
    scope: [
      "External adapter declared local-script execution metadata",
      `Producer adapter: ${producer.adapter}`,
      "Wutai did not execute or sandbox this command",
    ],
    createdAt: startedAt,
    ...(executionMode === "dry_run" ? {} : { resolvedAt: startedAt }),
  };
  const artifactPermission = {
    requestId: `${taskId}_permission_artifact_write`,
    taskId,
    status: "approved",
    types: ["artifact_write"],
    scope: [
      "Write a Wutai external-agent packet",
      "Write manifest, report, policy, trace, ledger, and audit artifacts",
    ],
    createdAt: startedAt,
    resolvedAt: startedAt,
  };
  const stdoutSummary = input.stdoutSummary ?? "No output captured.";
  const stderrSummary = input.stderrSummary ?? "No output captured.";
  const events = [
    event(
      taskId,
      1,
      startedAt,
      "TaskStarted",
      "Started external agent packet capture.",
      null,
      "user",
    ),
    event(
      taskId,
      2,
      startedAt,
      "PermissionResolved",
      "External adapter declared the execution boundary.",
      policy.summary,
      "user",
    ),
    event(
      taskId,
      3,
      startedAt,
      "ToolCallCaptured",
      `Recorded external command: ${command}`,
      `Working directory: ${workingDirectory}`,
      "expert",
    ),
    event(
      taskId,
      4,
      completedAt,
      "RuntimeEventCaptured",
      `External command exited with code ${exitCode}.`,
      stdoutSummary,
      "user",
    ),
    event(
      taskId,
      5,
      generatedAt,
      "ArtifactCreated",
      "Saved manifest, report, policy, trace, ledger, and audit artifacts.",
      null,
      "user",
    ),
  ];
  const task = {
    taskId,
    title: input.title ?? `External agent run: ${command}`,
    userRequest: input.userRequest ?? `Record external agent work: ${command}`,
    status: input.status ?? statusFromExitCode(exitCode),
    plan: input.plan ?? [
      "Capture external agent execution metadata.",
      "Write a Wutai-compatible local-script packet.",
      "Verify the packet through Wutai's local trust gate.",
    ],
    createdAt: startedAt,
    updatedAt: generatedAt,
    events,
    permissions: [permission, artifactPermission],
    sources: [],
    artifacts: [],
    policyDecision: policy.decision,
    policyProfile: policy.profile.profileId,
  };
  const trace = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt,
    captureMode: "external_agent_adapter",
    command,
    argv,
    workingDirectory,
    dryRun: executionMode === "dry_run",
    executed: executionMode !== "dry_run",
    startedAt,
    completedAt,
    exitCode,
    stdoutSummary,
    stderrSummary,
    touchedFiles: input.touchedFiles ?? [],
    producedArtifacts: input.producedArtifacts ?? [],
  };
  const ledger = {
    schemaVersion: 1,
    kind: "wutai.session_ledger",
    task,
    generatedAt,
  };
  const audit = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt,
    permissions: [permission, artifactPermission],
    policy,
    events,
    executionMode,
    toolCalls: [
      {
        toolCallId: `${taskId}_tool_1`,
        kind: "external_command",
        command,
        argv,
        workingDirectory,
        startedAt,
        completedAt,
        exitCode,
        captureMode: "external_agent_adapter",
      },
    ],
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "process_exit",
        timestamp: completedAt,
        exitCode,
        stdoutSummary,
        stderrSummary,
      },
    ],
    credentialGrants: input.credentialGrants ?? [],
  };
  const artifacts = [
    artifact(
      taskId,
      "report.md",
      "markdown",
      buildReport({
        task,
        policy,
        command,
        workingDirectory,
        startedAt,
        completedAt,
        exitCode,
        stdoutSummary,
        stderrSummary,
        producer,
        executionMode,
      }),
      generatedAt,
    ),
    artifact(taskId, "policy.json", "json", JSON.stringify(policy, null, 2), generatedAt),
    artifact(taskId, "trace.json", "json", JSON.stringify(trace, null, 2), generatedAt),
    artifact(taskId, "ledger.json", "json", JSON.stringify(ledger, null, 2), generatedAt),
    artifact(taskId, "audit.json", "json", JSON.stringify(audit, null, 2), generatedAt),
  ];
  const manifest = buildManifest({
    task,
    artifacts,
    generatedAt,
    producer,
    command,
    workingDirectory,
    startedAt,
    completedAt,
    exitCode,
    executionMode,
  });
  const manifestArtifact = artifact(
    taskId,
    "manifest.json",
    "json",
    JSON.stringify(manifest, null, 2),
    generatedAt,
  );
  const files = Object.fromEntries(
    [...artifacts, manifestArtifact].map((item) => [item.name, item.content]),
  );

  return {
    schemaVersion: 1,
    kind: "wutai.agent_sdk_packet",
    taskId,
    generatedAt,
    producer,
    manifest,
    artifacts,
    files,
  };
}

export async function writePacket(packet, options = {}) {
  if (!packet?.files || !packet.taskId) {
    throw new Error("writePacket requires a packet created by createPacket.");
  }
  const outputRoot = resolve(options.outputDir ?? "artifacts/external-agent");
  const packetDir = resolve(options.packetDir ?? join(outputRoot, packet.taskId));
  await mkdir(packetDir, { recursive: true });

  const files = { ...packet.files };
  if (options.signingKeyPath) {
    files["attestation.json"] = JSON.stringify(
      await buildPacketAttestation({
        taskId: packet.taskId,
        generatedAt: packet.generatedAt,
        manifest: packet.manifest,
        manifestContent: files["manifest.json"],
        signingKeyPath: options.signingKeyPath,
      }),
      null,
      2,
    );
  }

  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      writeFile(join(packetDir, name), content, "utf8"),
    ),
  );
  return {
    packetDir,
    files: Object.keys(files).sort(),
  };
}

export async function verifyPacket(packetDir, options = {}) {
  return verifyPacketDirectory(packetDir, options);
}
