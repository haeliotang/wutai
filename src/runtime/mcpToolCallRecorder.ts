import type { ArtifactWriter } from "../artifacts/artifactWriter";
import {
  type ArtifactRecord,
  type PermissionRequest,
  type TaskEvent,
  type WutaiTask,
} from "../domain/task";
import { appendWorkPacketManifest } from "../domain/workPacket";

const MAX_TOOL_CALLS = 100;

export interface McpToolCallInput {
  toolCallId?: string;
  serverName?: string;
  toolName: string;
  requestSummary?: string;
  argumentsPreview?: string;
  resultSummary?: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number | null;
  status: "completed" | "failed" | "cancelled" | "unknown";
  error?: string;
}

export interface McpToolCallTraceInput {
  schemaVersion?: number;
  kind?: "wutai.mcp_tool_call_trace";
  clientName?: string;
  serverName: string;
  sessionId?: string;
  title: string;
  userRequest: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "completed_with_warnings" | "failed" | "cancelled";
  summary: string;
  toolCalls: McpToolCallInput[];
  resources?: string[];
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
  throw new Error(`MCP tool-call trace must provide ${field}.`);
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`MCP tool-call trace ${field} must be an array.`);
  }
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && Boolean(item.trim()),
    )
    .map((item) => item.trim());
}

function normalizeTraceStatus(value: unknown): McpToolCallTraceInput["status"] {
  if (
    value === "completed" ||
    value === "completed_with_warnings" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(
    "MCP tool-call trace status must be completed, completed_with_warnings, failed, or cancelled.",
  );
}

function normalizeToolStatus(value: unknown): McpToolCallInput["status"] {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeToolCalls(value: unknown): McpToolCallInput[] {
  if (!Array.isArray(value)) {
    throw new Error("MCP tool-call trace must provide a toolCalls array.");
  }
  if (value.length === 0) {
    throw new Error("MCP tool-call trace must declare at least one tool call.");
  }
  if (value.length > MAX_TOOL_CALLS) {
    throw new Error(
      `MCP tool-call trace accepts up to ${MAX_TOOL_CALLS} tool calls.`,
    );
  }
  return value.map((item, index) => {
    const tool = asRecord(item);
    if (!tool) {
      throw new Error(`MCP tool call ${index + 1} must be an object.`);
    }
    const latencyMs = tool.latencyMs;
    if (
      latencyMs !== undefined &&
      latencyMs !== null &&
      typeof latencyMs !== "number"
    ) {
      throw new Error(`MCP tool call ${index + 1} latencyMs must be numeric.`);
    }
    if (typeof latencyMs === "number" && latencyMs < 0) {
      throw new Error(`MCP tool call ${index + 1} latencyMs cannot be negative.`);
    }

    return {
      toolCallId: stringValue(tool.toolCallId, "toolCalls[].toolCallId", {
        optional: true,
      }),
      serverName: stringValue(tool.serverName, "toolCalls[].serverName", {
        optional: true,
      }),
      toolName: stringValue(tool.toolName, "toolCalls[].toolName"),
      requestSummary: stringValue(
        tool.requestSummary,
        "toolCalls[].requestSummary",
        { optional: true },
      ),
      argumentsPreview: stringValue(
        tool.argumentsPreview,
        "toolCalls[].argumentsPreview",
        { optional: true },
      ),
      resultSummary: stringValue(tool.resultSummary, "toolCalls[].resultSummary", {
        optional: true,
      }),
      startedAt: stringValue(tool.startedAt, "toolCalls[].startedAt", {
        optional: true,
      }),
      completedAt: stringValue(tool.completedAt, "toolCalls[].completedAt", {
        optional: true,
      }),
      latencyMs: latencyMs === undefined ? undefined : latencyMs,
      status: normalizeToolStatus(tool.status),
      error: stringValue(tool.error, "toolCalls[].error", { optional: true }),
    };
  });
}

function assertTimestampOrder(startedAt: string, completedAt: string) {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    throw new Error("MCP tool-call trace timestamps must be valid ISO timestamps.");
  }
  if (completed < started) {
    throw new Error("MCP tool-call trace completedAt cannot be before startedAt.");
  }
}

export function parseMcpToolCallTrace(content: string): McpToolCallTraceInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("MCP tool-call trace is not valid JSON.");
  }

  const root = asRecord(parsed);
  if (!root) {
    throw new Error("MCP tool-call trace must be a JSON object.");
  }
  if (root.kind && root.kind !== "wutai.mcp_tool_call_trace") {
    throw new Error(`Unsupported MCP tool-call trace kind: ${String(root.kind)}.`);
  }

  const startedAt = stringValue(root.startedAt, "startedAt");
  const completedAt = stringValue(root.completedAt, "completedAt");
  assertTimestampOrder(startedAt, completedAt);

  return {
    schemaVersion:
      typeof root.schemaVersion === "number" ? root.schemaVersion : 1,
    kind: "wutai.mcp_tool_call_trace",
    clientName: stringValue(root.clientName, "clientName", { optional: true }),
    serverName: stringValue(root.serverName, "serverName"),
    sessionId: stringValue(root.sessionId, "sessionId", { optional: true }),
    title: stringValue(root.title, "title"),
    userRequest: stringValue(root.userRequest, "userRequest"),
    startedAt,
    completedAt,
    status: normalizeTraceStatus(root.status),
    summary: stringValue(root.summary, "summary"),
    toolCalls: normalizeToolCalls(root.toolCalls),
    resources: stringArray(root.resources, "resources"),
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

function buildReport(task: WutaiTask, trace: McpToolCallTraceInput) {
  const toolCalls = trace.toolCalls
    .map((item) => {
      const server = item.serverName ?? trace.serverName;
      const result = item.resultSummary ? ` -> ${item.resultSummary}` : "";
      return `- ${server}/${item.toolName}: ${item.requestSummary ?? "no request summary"}${result}`;
    })
    .join("\n");
  const resources = trace.resources?.length
    ? trace.resources.map((item) => `- ${item}`).join("\n")
    : "None declared.";

  return `# MCP Tool-Call Trace Import

## Session

- Client: ${trace.clientName ?? "not declared"}
- Server: ${trace.serverName}
- Started: ${trace.startedAt}
- Completed: ${trace.completedAt}
- Status: ${trace.status}

## Summary

${trace.summary}

## Tool Calls

${toolCalls || "None declared."}

## Resources

${resources}

## Boundary

Wutai imported this MCP tool-call trace after the session had run. It did not
proxy the MCP connection, approve tool calls, mediate credentials, or verify
that the trace is complete. This packet preserves the declared MCP evidence for
local review.

## Task

${task.userRequest}
`;
}

export async function importMcpToolCallTrace(
  artifactWriter: ArtifactWriter,
  trace: McpToolCallTraceInput,
) {
  const now = new Date().toISOString();
  const taskId = `mcp_trace_${Date.now().toString(36)}`;
  const credentialPurposes = trace.credentialPurposes ?? [];
  const limitations = trace.limitations ?? [];
  const permission: PermissionRequest = {
    requestId: `${taskId}_permission_trace_import`,
    taskId,
    status: "approved",
    types: ["mcp_tool_call_trace_import", "artifact_write"],
    scope: [
      "Import metadata for an already-run MCP tool-call session",
      "Write new work-packet artifacts",
      "No MCP proxying",
      "No tool approval or replay",
      "No credential access",
    ],
    createdAt: now,
    resolvedAt: now,
  };
  const events: TaskEvent[] = [
    buildEvent(taskId, 1, now, {
      type: "TaskStarted",
      summary: "Prepared an MCP tool-call trace import.",
      details:
        "This flow records already-run MCP tool calls; it does not proxy an MCP connection.",
      visibility: "user",
    }),
    buildEvent(taskId, 2, now, {
      type: "PermissionRequested",
      summary: "Declared MCP trace-import permission boundary.",
      details: permission.scope.join("; "),
      visibility: "user",
    }),
    buildEvent(taskId, 3, now, {
      type: "PermissionResolved",
      summary: "MCP trace-import permission recorded for this session.",
      visibility: "user",
    }),
    ...trace.toolCalls.slice(0, 5).map((toolCall, index) =>
      buildEvent(taskId, index + 4, now, {
        type: "ToolCallCaptured",
        summary: `Captured MCP tool call: ${toolCall.serverName ?? trace.serverName}/${toolCall.toolName}`,
        details: toolCall.requestSummary ?? toolCall.resultSummary,
        visibility: "expert",
      }),
    ),
    buildEvent(taskId, 4 + Math.min(trace.toolCalls.length, 5), now, {
      type: "RuntimeEventCaptured",
      summary: `Captured MCP session result: ${trace.status}.`,
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
      summary: "MCP tool-call trace imported.",
      visibility: "user",
    }),
  ];

  const task: WutaiTask = {
    taskId,
    title: `Imported MCP tool-call trace: ${trace.title}`,
    userRequest: trace.userRequest,
    status: trace.status,
    plan: [
      "Declare the MCP trace-import boundary.",
      "Capture declared MCP tool calls, resources, and credential purposes.",
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
    kind: "wutai.mcp_tool_call_trace",
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
      kind: "mcp_tool_call",
      serverName: toolCall.serverName ?? trace.serverName,
      toolName: toolCall.toolName,
      requestSummary: toolCall.requestSummary,
      argumentsPreview: toolCall.argumentsPreview,
      resultSummary: toolCall.resultSummary,
      startedAt: toolCall.startedAt ?? trace.startedAt,
      completedAt: toolCall.completedAt ?? trace.completedAt,
      latencyMs: toolCall.latencyMs ?? null,
      status: toolCall.status,
      error: toolCall.error,
      captureMode: "mcp_tool_call_trace_import",
    })),
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "mcp_session_completed",
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
    resources: trace.resources ?? [],
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
      packetType: "mcp_tool_call",
      producer: {
        name: "wutai",
        adapter: "mcpToolCallRecorder",
        runtime: `imported MCP trace for ${trace.serverName}`,
      },
      session: {
        sessionId: trace.sessionId ?? taskId,
        subject: trace.title,
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
          "The MCP tool-call trace is accepted as declared input; Wutai has not independently replayed or verified the session.",
          ...limitations,
        ],
        blindSpots: [
          "No MCP proxy, filesystem watcher, or credential broker was active during the imported session.",
        ],
      },
    }),
  };

  return artifactWriter.write(taskWithArtifacts);
}
