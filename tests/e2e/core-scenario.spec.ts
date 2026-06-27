import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
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
  await expect(cliReview.getByText("Audit Details")).toBeVisible();
  await expect(cliReview.getByText("Policy preflight denied this invocation before execution.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download integrity.json" }),
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
  ]);
  const integrityArtifact = importedTask.artifacts.find(
    (item: { name: string }) => item.name === "integrity.json",
  );
  expect(JSON.parse(integrityArtifact.content).status).toBe("passed");
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
    await expect(cliReview.getByText("Tool Calls", { exact: true })).toBeVisible();
    await expect(cliReview.getByText("Runtime Events", { exact: true })).toBeVisible();
    await expect(
      cliReview.getByText("Started command: echo directory_import", { exact: true }),
    ).toBeVisible();

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
  } finally {
    await rm(packetDir, { recursive: true, force: true });
  }
});
