import type { ArtifactWriter } from "../artifacts/artifactWriter";
import {
  type ArtifactRecord,
  type PermissionRequest,
  type TaskEvent,
  type WutaiTask,
} from "../domain/task";
import { appendWorkPacketManifest } from "../domain/workPacket";

export interface LocalScriptTraceInput {
  command: string;
  workingDirectory: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  stdoutSummary: string;
  stderrSummary: string;
  touchedFiles: string[];
  producedArtifacts: string[];
}

export function createSampleLocalScriptTrace(): LocalScriptTraceInput {
  const completedAt = new Date();
  const startedAt = new Date(completedAt.getTime() - 42_000);

  return {
    command: "npm run test:evidence",
    workingDirectory: "<wutai-project-root>",
    exitCode: 0,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    stdoutSummary: "Python unittest completed Evidence Gate regressions successfully.",
    stderrSummary: "No stderr output was declared in the imported trace.",
    touchedFiles: [
      "scripts/evidence_gate.py",
      "tests/python/test_evidence_gate.py",
    ],
    producedArtifacts: [],
  };
}

function buildEvent(
  taskId: string,
  index: number,
  timestamp: string,
  event: Omit<TaskEvent, "eventId" | "taskId" | "timestamp">,
): TaskEvent {
  return {
    ...event,
    eventId: `${taskId}_event_${index}`,
    taskId,
    timestamp,
  };
}

function buildReport(task: WutaiTask, trace: LocalScriptTraceInput) {
  return `# Local Script Trace Import

## Command

\`${trace.command}\`

## Result

- Working directory: \`${trace.workingDirectory}\`
- Exit code: ${trace.exitCode}
- Started: ${trace.startedAt}
- Completed: ${trace.completedAt}

## Captured Evidence

- stdout summary: ${trace.stdoutSummary}
- stderr summary: ${trace.stderrSummary}
- touched files: ${trace.touchedFiles.length ? trace.touchedFiles.join(", ") : "none declared"}
- produced artifacts: ${trace.producedArtifacts.length ? trace.producedArtifacts.join(", ") : "none declared"}

## Boundary

Wutai imported this trace after the command had run. It did not execute,
sandbox, approve, or block the command. The packet records the declared command
trace, permission boundary, audit trail, and artifact hashes so the session can
be reviewed later.

## Task

${task.userRequest}
`;
}

export async function importLocalScriptTrace(
  artifactWriter: ArtifactWriter,
  trace: LocalScriptTraceInput = createSampleLocalScriptTrace(),
) {
  const now = new Date().toISOString();
  const taskId = `local_script_${Date.now().toString(36)}`;
  const permission: PermissionRequest = {
    requestId: `${taskId}_permission_trace_import`,
    taskId,
    status: "approved",
    types: ["local_script_trace_import", "artifact_write"],
    scope: [
      "Import metadata for an already-run local command",
      "Write new work-packet artifacts",
      "No command execution",
      "No file modification outside the work packet",
      "No credential access",
    ],
    createdAt: now,
    resolvedAt: now,
  };

  const events: TaskEvent[] = [
    buildEvent(taskId, 1, now, {
      type: "TaskStarted",
      summary: "Prepared a local script trace import.",
      details: "This flow records an already-run command; it does not execute shell commands.",
      visibility: "user",
    }),
    buildEvent(taskId, 2, now, {
      type: "PermissionRequested",
      summary: "Declared trace-import permission boundary.",
      details: permission.scope.join("; "),
      visibility: "user",
    }),
    buildEvent(taskId, 3, now, {
      type: "PermissionResolved",
      summary: "Trace-import permission recorded for this session.",
      visibility: "user",
    }),
    buildEvent(taskId, 4, now, {
      type: "ToolCallCaptured",
      summary: `Captured imported command: ${trace.command}`,
      details: `Working directory: ${trace.workingDirectory}`,
      visibility: "expert",
    }),
    buildEvent(taskId, 5, now, {
      type: "RuntimeEventCaptured",
      summary: `Captured command result: exit code ${trace.exitCode}.`,
      details: trace.stdoutSummary,
      visibility: "user",
    }),
    buildEvent(taskId, 6, now, {
      type: "ArtifactCreated",
      summary: "Saved manifest, report, trace, and audit artifacts.",
      visibility: "user",
    }),
    buildEvent(taskId, 7, now, {
      type: "TaskCompleted",
      summary: "Local script trace imported.",
      visibility: "user",
    }),
  ];

  const task: WutaiTask = {
    taskId,
    title: `Imported local script trace: ${trace.command}`,
    userRequest:
      "Import a local script trace and produce a Wutai work packet without executing the command.",
    status: "completed",
    plan: [
      "Declare the trace-import boundary.",
      "Capture command metadata and runtime result from the imported trace.",
      "Record permission and runtime events in the local session ledger.",
      "Save manifest, report, trace, and audit artifacts.",
    ],
    createdAt: now,
    updatedAt: now,
    events,
    permissions: [permission],
    sources: [],
    artifacts: [],
  };

  const traceArtifact = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt: now,
    captureMode: "imported_trace",
    command: trace.command,
    workingDirectory: trace.workingDirectory,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    exitCode: trace.exitCode,
    stdoutSummary: trace.stdoutSummary,
    stderrSummary: trace.stderrSummary,
    touchedFiles: trace.touchedFiles,
    producedArtifacts: trace.producedArtifacts,
  };
  const auditArtifact = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt: now,
    permissions: [permission],
    events,
    toolCalls: [
      {
        toolCallId: `${taskId}_tool_1`,
        kind: "local_command",
        command: trace.command,
        workingDirectory: trace.workingDirectory,
        startedAt: trace.startedAt,
        completedAt: trace.completedAt,
        exitCode: trace.exitCode,
        captureMode: "imported_trace",
      },
    ],
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "process_exit",
        timestamp: trace.completedAt,
        exitCode: trace.exitCode,
        stdoutSummary: trace.stdoutSummary,
        stderrSummary: trace.stderrSummary,
      },
    ],
    credentialGrants: [],
  };
  const baseArtifacts: ArtifactRecord[] = [
    {
      artifactId: `${taskId}_artifact_report`,
      taskId,
      type: "markdown",
      name: "report.md",
      virtualPath: `artifacts/${taskId}/report.md`,
      content: buildReport(task, trace),
      createdAt: now,
    },
    {
      artifactId: `${taskId}_artifact_trace`,
      taskId,
      type: "json",
      name: "trace.json",
      virtualPath: `artifacts/${taskId}/trace.json`,
      content: JSON.stringify(traceArtifact, null, 2),
      createdAt: now,
    },
    {
      artifactId: `${taskId}_artifact_audit`,
      taskId,
      type: "json",
      name: "audit.json",
      virtualPath: `artifacts/${taskId}/audit.json`,
      content: JSON.stringify(auditArtifact, null, 2),
      createdAt: now,
    },
  ];

  const taskWithArtifacts: WutaiTask = {
    ...task,
    artifacts: await appendWorkPacketManifest({
      task: { ...task, artifacts: baseArtifacts },
      artifacts: baseArtifacts,
      createdAt: now,
      packetType: "local_script",
      producer: {
        name: "wutai",
        adapter: "localScriptTraceImporter",
        runtime: "imported local-script trace",
      },
      session: {
        subject: `Local script trace: ${trace.command}`,
        command: trace.command,
        workingDirectory: trace.workingDirectory,
        startedAt: trace.startedAt,
        completedAt: trace.completedAt,
        exitCode: trace.exitCode,
        importedTrace: true,
      },
      audit: {
        toolCallCount: 1,
        runtimeEventCount: 1,
        credentialPurposes: [],
        auditArtifacts: ["audit.json"],
      },
      evidenceSurface: {
        unsupportedItems: [
          "The trace is accepted as declared input; Wutai has not independently replayed the command.",
        ],
        blindSpots: [
          "No filesystem watcher or process sandbox is active for this imported trace.",
        ],
      },
    }),
  };

  return artifactWriter.write(taskWithArtifacts);
}
