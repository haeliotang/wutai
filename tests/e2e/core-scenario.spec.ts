import { expect, test } from "@playwright/test";
import { createHash, generateKeyPairSync, sign as signData } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sha256Hex(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function manifestArtifact(
  name: string,
  type: "markdown" | "json",
  content: string,
  createdAt: string,
) {
  return {
    name,
    type,
    virtualPath: `artifacts/cli_fixture_review/${name}`,
    createdAt,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256Hex(content),
  };
}

function signedAttestation(
  taskId: string,
  generatedAt: string,
  manifest: {
    packetId?: string;
    packetType?: string;
    producer?: { adapter?: string };
  },
  manifestContent: string,
) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicKeyPem = String(
    publicKey.export({ type: "spki", format: "pem" }),
  );
  const signature = signData("sha256", Buffer.from(manifestContent), {
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
      manifestBytes: Buffer.byteLength(manifestContent, "utf8"),
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
        "Signature validates the manifest against the included public key only; Wutai has no trusted key registry yet.",
    },
    limitation:
      "This attestation detects manifest changes after signing. It does not prove the private key owner is trusted.",
  };
}

test("runs the v0.1 mock research task lifecycle", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("WUTAI / OBSERVE MODE")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();
  await expect(page.getByText("Adapter: Mock research adapter")).toBeVisible();
  await expect(page.getByLabel("Research setup")).toHaveCount(0);

  await page.getByRole("button", { name: "Create plan" }).click();

  await expect(page.getByText("Permission required")).toBeVisible();
  await expect(page.getByText("No form submission")).toBeVisible();

  await page.getByRole("button", { name: "Allow for this task" }).click();

  await expect(page.getByText("Research task completed.")).toBeVisible();
  await expect(page.getByLabel("Evidence Gate")).toBeVisible();
  await expect(page.getByText("Evidence passed")).toBeVisible();
  await expect(
    page.getByText("Evidence checks passed for the mock research fixture."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download claims" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download verification" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download manifest" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifact preview" })).toBeVisible();
  await expect(page.getByText("Wutai v0.1 Mock Research Report")).toBeVisible();
  await expect(
    page.getByText(
      "Saved manifest, report, sources, claims, verification, and audit artifacts.",
    ),
  ).toBeVisible();
  const manifest = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    const activeTask = tasks[0];
    const artifact = activeTask.artifacts.find(
      (item: { name: string }) => item.name === "manifest.json",
    );
    return artifact ? JSON.parse(artifact.content) : null;
  });
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.kind).toBe("wutai.work_packet_manifest");
  expect(manifest.packetType).toBe("research");
  expect(manifest.producer.adapter).toBe("mockResearchAdapter");
  expect(manifest.artifacts.map((item: { name: string }) => item.name)).toEqual([
    "report.md",
    "sources.json",
    "claims.json",
    "verification.json",
    "audit.json",
  ]);
  expect(manifest.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.evidence.status).toBe("pass");

  await page.setViewportSize({ width: 860, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("imports a local script trace as a v0.2 work packet", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Import local script trace" }).click();

  await expect(page.getByText("Local script trace imported.")).toBeVisible();
  await expect(
    page.getByText("Captured command result: exit code 0."),
  ).toBeVisible();
  await expect(page.getByText("# Local Script Trace Import")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download manifest" }),
  ).toBeVisible();

  const manifest = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    const activeTask = tasks[0];
    const artifact = activeTask.artifacts.find(
      (item: { name: string }) => item.name === "manifest.json",
    );
    return artifact ? JSON.parse(artifact.content) : null;
  });

  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.kind).toBe("wutai.work_packet_manifest");
  expect(manifest.packetType).toBe("local_script");
  expect(manifest.producer.adapter).toBe("localScriptTraceImporter");
  expect(manifest.session.command).toBe("npm run test:evidence");
  expect(manifest.session.importedTrace).toBe(true);
  expect(manifest.audit.toolCallCount).toBe(1);
  expect(manifest.audit.runtimeEventCount).toBe(1);
  expect(manifest.evidence.status).toBe("not_available");
  expect(manifest.artifacts.map((item: { name: string }) => item.name)).toEqual([
    "report.md",
    "trace.json",
    "audit.json",
  ]);
  expect(manifest.artifacts[1].role).toBe("runtime_trace");
  expect(manifest.artifacts[1].producer.adapter).toBe("localScriptTraceImporter");
  expect(manifest.artifacts[1].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.coverage.enforcement).toContain(
    "Trace import records the boundary after execution; it does not enforce shell permissions.",
  );
});

test("imports a coding-agent trace as a v0.2 work packet", async ({ page }) => {
  await page.goto("/");

  const trace = {
    schemaVersion: 1,
    kind: "wutai.coding_agent_trace",
    agentName: "Codex",
    agentRuntime: "codex-cli declared fixture",
    sessionId: "codex_fixture_session",
    title: "Implement packet provenance checks",
    userRequest:
      "Add packet provenance checks and update tests without executing inside Wutai.",
    repository: "/tmp/wutai",
    startedAt: "2026-06-27T08:00:00.000Z",
    completedAt: "2026-06-27T08:03:00.000Z",
    status: "completed",
    summary: "Imported session declared one shell command and one source edit.",
    toolCalls: [
      {
        toolCallId: "tool_1",
        kind: "shell_command",
        command: "npm run test:e2e",
        summary: "Ran browser regression tests.",
        exitCode: 0,
        status: "completed",
      },
      {
        toolCallId: "tool_2",
        kind: "file_edit",
        path: "src/runtime/cliPacketImporter.ts",
        action: "modified",
        summary: "Added provenance checks.",
        status: "completed",
      },
    ],
    fileChanges: [
      {
        path: "src/runtime/cliPacketImporter.ts",
        action: "modified",
        summary: "Added packet provenance checks.",
      },
      {
        path: "tests/e2e/core-scenario.spec.ts",
        action: "modified",
        summary: "Covered imported packet review.",
      },
    ],
    producedArtifacts: ["provenance.json"],
    credentialPurposes: ["none_declared"],
    limitations: [
      "Fixture does not include full stdout, stderr, or source diffs.",
    ],
  };

  await page.getByLabel("Coding agent trace").setInputFiles([
    {
      name: "codex-trace.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(trace, null, 2)),
    },
  ]);

  await expect(page.getByText("Coding-agent trace imported.")).toBeVisible();
  await expect(page.getByText("# Coding Agent Trace Import")).toBeVisible();
  await expect(
    page.getByText("Imported session declared one shell command and one source edit."),
  ).toBeVisible();

  const importedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const manifestArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "manifest.json",
  );
  const traceArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "trace.json",
  );
  const auditArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "audit.json",
  );
  const manifest = JSON.parse(manifestArtifact.content);
  const importedTrace = JSON.parse(traceArtifact.content);
  const audit = JSON.parse(auditArtifact.content);

  expect(importedTask.status).toBe("completed");
  expect(manifest.packetType).toBe("coding_agent");
  expect(manifest.producer.adapter).toBe("codingAgentTraceImporter");
  expect(manifest.session.importedTrace).toBe(true);
  expect(manifest.session.workingDirectory).toBe("/tmp/wutai");
  expect(manifest.audit.toolCallCount).toBe(2);
  expect(manifest.audit.runtimeEventCount).toBe(1);
  expect(manifest.audit.credentialPurposes).toEqual(["none_declared"]);
  expect(manifest.coverage.enforcement).toContain(
    "Trace import records the boundary after execution; it does not supervise the coding agent.",
  );
  expect(importedTrace.kind).toBe("wutai.coding_agent_trace");
  expect(importedTrace.toolCalls).toHaveLength(2);
  expect(audit.toolCalls).toHaveLength(2);
  expect(audit.fileChanges).toHaveLength(2);
  expect(audit.credentialGrants[0].purpose).toBe("none_declared");
});

test("imports an MCP tool-call trace as a v0.2 work packet", async ({ page }) => {
  await page.goto("/");

  const trace = {
    schemaVersion: 1,
    kind: "wutai.mcp_tool_call_trace",
    clientName: "local-agent-fixture",
    serverName: "filesystem-mcp",
    sessionId: "mcp_fixture_session",
    title: "Read repository metadata",
    userRequest:
      "Record MCP tool calls from an already-run local agent session.",
    startedAt: "2026-06-27T09:00:00.000Z",
    completedAt: "2026-06-27T09:01:00.000Z",
    status: "completed",
    summary: "Imported MCP session declared two tool calls.",
    toolCalls: [
      {
        toolCallId: "mcp_tool_1",
        toolName: "list_directory",
        requestSummary: "Listed the docs directory.",
        argumentsPreview: '{"path":"docs"}',
        resultSummary: "Returned architecture and development docs.",
        latencyMs: 42,
        status: "completed",
      },
      {
        toolCallId: "mcp_tool_2",
        serverName: "git-mcp",
        toolName: "git_status",
        requestSummary: "Checked worktree status.",
        resultSummary: "No uncommitted changes.",
        latencyMs: 18,
        status: "completed",
      },
    ],
    resources: ["docs/architecture.md", "git status"],
    credentialPurposes: ["none_declared"],
    limitations: ["Fixture does not include full MCP request or response bodies."],
  };

  await page.getByLabel("MCP tool-call trace").setInputFiles([
    {
      name: "mcp-trace.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(trace, null, 2)),
    },
  ]);

  await expect(page.getByText("MCP tool-call trace imported.")).toBeVisible();
  await expect(page.getByText("# MCP Tool-Call Trace Import")).toBeVisible();
  await expect(
    page.getByText("Imported MCP session declared two tool calls."),
  ).toBeVisible();

  const importedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const manifestArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "manifest.json",
  );
  const traceArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "trace.json",
  );
  const auditArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "audit.json",
  );
  const manifest = JSON.parse(manifestArtifact.content);
  const importedTrace = JSON.parse(traceArtifact.content);
  const audit = JSON.parse(auditArtifact.content);

  expect(importedTask.status).toBe("completed");
  expect(manifest.packetType).toBe("mcp_tool_call");
  expect(manifest.producer.adapter).toBe("mcpToolCallRecorder");
  expect(manifest.session.importedTrace).toBe(true);
  expect(manifest.audit.toolCallCount).toBe(2);
  expect(manifest.audit.runtimeEventCount).toBe(1);
  expect(manifest.audit.credentialPurposes).toEqual(["none_declared"]);
  expect(manifest.coverage.enforcement).toContain(
    "Trace import records MCP tool calls after execution; it does not enforce MCP permissions.",
  );
  expect(importedTrace.kind).toBe("wutai.mcp_tool_call_trace");
  expect(importedTrace.toolCalls).toHaveLength(2);
  expect(audit.toolCalls[0].kind).toBe("mcp_tool_call");
  expect(audit.toolCalls[1].serverName).toBe("git-mcp");
  expect(audit.resources).toEqual(["docs/architecture.md", "git status"]);
});

test("rejects invalid MCP tool-call traces without creating a packet", async ({
  page,
}) => {
  await page.goto("/");

  const trace = {
    schemaVersion: 1,
    kind: "wutai.mcp_tool_call_trace",
    serverName: "filesystem-mcp",
    title: "Invalid MCP trace",
    userRequest: "This trace is missing a required tool name.",
    startedAt: "2026-06-27T09:00:00.000Z",
    completedAt: "2026-06-27T09:01:00.000Z",
    status: "completed",
    summary: "Invalid fixture.",
    toolCalls: [
      {
        requestSummary: "Missing toolName should fail validation.",
        status: "completed",
      },
    ],
  };

  await page.getByLabel("MCP tool-call trace").setInputFiles([
    {
      name: "bad-mcp-trace.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(trace, null, 2)),
    },
  ]);

  await expect(
    page.getByText("MCP tool-call trace must provide toolCalls[].toolName."),
  ).toBeVisible();

  const taskCount = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]").length,
  );
  expect(taskCount).toBe(0);
});

test("ingests user-selected local files as a v0.2 work packet", async ({ page }) => {
  await page.goto("/");

  const notes = "# Review Notes\n\nKeep the packet boundary narrow.\n";
  const policy = '{"policy":"local-only"}\n';

  await page.getByLabel("Local files", { exact: true }).setInputFiles([
    {
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(notes),
    },
    {
      name: "policy.json",
      mimeType: "application/json",
      buffer: Buffer.from(policy),
    },
  ]);

  await expect(page.getByText("Local files imported.")).toBeVisible();
  await expect(page.getByText("# Local File Ingestion")).toBeVisible();
  await expect(page.getByText("Keep the packet boundary narrow.")).toBeVisible();

  const importedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const manifestArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "manifest.json",
  );
  const filesArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "files.json",
  );
  const auditArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "audit.json",
  );
  const manifest = JSON.parse(manifestArtifact.content);
  const files = JSON.parse(filesArtifact.content);
  const audit = JSON.parse(auditArtifact.content);

  expect(importedTask.status).toBe("completed");
  expect(manifest.packetType).toBe("local_file");
  expect(manifest.producer.adapter).toBe("localFileIngestion");
  expect(manifest.session.importedTrace).toBe(false);
  expect(manifest.audit.toolCallCount).toBe(0);
  expect(manifest.audit.runtimeEventCount).toBe(1);
  expect(manifest.artifacts.map((item: { name: string }) => item.name)).toEqual([
    "report.md",
    "files.json",
    "audit.json",
  ]);
  expect(manifest.artifacts[1].role).toBe("file_inventory");
  expect(manifest.coverage.enforcement).toContain(
    "Local file ingestion is a user-selected read path only.",
  );
  expect(files.kind).toBe("wutai.local_file_ingestion");
  expect(files.limits.fullContentRetained).toBe(false);
  expect(files.files).toHaveLength(2);
  expect(files.files[0].sha256).toBe(sha256Hex(notes));
  expect(files.files[0].previewText).toContain("Keep the packet boundary narrow.");
  expect(audit.fileReads).toHaveLength(2);
  expect(audit.fileReads[0].contentRetention).toBe(
    "metadata_hash_and_bounded_preview_only",
  );

  await expect(
    page.getByRole("button", { name: "Re-check local file hashes" }),
  ).toBeVisible();

  await page.getByLabel("Local files re-check").setInputFiles([
    {
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(notes),
    },
    {
      name: "policy.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"policy":"changed"}\n'),
    },
  ]);

  await expect(page.getByText("Local file hash re-check failed.")).toBeVisible();
  await expect(page.getByText("1 passed, 1 failed, 0 missing.")).toBeVisible();

  const checkedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const checkArtifact = checkedTask.artifacts.find(
    (item: { name: string }) => item.name === "file-check.json",
  );
  const check = JSON.parse(checkArtifact.content);
  expect(checkedTask.status).toBe("completed_with_warnings");
  expect(check.kind).toBe("wutai.local_file_hash_check");
  expect(check.status).toBe("failed");
  expect(check.checks.map((item: { status: string }) => item.status)).toEqual([
    "passed",
    "mismatch",
  ]);
});

test("rejects local file ingestion batches over the file-count limit", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Local files", { exact: true }).setInputFiles(
    Array.from({ length: 13 }, (_, index) => ({
      name: `file-${index + 1}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`file ${index + 1}`),
    })),
  );

  await expect(
    page.getByText("Local file ingestion accepts up to 12 files at a time."),
  ).toBeVisible();

  const taskCount = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]").length,
  );
  expect(taskCount).toBe(0);
});

test("imports a CLI wrapper packet for desktop review", async ({ page }) => {
  await page.goto("/");

  const generatedAt = "2026-06-27T08:00:00.000Z";
  const taskId = "cli_fixture_review";
  const policy = {
    schemaVersion: 1,
    kind: "wutai.cli_policy_preflight",
    taskId,
    generatedAt,
    decision: "deny",
    highestSeverity: "high",
    allowHighRisk: false,
    command: 'sh -c "echo should_not_run"',
    argv: ["sh", "-c", "echo should_not_run"],
    workingDirectory: "/tmp/wutai",
    matchedRules: [
      {
        ruleId: "shell_interpreter_command_string",
        severity: "high",
        message:
          "Shell interpreter with -c can reintroduce shell expansion outside Wutai's argv boundary.",
      },
    ],
    summary: "Policy preflight denied execution before the command ran.",
  };
  const trace = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt,
    captureMode: "cli_wrapper",
    command: policy.command,
    argv: policy.argv,
    workingDirectory: policy.workingDirectory,
    executed: false,
    startedAt: generatedAt,
    completedAt: generatedAt,
    exitCode: 3,
    stdoutSummary: "No output captured.",
    stderrSummary: policy.summary,
    touchedFiles: [],
    producedArtifacts: [],
  };
  const ledger = {
    schemaVersion: 1,
    kind: "wutai.session_ledger",
    generatedAt,
    task: {
      taskId,
      title: "CLI run: sh -c \"echo should_not_run\"",
      userRequest: "Run and record local command: sh -c \"echo should_not_run\"",
      status: "cancelled",
      plan: ["Run policy preflight.", "Review imported packet."],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      events: [
        {
          eventId: `${taskId}_event_1`,
          taskId,
          timestamp: generatedAt,
          type: "TaskStarted",
          summary: "Started Wutai CLI wrapper session.",
          visibility: "user",
        },
        {
          eventId: `${taskId}_event_2`,
          taskId,
          timestamp: generatedAt,
          type: "PermissionResolved",
          summary: "Policy preflight denied this invocation before execution.",
          details: policy.summary,
          visibility: "user",
        },
      ],
      permissions: [],
      sources: [],
      artifacts: [],
    },
  };
  const audit = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt,
    permissions: [],
    policy,
    events: ledger.task.events,
    toolCalls: [],
    runtimeEvents: [],
    credentialGrants: [],
  };
  const report = `# Wutai CLI Run Packet

## Policy Preflight

- Decision: deny
- Highest severity: high
- Matched rules: shell_interpreter_command_string
`;
  const reportContent = report;
  const policyContent = JSON.stringify(policy, null, 2);
  const traceContent = JSON.stringify(trace, null, 2);
  const ledgerContent = JSON.stringify(ledger, null, 2);
  const auditContent = JSON.stringify(audit, null, 2);
  const manifest = {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${taskId}_work_packet`,
    packetType: "local_script",
    taskId,
    sessionId: taskId,
    session: {
      sessionId: taskId,
      subject: ledger.task.title,
      command: policy.command,
      workingDirectory: policy.workingDirectory,
      startedAt: generatedAt,
      completedAt: generatedAt,
      exitCode: 3,
      importedTrace: false,
    },
    title: ledger.task.title,
    status: "cancelled",
    userRequest: ledger.task.userRequest,
    generatedAt,
    producer: {
      name: "wutai",
      adapter: "wutaiRunCli",
      runtime: "node child_process spawn",
    },
    permissions: [],
    audit: {
      eventCount: 3,
      eventTypeCounts: { TaskStarted: 1 },
      permissionDecisionCount: 0,
      toolCallCount: 0,
      runtimeEventCount: 0,
      credentialPurposes: [],
      auditArtifacts: ["policy.json", "ledger.json", "audit.json"],
      policyDecision: "deny",
    },
    artifacts: [
      manifestArtifact("report.md", "markdown", reportContent, generatedAt),
      manifestArtifact("policy.json", "json", policyContent, generatedAt),
      manifestArtifact("trace.json", "json", traceContent, generatedAt),
      manifestArtifact("ledger.json", "json", ledgerContent, generatedAt),
      manifestArtifact("audit.json", "json", auditContent, generatedAt),
    ],
    evidence: { status: "not_available", readyForTrust: false },
    coverage: { captured: [], blindSpots: [], enforcement: [] },
    humanReview: { attestation: "not_recorded" },
  };

  await page.getByLabel("CLI packet files").setInputFiles([
    {
      name: "manifest.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest, null, 2)),
    },
    {
      name: "report.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(reportContent),
    },
    {
      name: "policy.json",
      mimeType: "application/json",
      buffer: Buffer.from(policyContent),
    },
    {
      name: "trace.json",
      mimeType: "application/json",
      buffer: Buffer.from(traceContent),
    },
    {
      name: "ledger.json",
      mimeType: "application/json",
      buffer: Buffer.from(ledgerContent),
    },
    {
      name: "audit.json",
      mimeType: "application/json",
      buffer: Buffer.from(auditContent),
    },
  ]);

  const cliReview = page.getByLabel("CLI Packet Review");
  await expect(cliReview).toBeVisible();
  await expect(
    cliReview.getByText("shell_interpreter_command_string", { exact: true }),
  ).toBeVisible();
  await expect(cliReview.getByText('sh -c "echo should_not_run"')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download policy.json" }),
  ).toBeVisible();
  await expect(cliReview.getByText("Manifest Integrity")).toBeVisible();
  await expect(cliReview.getByText("Verified 5 artifact hashes from the manifest.")).toBeVisible();
  await expect(
    cliReview.getByRole("heading", { name: "Packet Provenance" }),
  ).toBeVisible();
  await expect(
    cliReview.getByText(
      "Packet provenance recorded with 1 warning; the packet is not signed or trusted.",
    ),
  ).toBeVisible();
  await expect(cliReview.getByText("Audit Details")).toBeVisible();
  await expect(cliReview.getByText("Policy preflight denied this invocation before execution.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download integrity.json" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download provenance.json" }),
  ).toBeVisible();

  const importedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  expect(importedTask.taskId).toBe(taskId);
  expect(importedTask.status).toBe("cancelled");
  expect(importedTask.artifacts.map((item: { name: string }) => item.name)).toEqual([
    "report.md",
    "policy.json",
    "trace.json",
    "ledger.json",
    "audit.json",
    "manifest.json",
    "integrity.json",
    "provenance.json",
  ]);
  const integrityArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "integrity.json",
  );
  expect(JSON.parse(integrityArtifact.content).status).toBe("passed");
  const provenanceArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "provenance.json",
  );
  const provenance = JSON.parse(provenanceArtifact.content);
  expect(provenance.status).toBe("warning");
  expect(provenance.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    provenance.checks.find((check: { name: string }) => check.name === "trusted_signature")
      .status,
  ).toBe("warning");
});

test("imports a signed CLI wrapper packet and evaluates trust policy states", async ({
  page,
}) => {
  await page.goto("/");

  const generatedAt = "2026-06-27T08:20:00.000Z";
  const taskId = "cli_signed_review";
  const command = "node -e \"console.log('signed packet')\"";
  const policy = {
    schemaVersion: 2,
    kind: "wutai.cli_policy_preflight",
    policyVersion: "wutai-cli-policy-v0.2",
    taskId,
    generatedAt,
    profile: { profileId: "standard", name: "Standard" },
    decision: "allow",
    highestSeverity: "low",
    allowHighRisk: false,
    matchedRules: [],
    riskProfile: { matchedRuleCount: 0 },
    reviewScope: [],
    decisionRationale: ["Allowed because no policy rules matched this invocation."],
    summary: "Policy preflight allowed execution with no matched risk rules.",
    command,
    argv: ["node", "-e", "console.log('signed packet')"],
    workingDirectory: "/tmp/wutai",
    executionMode: "execute",
    dryRun: false,
  };
  const trace = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt,
    captureMode: "cli_wrapper",
    command,
    argv: policy.argv,
    workingDirectory: policy.workingDirectory,
    dryRun: false,
    executed: true,
    startedAt: generatedAt,
    completedAt: generatedAt,
    exitCode: 0,
    stdoutSummary: "signed packet",
    stderrSummary: "No output captured.",
    touchedFiles: [],
    producedArtifacts: [],
  };
  const events = [
    {
      eventId: `${taskId}_event_1`,
      taskId,
      timestamp: generatedAt,
      type: "TaskStarted",
      summary: "Started Wutai CLI wrapper session.",
      visibility: "user",
    },
  ];
  const ledger = {
    schemaVersion: 1,
    kind: "wutai.session_ledger",
    generatedAt,
    task: {
      taskId,
      title: "CLI run: signed packet",
      userRequest: `Run and record local command: ${command}`,
      status: "completed",
      plan: ["Run policy preflight.", "Review signed imported packet."],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      events,
      permissions: [],
      sources: [],
      artifacts: [],
    },
  };
  const audit = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt,
    permissions: [],
    policy,
    events,
    executionMode: "execute",
    toolCalls: [
      {
        toolCallId: `${taskId}_tool_1`,
        kind: "local_command",
        command,
        argv: policy.argv,
        workingDirectory: policy.workingDirectory,
        startedAt: generatedAt,
        completedAt: generatedAt,
        exitCode: 0,
      },
    ],
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "process_exit",
        timestamp: generatedAt,
        exitCode: 0,
      },
    ],
    credentialGrants: [],
  };
  const reportContent = `# Wutai CLI Run Packet

## Command

\`${command}\`

## Policy Preflight

- Decision: allow
`;
  const policyContent = JSON.stringify(policy, null, 2);
  const traceContent = JSON.stringify(trace, null, 2);
  const ledgerContent = JSON.stringify(ledger, null, 2);
  const auditContent = JSON.stringify(audit, null, 2);
  const manifest = {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${taskId}_work_packet`,
    packetType: "local_script",
    taskId,
    sessionId: taskId,
    session: {
      sessionId: taskId,
      subject: ledger.task.title,
      command,
      workingDirectory: policy.workingDirectory,
      startedAt: generatedAt,
      completedAt: generatedAt,
      exitCode: 0,
      importedTrace: false,
      executionMode: "execute",
      dryRun: false,
    },
    title: ledger.task.title,
    status: "completed",
    userRequest: ledger.task.userRequest,
    generatedAt,
    producer: {
      name: "wutai",
      adapter: "wutaiRunCli",
      runtime: "node child_process spawn",
    },
    permissions: [],
    audit: {
      eventCount: 1,
      eventTypeCounts: { TaskStarted: 1 },
      permissionDecisionCount: 0,
      toolCallCount: 1,
      runtimeEventCount: 1,
      credentialPurposes: [],
      auditArtifacts: ["policy.json", "ledger.json", "audit.json"],
      policyDecision: "allow",
      policyProfile: "standard",
      executionMode: "execute",
    },
    artifacts: [
      manifestArtifact("report.md", "markdown", reportContent, generatedAt),
      manifestArtifact("policy.json", "json", policyContent, generatedAt),
      manifestArtifact("trace.json", "json", traceContent, generatedAt),
      manifestArtifact("ledger.json", "json", ledgerContent, generatedAt),
      manifestArtifact("audit.json", "json", auditContent, generatedAt),
    ],
    evidence: { status: "not_available", readyForTrust: false },
    coverage: { captured: [], blindSpots: [], enforcement: [] },
    humanReview: { attestation: "not_recorded" },
  };
  const manifestContent = JSON.stringify(manifest, null, 2);
  const attestation = signedAttestation(
    taskId,
    generatedAt,
    manifest,
    manifestContent,
  );
  const attestationContent = JSON.stringify(attestation, null, 2);
  const packetFiles = [
    {
      name: "manifest.json",
      mimeType: "application/json",
      buffer: Buffer.from(manifestContent),
    },
    {
      name: "attestation.json",
      mimeType: "application/json",
      buffer: Buffer.from(attestationContent),
    },
    {
      name: "report.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(reportContent),
    },
    {
      name: "policy.json",
      mimeType: "application/json",
      buffer: Buffer.from(policyContent),
    },
    {
      name: "trace.json",
      mimeType: "application/json",
      buffer: Buffer.from(traceContent),
    },
    {
      name: "ledger.json",
      mimeType: "application/json",
      buffer: Buffer.from(ledgerContent),
    },
    {
      name: "audit.json",
      mimeType: "application/json",
      buffer: Buffer.from(auditContent),
    },
  ];

  await page.getByLabel("CLI packet files").setInputFiles(packetFiles);

  const cliReview = page.getByLabel("CLI Packet Review");
  await expect(cliReview).toBeVisible();
  await expect(
    cliReview.getByText(
      "Packet attestation signature verified with 1 trust warning; producer identity is not trusted.",
    ),
  ).toBeVisible();
  await expect(
    cliReview.getByText("Attestation verified", { exact: true }),
  ).toBeVisible();
  await expect(cliReview.getByText("attestation_signature")).toBeVisible();
  await expect(cliReview.getByText("trusted_key")).toBeVisible();

  const importedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  expect(importedTask.artifacts.map((item: { name: string }) => item.name)).toEqual([
    "report.md",
    "policy.json",
    "trace.json",
    "ledger.json",
    "audit.json",
    "manifest.json",
    "attestation.json",
    "integrity.json",
    "provenance.json",
  ]);
  const provenanceArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "provenance.json",
  );
  const provenance = JSON.parse(provenanceArtifact.content);
  expect(provenance.status).toBe("warning");
  expect(provenance.metrics.warnings).toBe(1);
  expect(provenance.metrics.failed).toBe(0);
  expect(provenance.attestation.present).toBe(true);
  expect(provenance.attestation.verified).toBe(true);
  expect(provenance.attestation.trustedKey).toBe(false);
  expect(
    provenance.checks.find(
      (check: { name: string }) => check.name === "attestation_signature",
    ).status,
  ).toBe("passed");
  expect(
    provenance.checks.find((check: { name: string }) => check.name === "trusted_key")
      .status,
  ).toBe("warning");

  const trustedProducerPolicy = {
    schemaVersion: 1,
    kind: "wutai.trusted_producer_policy",
    policyId: "e2e-fixture-policy",
    keys: [
      {
        keyId: "fixture-signing-key",
        label: "Fixture signing key",
        publicKeySha256: attestation.signature.publicKeySha256,
        producerAdapter: "wutaiRunCli",
        allowedPacketTypes: ["local_script"],
        status: "active",
      },
    ],
  };
  await page.getByLabel("Trusted producer policy").setInputFiles([
    {
      name: "trusted-producers.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(trustedProducerPolicy, null, 2)),
    },
  ]);
  await expect(
    page.getByText("Trusted producer policy loaded: 1 key."),
  ).toBeVisible();

  await page.getByLabel("CLI packet files").setInputFiles(packetFiles);
  await expect(
    cliReview.getByText(
      "Packet attestation signature verified and trusted producer key matched.",
    ),
  ).toBeVisible();
  await expect(
    cliReview.getByText("Trust Key Fixture signing key", { exact: true }),
  ).toBeVisible();

  const trustedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const trustedProvenanceArtifact = trustedTask.artifacts.find(
    (item: { name: string }) => item.name === "provenance.json",
  );
  const trustedProvenance = JSON.parse(trustedProvenanceArtifact.content);
  expect(trustedProvenance.status).toBe("passed");
  expect(trustedProvenance.metrics.warnings).toBe(0);
  expect(trustedProvenance.metrics.failed).toBe(0);
  expect(trustedProvenance.attestation.trustedKey).toBe(true);
  expect(trustedProvenance.trustPolicy.status).toBe("trusted");
  expect(trustedProvenance.trustPolicy.matchedKeyId).toBe("fixture-signing-key");
  expect(
    trustedProvenance.checks.find(
      (check: { name: string }) => check.name === "trusted_key",
    ).status,
  ).toBe("passed");

  const revokedProducerPolicy = {
    ...trustedProducerPolicy,
    keys: trustedProducerPolicy.keys.map((key) => ({
      ...key,
      status: "revoked",
    })),
  };
  await page.getByLabel("Trusted producer policy").setInputFiles([
    {
      name: "revoked-trusted-producers.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(revokedProducerPolicy, null, 2)),
    },
  ]);
  await page.getByLabel("CLI packet files").setInputFiles(packetFiles);

  const revokedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const revokedProvenanceArtifact = revokedTask.artifacts.find(
    (item: { name: string }) => item.name === "provenance.json",
  );
  const revokedProvenance = JSON.parse(revokedProvenanceArtifact.content);
  expect(revokedProvenance.status).toBe("failed");
  expect(revokedProvenance.metrics.failed).toBe(1);
  expect(revokedProvenance.attestation.verified).toBe(true);
  expect(revokedProvenance.attestation.trustedKey).toBe(false);
  expect(revokedProvenance.trustPolicy.status).toBe("revoked");
  expect(
    revokedProvenance.checks.find(
      (check: { name: string }) => check.name === "trusted_key",
    ).status,
  ).toBe("failed");

  const tamperedPacketFiles = packetFiles.map((file) =>
    file.name === "manifest.json"
      ? {
          ...file,
          buffer: Buffer.from(
            manifestContent.replace(
              '"status": "completed"',
              '"status": "failed"',
            ),
          ),
        }
      : file,
  );
  await page.getByLabel("CLI packet files").setInputFiles(tamperedPacketFiles);

  const tamperedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const tamperedProvenanceArtifact = tamperedTask.artifacts.find(
    (item: { name: string }) => item.name === "provenance.json",
  );
  const tamperedProvenance = JSON.parse(tamperedProvenanceArtifact.content);
  expect(tamperedProvenance.status).toBe("failed");
  expect(tamperedProvenance.attestation.verified).toBe(false);
  expect(tamperedProvenance.attestation.trustedKey).toBe(false);
  expect(tamperedProvenance.trustPolicy.status).toBe("not_evaluated");
  expect(
    tamperedProvenance.checks.find(
      (check: { name: string }) => check.name === "attestation_subject",
    ).status,
  ).toBe("failed");
  expect(
    tamperedProvenance.checks.find(
      (check: { name: string }) => check.name === "attestation_signature",
    ).status,
  ).toBe("failed");
});

test("records a dry-run packet review without desktop execution", async ({
  page,
}) => {
  await page.goto("/");

  const generatedAt = "2026-06-27T08:30:00.000Z";
  const taskId = "cli_dry_run_review";
  const command = "npm install";
  const argv = ["npm", "install"];
  const workingDirectory = "/tmp/wutai";
  const permissions = [
    {
      requestId: `${taskId}_permission_local_script_execution`,
      taskId,
      status: "pending",
      types: ["local_script_execution"],
      scope: [
        "Review the requested argv through the Wutai developer CLI wrapper without execution",
        "Apply structured policy preflight before execution",
        "Policy profile: strict",
        "Capture bounded stdout and stderr summaries",
        "No shell expansion",
        "No sandboxing",
        "No credential mediation",
      ],
      createdAt: generatedAt,
    },
    {
      requestId: `${taskId}_permission_artifact_write`,
      taskId,
      status: "approved",
      types: ["artifact_write"],
      scope: [
        "Write a new local work packet",
        "Write policy, trace, ledger, audit, report, and manifest artifacts",
        "Do not modify existing work packets",
      ],
      createdAt: generatedAt,
      resolvedAt: generatedAt,
    },
  ];
  const policy = {
    schemaVersion: 2,
    kind: "wutai.cli_policy_preflight",
    policyVersion: "wutai-cli-policy-v0.2",
    profile: {
      profileId: "strict",
      name: "Strict",
      description:
        "Deny high-risk rules and escalate medium-risk warning rules to deny.",
    },
    engine: {
      name: "wutai_cli_policy",
      version: "0.2",
      ruleCount: 8,
    },
    decision: "deny",
    highestSeverity: "medium",
    allowHighRisk: false,
    override: {
      requested: false,
      applied: false,
      reason: null,
      appliedRuleIds: [],
    },
    matchedRules: [
      {
        ruleId: "dependency_install_or_update",
        category: "dependency_mutation",
        severity: "medium",
        defaultAction: "warn",
        overrideable: false,
        message: "Dependency installation or update can modify local code or tools.",
        reviewScope: ["dependency tree", "lockfiles", "local toolchain"],
        effectiveAction: "deny",
        profileEscalated: true,
      },
    ],
    riskProfile: {
      matchedRuleCount: 1,
      severityCounts: { medium: 1 },
      defaultActionCounts: { warn: 1 },
      actionCounts: { deny: 1 },
      highestSeverity: "medium",
    },
    decisionRationale: [
      "Denied because 1 matched rule requires pre-execution review.",
      "Use --allow-high-risk only when the caller intentionally accepts the recorded boundary.",
    ],
    reviewScope: ["dependency tree", "lockfiles", "local toolchain"],
    summary: "Policy preflight denied execution before the command ran.",
    limitation:
      "This structured rule set is intentionally incomplete and is not a sandbox, credential broker, filesystem policy, or complete shell safety policy.",
    taskId,
    generatedAt,
    command,
    argv,
    workingDirectory,
    executionMode: "dry_run",
    dryRun: true,
  };
  const trace = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt,
    captureMode: "cli_wrapper",
    command,
    argv,
    workingDirectory,
    dryRun: true,
    executed: false,
    startedAt: generatedAt,
    completedAt: generatedAt,
    exitCode: null,
    stdoutSummary: "No output captured.",
    stderrSummary: "Dry-run review completed. Command was not executed.",
    touchedFiles: [],
    producedArtifacts: [],
  };
  const events = [
    {
      eventId: `${taskId}_event_1`,
      taskId,
      timestamp: generatedAt,
      type: "TaskStarted",
      summary: "Started Wutai CLI wrapper session.",
      visibility: "user",
    },
    {
      eventId: `${taskId}_event_2`,
      taskId,
      timestamp: generatedAt,
      type: "PermissionRequested",
      summary: "Declared local-script execution and policy boundary.",
      details: permissions[0].scope.join("; "),
      visibility: "user",
    },
    {
      eventId: `${taskId}_event_3`,
      taskId,
      timestamp: generatedAt,
      type: "HumanConfirmationNeeded",
      summary: "Dry-run policy review completed; execution is still pending.",
      details: policy.summary,
      visibility: "user",
    },
    {
      eventId: `${taskId}_event_4`,
      taskId,
      timestamp: generatedAt,
      type: "ArtifactCreated",
      summary: "Saved manifest, report, policy, trace, ledger, and audit artifacts.",
      visibility: "user",
    },
    {
      eventId: `${taskId}_event_5`,
      taskId,
      timestamp: generatedAt,
      type: "TaskCompleted",
      summary: "Wutai CLI wrapper dry-run review completed.",
      details: trace.stderrSummary,
      visibility: "user",
    },
  ];
  const ledger = {
    schemaVersion: 1,
    kind: "wutai.session_ledger",
    generatedAt,
    task: {
      taskId,
      title: `CLI dry-run review: ${command}`,
      userRequest: `Review local command without execution: ${command}`,
      status: "completed_with_warnings",
      plan: [
        "Run policy preflight for the explicit CLI invocation.",
        "Generate a dry-run review packet without spawning the command.",
        "Record policy profile, decision, review scope, and pending execution boundary.",
        "Save manifest, report, policy, trace, ledger, and audit artifacts.",
      ],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      events,
      permissions,
      sources: [],
      artifacts: [],
    },
  };
  const audit = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt,
    permissions,
    policy,
    events,
    executionMode: "dry_run",
    toolCalls: [],
    runtimeEvents: [],
    credentialGrants: [],
  };
  const reportContent = `# Wutai CLI Run Packet

## Command

\`${command}\`

## Policy Preflight

- Decision: deny
- Policy profile: strict
- Execution mode: dry_run
- Matched rules: dependency_install_or_update
`;
  const policyContent = JSON.stringify(policy, null, 2);
  const traceContent = JSON.stringify(trace, null, 2);
  const ledgerContent = JSON.stringify(ledger, null, 2);
  const auditContent = JSON.stringify(audit, null, 2);
  const manifest = {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${taskId}_work_packet`,
    packetType: "local_script",
    taskId,
    sessionId: taskId,
    session: {
      sessionId: taskId,
      subject: ledger.task.title,
      command,
      workingDirectory,
      startedAt: generatedAt,
      completedAt: generatedAt,
      exitCode: null,
      importedTrace: false,
      executionMode: "dry_run",
      dryRun: true,
    },
    title: ledger.task.title,
    status: ledger.task.status,
    userRequest: ledger.task.userRequest,
    generatedAt,
    producer: {
      name: "wutai",
      adapter: "wutaiRunCli",
      runtime: "node child_process spawn",
    },
    permissions,
    audit: {
      eventCount: events.length,
      eventTypeCounts: {
        TaskStarted: 1,
        PermissionRequested: 1,
        HumanConfirmationNeeded: 1,
        ArtifactCreated: 1,
        TaskCompleted: 1,
      },
      permissionDecisionCount: 1,
      toolCallCount: 0,
      runtimeEventCount: 0,
      credentialPurposes: [],
      auditArtifacts: ["policy.json", "ledger.json", "audit.json"],
      policyDecision: "deny",
      policyProfile: "strict",
      executionMode: "dry_run",
    },
    artifacts: [
      manifestArtifact("report.md", "markdown", reportContent, generatedAt),
      manifestArtifact("policy.json", "json", policyContent, generatedAt),
      manifestArtifact("trace.json", "json", traceContent, generatedAt),
      manifestArtifact("ledger.json", "json", ledgerContent, generatedAt),
      manifestArtifact("audit.json", "json", auditContent, generatedAt),
    ],
    evidence: { status: "not_available", readyForTrust: false },
    coverage: {
      captured: ["policy_preflight", "permission_record", "dry_run_review"],
      blindSpots: ["No process sandbox, filesystem policy, or credential mediation is active."],
      enforcement: ["Dry-run mode generates a review packet without executing the command."],
    },
    humanReview: { attestation: "not_recorded" },
  };

  await page.getByLabel("CLI packet files").setInputFiles([
    {
      name: "manifest.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest, null, 2)),
    },
    {
      name: "report.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(reportContent),
    },
    {
      name: "policy.json",
      mimeType: "application/json",
      buffer: Buffer.from(policyContent),
    },
    {
      name: "trace.json",
      mimeType: "application/json",
      buffer: Buffer.from(traceContent),
    },
    {
      name: "ledger.json",
      mimeType: "application/json",
      buffer: Buffer.from(ledgerContent),
    },
    {
      name: "audit.json",
      mimeType: "application/json",
      buffer: Buffer.from(auditContent),
    },
  ]);

  const dryRunReview = page.getByLabel("Dry-run Review");
  await expect(dryRunReview).toBeVisible();
  await expect(page.getByText("Permission required")).toHaveCount(0);
  await expect(
    dryRunReview.getByText(
      "Execution is still pending. Recording a decision here updates local review history only; Wutai desktop does not execute this command.",
    ),
  ).toBeVisible();
  await expect(dryRunReview.getByText("strict", { exact: true })).toBeVisible();
  await expect(dryRunReview.getByText("dry_run", { exact: true })).toBeVisible();

  await dryRunReview.getByRole("button", { name: "Record approve" }).click();

  await expect(dryRunReview.getByText("approved", { exact: true })).toBeVisible();
  await expect(
    dryRunReview.getByText(
      "Human reviewer approved the dry-run packet. Wutai desktop did not execute the command.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download review.json" }),
  ).toBeVisible();

  const reviewedTask = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    return tasks[0];
  });
  const reviewArtifact = reviewedTask.artifacts.find(
    (item: { name: string }) => item.name === "review.json",
  );
  const review = JSON.parse(reviewArtifact.content);
  const executionPermission = reviewedTask.permissions.find(
    (permission: { types: string[] }) =>
      permission.types.includes("local_script_execution"),
  );

  expect(reviewedTask.status).toBe("completed_with_warnings");
  expect(executionPermission.status).toBe("approved");
  expect(review.kind).toBe("wutai.dry_run_review");
  expect(review.decision).toBe("approved");
  expect(review.command).toBe(command);
  expect(review.policyProfile).toBe("strict");
  expect(review.executionMode).toBe("dry_run");
  expect(review.note).toContain("Wutai desktop did not execute the command.");
  expect(review.limitation).toContain("It does not execute, sandbox, or supervise");
  expect(
    reviewedTask.events.some((event: { summary: string }) =>
      event.summary.includes("Wutai desktop did not execute the command"),
    ),
  ).toBe(true);
});

test("imports a CLI wrapper packet directory and flags manifest hash mismatches", async ({
  page,
}) => {
  await page.goto("/");

  const generatedAt = "2026-06-27T09:00:00.000Z";
  const taskId = "cli_directory_mismatch";
  const policy = {
    schemaVersion: 1,
    kind: "wutai.cli_policy_preflight",
    taskId,
    generatedAt,
    decision: "allow",
    highestSeverity: "low",
    allowHighRisk: false,
    command: "echo directory_import",
    argv: ["echo", "directory_import"],
    workingDirectory: "/tmp/wutai",
    matchedRules: [],
    summary: "Policy preflight allowed execution with no matched risk rules.",
  };
  const trace = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt,
    captureMode: "cli_wrapper",
    command: policy.command,
    argv: policy.argv,
    workingDirectory: policy.workingDirectory,
    executed: true,
    startedAt: generatedAt,
    completedAt: generatedAt,
    exitCode: 0,
    stdoutSummary: "directory_import",
    stderrSummary: "No output captured.",
    touchedFiles: [],
    producedArtifacts: [],
  };
  const ledger = {
    schemaVersion: 1,
    kind: "wutai.session_ledger",
    generatedAt,
    task: {
      taskId,
      title: "CLI run: echo directory_import",
      userRequest: "Run and record local command: echo directory_import",
      status: "completed",
      plan: ["Run policy preflight.", "Review imported packet."],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      events: [
        {
          eventId: `${taskId}_event_1`,
          taskId,
          timestamp: generatedAt,
          type: "ToolCallCaptured",
          summary: "Started command: echo directory_import",
          details: "Working directory: /tmp/wutai",
          visibility: "expert",
        },
      ],
      permissions: [],
      sources: [],
      artifacts: [],
    },
  };
  const audit = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt,
    permissions: [],
    policy,
    events: ledger.task.events,
    toolCalls: [
      {
        toolCallId: `${taskId}_tool_1`,
        kind: "local_command",
        command: policy.command,
        argv: policy.argv,
        workingDirectory: policy.workingDirectory,
        startedAt: generatedAt,
        completedAt: generatedAt,
        exitCode: 0,
        captureMode: "cli_wrapper",
      },
    ],
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "process_exit",
        timestamp: generatedAt,
        exitCode: 0,
        stdoutSummary: "directory_import",
        stderrSummary: "No output captured.",
      },
    ],
    credentialGrants: [],
  };
  const reportContent = "# Wutai CLI Run Packet\n\nDirectory import fixture.\n";
  const policyContent = JSON.stringify(policy, null, 2);
  const traceContent = JSON.stringify(trace, null, 2);
  const tamperedTraceContent = JSON.stringify(
    { ...trace, stdoutSummary: "tampered after manifest" },
    null,
    2,
  );
  const ledgerContent = JSON.stringify(ledger, null, 2);
  const auditContent = JSON.stringify(audit, null, 2);
  const manifest = {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${taskId}_work_packet`,
    packetType: "local_script",
    taskId,
    sessionId: taskId,
    session: {
      sessionId: taskId,
      subject: ledger.task.title,
      command: policy.command,
      workingDirectory: policy.workingDirectory,
      startedAt: generatedAt,
      completedAt: generatedAt,
      exitCode: 0,
      importedTrace: false,
    },
    title: ledger.task.title,
    status: "completed",
    userRequest: ledger.task.userRequest,
    generatedAt,
    producer: {
      name: "wutai",
      adapter: "wutaiRunCli",
      runtime: "node child_process spawn",
    },
    permissions: [],
    audit: {
      eventCount: 3,
      eventTypeCounts: { ToolCallCaptured: 1, RuntimeEventCaptured: 1 },
      permissionDecisionCount: 0,
      toolCallCount: 1,
      runtimeEventCount: 1,
      credentialPurposes: [],
      auditArtifacts: ["policy.json", "ledger.json", "audit.json"],
      policyDecision: "allow",
    },
    artifacts: [
      manifestArtifact("report.md", "markdown", reportContent, generatedAt),
      manifestArtifact("policy.json", "json", policyContent, generatedAt),
      manifestArtifact("trace.json", "json", traceContent, generatedAt),
      manifestArtifact("ledger.json", "json", ledgerContent, generatedAt),
      manifestArtifact("audit.json", "json", auditContent, generatedAt),
    ],
    evidence: { status: "not_available", readyForTrust: false },
    coverage: { captured: [], blindSpots: [], enforcement: [] },
    humanReview: { attestation: "not_recorded" },
  };

  const packetDir = await mkdtemp(join(tmpdir(), "wutai-cli-packet-"));
  try {
    await writeFile(join(packetDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(join(packetDir, "report.md"), reportContent);
    await writeFile(join(packetDir, "policy.json"), policyContent);
    await writeFile(join(packetDir, "trace.json"), tamperedTraceContent);
    await writeFile(join(packetDir, "ledger.json"), ledgerContent);
    await writeFile(join(packetDir, "audit.json"), auditContent);

    await expect(page.getByLabel("CLI packet directory")).toHaveAttribute(
      "webkitdirectory",
      "",
    );
    await page.getByLabel("CLI packet directory").setInputFiles(packetDir);

    const cliReview = page.getByLabel("CLI Packet Review");
    await expect(cliReview).toBeVisible();
    await expect(cliReview.getByText("Manifest Integrity")).toBeVisible();
    await expect(
      cliReview.getByText("Selected artifact does not match the manifest SHA-256."),
    ).toBeVisible();
    await expect(
      cliReview.locator(".audit-detail-group").filter({ hasText: "Tool Calls" }),
    ).toBeVisible();
    await expect(
      cliReview.locator(".audit-detail-group").filter({ hasText: "Runtime Events" }),
    ).toBeVisible();
    await expect(
      cliReview.getByText("Started command: echo directory_import", { exact: true }),
    ).toBeVisible();
    await expect(
      cliReview.getByRole("heading", { name: "Packet Provenance" }),
    ).toBeVisible();
    await expect(cliReview.getByText("Showing 3 of 3 audit records.")).toBeVisible();

    const auditFilter = cliReview.getByLabel("Audit filter");
    await auditFilter.getByRole("button", { name: "Tool Calls" }).click();
    await expect(cliReview.getByText("Showing 1 of 3 audit records.")).toBeVisible();
    const toolCallGroup = cliReview
      .locator(".audit-detail-group")
      .filter({ hasText: "Tool Calls" });
    await expect(
      toolCallGroup.getByText("echo directory_import", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      cliReview.locator(".audit-detail-group").filter({ hasText: "Runtime Events" }),
    ).toHaveCount(0);

    await auditFilter.getByRole("button", { name: "Runtime Events" }).click();
    await expect(cliReview.getByText("Showing 1 of 3 audit records.")).toBeVisible();
    await expect(
      cliReview.getByText("process_exit", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      cliReview.locator(".audit-detail-group").filter({ hasText: "Tool Calls" }),
    ).toHaveCount(0);

    const integrity = await page.evaluate(() => {
      const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
      const artifact = tasks[0].artifacts.find(
        (item: { name: string }) => item.name === "integrity.json",
      );
      return JSON.parse(artifact.content);
    });
    expect(integrity.status).toBe("failed");
    expect(integrity.metrics.mismatched).toBe(1);
    expect(
      integrity.checks.find((check: { name: string }) => check.name === "trace.json")
        .status,
    ).toBe("mismatch");
    const provenance = await page.evaluate(() => {
      const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
      const artifact = tasks[0].artifacts.find(
        (item: { name: string }) => item.name === "provenance.json",
      );
      return JSON.parse(artifact.content);
    });
    expect(provenance.status).toBe("warning");
    expect(provenance.metrics.warnings).toBe(1);
  } finally {
    await rm(packetDir, { recursive: true, force: true });
  }
});
