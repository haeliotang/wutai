import type { ArtifactWriter } from "../artifacts/artifactWriter";
import {
  type ArtifactRecord,
  type PermissionRequest,
  type TaskEvent,
  type WutaiTask,
} from "../domain/task";
import { appendWorkPacketManifest } from "../domain/workPacket";

export interface CodingAgentToolCallInput {
  toolCallId?: string;
  kind: string;
  summary?: string;
  command?: string;
  path?: string;
  action?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  status?: string;
}

export interface CodingAgentFileChangeInput {
  path: string;
  action: "created" | "modified" | "deleted" | "renamed" | "unknown";
  summary?: string;
}

export interface CodingAgentTraceInput {
  schemaVersion?: number;
  kind?: "wutai.coding_agent_trace";
  agentName: string;
  agentRuntime: string;
  sessionId?: string;
  title: string;
  userRequest: string;
  repository?: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "completed_with_warnings" | "failed" | "cancelled";
  summary: string;
  toolCalls: CodingAgentToolCallInput[];
  fileChanges: CodingAgentFileChangeInput[];
  producedArtifacts?: string[];
  credentialPurposes?: string[];
  limitations?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, field: string): string;
function stringValue(
  value: unknown,
  field: string,
  options: { optional: true },
): string | undefined;
function stringValue(
  value: unknown,
  field: string,
  { optional = false }: { optional?: boolean } = {},
): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (optional) return undefined;
  throw new Error(`Coding-agent trace must provide ${field}.`);
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Coding-agent trace ${field} must be an array.`);
  }
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && Boolean(item.trim()),
    )
    .map((item) => item.trim());
}

function normalizeStatus(value: unknown): CodingAgentTraceInput["status"] {
  if (
    value === "completed" ||
    value === "completed_with_warnings" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(
    "Coding-agent trace status must be completed, completed_with_warnings, failed, or cancelled.",
  );
}

function normalizeToolCalls(value: unknown): CodingAgentToolCallInput[] {
  if (!Array.isArray(value)) {
    throw new Error("Coding-agent trace must provide a toolCalls array.");
  }
  return value.map((item, index) => {
    const tool = asRecord(item);
    if (!tool) {
      throw new Error(`Coding-agent tool call ${index + 1} must be an object.`);
    }
    const exitCode = tool.exitCode;
    if (
      exitCode !== undefined &&
      exitCode !== null &&
      typeof exitCode !== "number"
    ) {
      throw new Error(`Coding-agent tool call ${index + 1} exitCode must be numeric.`);
    }

    return {
      toolCallId: stringValue(tool.toolCallId, "toolCalls[].toolCallId", {
        optional: true,
      }),
      kind: stringValue(tool.kind, "toolCalls[].kind"),
      summary: stringValue(tool.summary, "toolCalls[].summary", {
        optional: true,
      }),
      command: stringValue(tool.command, "toolCalls[].command", {
        optional: true,
      }),
      path: stringValue(tool.path, "toolCalls[].path", { optional: true }),
      action: stringValue(tool.action, "toolCalls[].action", { optional: true }),
      startedAt: stringValue(tool.startedAt, "toolCalls[].startedAt", {
        optional: true,
      }),
      completedAt: stringValue(tool.completedAt, "toolCalls[].completedAt", {
        optional: true,
      }),
      exitCode: exitCode === undefined ? undefined : exitCode,
      status: stringValue(tool.status, "toolCalls[].status", { optional: true }),
    };
  });
}

function normalizeFileChanges(value: unknown): CodingAgentFileChangeInput[] {
  if (!Array.isArray(value)) {
    throw new Error("Coding-agent trace must provide a fileChanges array.");
  }
  const allowedActions = new Set([
    "created",
    "modified",
    "deleted",
    "renamed",
    "unknown",
  ]);
  return value.map((item, index) => {
    const change = asRecord(item);
    if (!change) {
      throw new Error(`Coding-agent file change ${index + 1} must be an object.`);
    }
    const action =
      typeof change.action === "string" && allowedActions.has(change.action)
        ? change.action
        : "unknown";

    return {
      path: stringValue(change.path, "fileChanges[].path"),
      action: action as CodingAgentFileChangeInput["action"],
      summary: stringValue(change.summary, "fileChanges[].summary", {
        optional: true,
      }),
    };
  });
}

export function parseCodingAgentTrace(content: string): CodingAgentTraceInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Coding-agent trace is not valid JSON.");
  }

  const root = asRecord(parsed);
  if (!root) {
    throw new Error("Coding-agent trace must be a JSON object.");
  }
  if (root.kind && root.kind !== "wutai.coding_agent_trace") {
    throw new Error(`Unsupported coding-agent trace kind: ${String(root.kind)}.`);
  }

  return {
    schemaVersion:
      typeof root.schemaVersion === "number" ? root.schemaVersion : 1,
    kind: "wutai.coding_agent_trace",
    agentName: stringValue(root.agentName, "agentName"),
    agentRuntime: stringValue(root.agentRuntime, "agentRuntime"),
    sessionId: stringValue(root.sessionId, "sessionId", { optional: true }),
    title: stringValue(root.title, "title"),
    userRequest: stringValue(root.userRequest, "userRequest"),
    repository: stringValue(root.repository, "repository", { optional: true }),
    startedAt: stringValue(root.startedAt, "startedAt"),
    completedAt: stringValue(root.completedAt, "completedAt"),
    status: normalizeStatus(root.status),
    summary: stringValue(root.summary, "summary"),
    toolCalls: normalizeToolCalls(root.toolCalls),
    fileChanges: normalizeFileChanges(root.fileChanges),
    producedArtifacts: stringArray(root.producedArtifacts, "producedArtifacts"),
    credentialPurposes: stringArray(root.credentialPurposes, "credentialPurposes"),
    limitations: stringArray(root.limitations, "limitations"),
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

function buildReport(task: WutaiTask, trace: CodingAgentTraceInput) {
  const changedFiles = trace.fileChanges
    .map((item) => `${item.action}: ${item.path}`)
    .join("\n");
  const toolCalls = trace.toolCalls
    .map((item) => `- ${item.kind}: ${item.summary ?? item.command ?? item.path ?? "no summary"}`)
    .join("\n");

  return `# Coding Agent Trace Import

## Session

- Agent: ${trace.agentName}
- Runtime: ${trace.agentRuntime}
- Repository: ${trace.repository ?? "not declared"}
- Started: ${trace.startedAt}
- Completed: ${trace.completedAt}
- Status: ${trace.status}

## Summary

${trace.summary}

## Tool Calls

${toolCalls || "None declared."}

## File Changes

${changedFiles || "None declared."}

## Boundary

Wutai imported this coding-agent trace after the session had run. It did not
execute the agent, approve tool calls, enforce filesystem permissions, or verify
that the trace is complete. This packet preserves the declared session evidence
for local review.

## Task

${task.userRequest}
`;
}

export async function importCodingAgentTrace(
  artifactWriter: ArtifactWriter,
  trace: CodingAgentTraceInput,
) {
  const now = new Date().toISOString();
  const taskId = `coding_agent_${Date.now().toString(36)}`;
  const credentialPurposes = trace.credentialPurposes ?? [];
  const limitations = trace.limitations ?? [];
  const permission: PermissionRequest = {
    requestId: `${taskId}_permission_trace_import`,
    taskId,
    status: "approved",
    types: ["coding_agent_trace_import", "artifact_write"],
    scope: [
      "Import metadata for an already-run coding-agent session",
      "Write new work-packet artifacts",
      "No agent execution",
      "No tool approval or replay",
      "No credential access",
    ],
    createdAt: now,
    resolvedAt: now,
  };
  const events: TaskEvent[] = [
    buildEvent(taskId, 1, now, {
      type: "TaskStarted",
      summary: "Prepared a coding-agent trace import.",
      details:
        "This flow records an already-run coding-agent session; it does not execute an agent.",
      visibility: "user",
    }),
    buildEvent(taskId, 2, now, {
      type: "PermissionRequested",
      summary: "Declared coding-agent trace-import permission boundary.",
      details: permission.scope.join("; "),
      visibility: "user",
    }),
    buildEvent(taskId, 3, now, {
      type: "PermissionResolved",
      summary: "Coding-agent trace-import permission recorded for this session.",
      visibility: "user",
    }),
    ...trace.toolCalls.slice(0, 5).map((toolCall, index) =>
      buildEvent(taskId, index + 4, now, {
        type: "ToolCallCaptured",
        summary: `Captured coding-agent tool call: ${toolCall.kind}`,
        details: toolCall.summary ?? toolCall.command ?? toolCall.path,
        visibility: "expert",
      }),
    ),
    buildEvent(taskId, 4 + Math.min(trace.toolCalls.length, 5), now, {
      type: "RuntimeEventCaptured",
      summary: `Captured coding-agent session result: ${trace.status}.`,
      details: trace.summary,
      visibility: "user",
    }),
    buildEvent(taskId, 5 + Math.min(trace.toolCalls.length, 5), now, {
      type: "ArtifactCreated",
      summary: "Saved manifest, report, trace, and audit artifacts.",
      visibility: "user",
    }),
    buildEvent(taskId, 6 + Math.min(trace.toolCalls.length, 5), now, {
      type: trace.status === "failed" ? "TaskFailed" : "TaskCompleted",
      summary: "Coding-agent trace imported.",
      visibility: "user",
    }),
  ];

  const task: WutaiTask = {
    taskId,
    title: `Imported coding-agent trace: ${trace.title}`,
    userRequest: trace.userRequest,
    status: trace.status,
    plan: [
      "Declare the coding-agent trace-import boundary.",
      "Capture declared tool calls, file changes, and credential purposes.",
      "Record imported session data in the local audit trail.",
      "Save manifest, report, trace, and audit artifacts.",
    ],
    createdAt: trace.startedAt,
    updatedAt: now,
    events,
    permissions: [permission],
    sources: [],
    artifacts: [],
  };

  const traceArtifact = {
    schemaVersion: 1,
    kind: "wutai.coding_agent_trace",
    taskId,
    generatedAt: now,
    importMode: "declared_trace",
    ...trace,
  };
  const auditArtifact = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt: now,
    permissions: [permission],
    events,
    toolCalls: trace.toolCalls.map((toolCall, index) => ({
      toolCallId: toolCall.toolCallId ?? `${taskId}_tool_${index + 1}`,
      kind: toolCall.kind,
      summary: toolCall.summary,
      command: toolCall.command,
      path: toolCall.path,
      action: toolCall.action,
      startedAt: toolCall.startedAt ?? trace.startedAt,
      completedAt: toolCall.completedAt ?? trace.completedAt,
      exitCode: toolCall.exitCode ?? null,
      status: toolCall.status ?? "declared",
      captureMode: "coding_agent_trace_import",
    })),
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "coding_agent_session_completed",
        timestamp: trace.completedAt,
        status: trace.status,
        summary: trace.summary,
      },
    ],
    credentialGrants: credentialPurposes.map((purpose, index) => ({
      grantId: `${taskId}_credential_${index + 1}`,
      purpose,
      provider: "declared_by_imported_trace",
      scope: "unknown",
      timestamp: trace.startedAt,
    })),
    fileChanges: trace.fileChanges,
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
      packetType: "coding_agent",
      producer: {
        name: "wutai",
        adapter: "codingAgentTraceImporter",
        runtime: `imported ${trace.agentName} trace`,
      },
      session: {
        sessionId: trace.sessionId ?? taskId,
        subject: trace.title,
        workingDirectory: trace.repository,
        startedAt: trace.startedAt,
        completedAt: trace.completedAt,
        exitCode: null,
        importedTrace: true,
      },
      audit: {
        toolCallCount: trace.toolCalls.length,
        runtimeEventCount: 1,
        credentialPurposes,
        auditArtifacts: ["audit.json"],
      },
      evidenceSurface: {
        unsupportedItems: [
          "The coding-agent trace is accepted as declared input; Wutai has not independently replayed or verified the session.",
          ...limitations,
        ],
        blindSpots: [
          "No tool proxy, filesystem watcher, or credential broker was active during the imported session.",
        ],
      },
      coverage: {
        captured: [
          "coding_agent_session_trace",
          "declared_tool_calls",
          "declared_file_changes",
          "declared_credential_purposes",
          "runtime_summary",
          "audit_trail",
          "artifact_hashes",
        ],
        blindSpots: [
          "Trace completeness depends on the imported file.",
          "Wutai did not enforce permissions during the coding-agent session.",
          "File contents and diffs are not captured unless the trace declares them.",
        ],
        enforcement: [
          "Trace import records the boundary after execution; it does not supervise the coding agent.",
          "No runtime tool approval, credential mediation, or filesystem policy is implemented for imported coding-agent traces.",
        ],
      },
    }),
  };

  return artifactWriter.write(taskWithArtifacts);
}
