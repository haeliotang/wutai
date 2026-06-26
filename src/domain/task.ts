export type TaskStatus =
  | "draft"
  | "waiting_for_permission"
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled";

export type EventVisibility = "user" | "expert" | "internal";

export type PermissionType =
  | "public_web_search"
  | "public_webpage_read"
  | "artifact_write"
  | "local_script_trace_import"
  | "local_script_execution";

export type PermissionStatus = "pending" | "approved" | "denied";

export interface TaskEvent {
  eventId: string;
  taskId: string;
  timestamp: string;
  type:
    | "TaskStarted"
    | "TaskStepUpdated"
    | "PermissionRequested"
    | "PermissionResolved"
    | "HumanConfirmationNeeded"
    | "ArtifactCreated"
    | "SourceCaptured"
    | "ToolCallCaptured"
    | "RuntimeEventCaptured"
    | "CredentialGrantRecorded"
    | "ToolLogAdded"
    | "TaskCompleted"
    | "TaskFailed";
  summary: string;
  details?: string;
  visibility: EventVisibility;
}

export interface PermissionRequest {
  requestId: string;
  taskId: string;
  status: PermissionStatus;
  types: PermissionType[];
  scope: string[];
  createdAt: string;
  resolvedAt?: string;
}

export interface SourceRecord {
  sourceId: string;
  taskId: string;
  title: string;
  url: string;
  note: string;
}

export interface ArtifactRecord {
  artifactId: string;
  taskId: string;
  type: "markdown" | "json";
  name: string;
  virtualPath: string;
  content: string;
  createdAt: string;
}

export interface WutaiTask {
  taskId: string;
  title: string;
  userRequest: string;
  status: TaskStatus;
  plan: string[];
  createdAt: string;
  updatedAt: string;
  events: TaskEvent[];
  permissions: PermissionRequest[];
  sources: SourceRecord[];
  artifacts: ArtifactRecord[];
}

export function createTask(userRequest: string): WutaiTask {
  const now = new Date().toISOString();
  const taskId = `task_${Date.now().toString(36)}`;

  return {
    taskId,
    title: "Research agent work governance tools",
    userRequest,
    status: "waiting_for_permission",
    plan: [
      "Restate the research goal and define comparison criteria.",
      "Search public sources for relevant agent governance and observability tools.",
      "Read selected public project and product pages and capture source notes.",
      "Draft a concise market comparison report.",
      "Save the work packet: manifest, report, sources, claim ledger, evidence verification, and audit trail.",
    ],
    createdAt: now,
    updatedAt: now,
    events: [
      {
        eventId: `${taskId}_event_started`,
        taskId,
        timestamp: now,
        type: "TaskStarted",
        summary: "Prepared the research task and draft plan.",
        visibility: "user",
      },
      {
        eventId: `${taskId}_event_permission_requested`,
        taskId,
        timestamp: now,
        type: "PermissionRequested",
        summary: "Waiting for public web-research permission.",
        details:
          "Scope: public web search, public webpage reading, and writing new task work-packet artifacts only.",
        visibility: "user",
      },
    ],
    permissions: [
      {
        requestId: `${taskId}_permission_web_research`,
        taskId,
        status: "pending",
        types: ["public_web_search", "public_webpage_read", "artifact_write"],
        scope: [
          "Public web search",
          "Public webpage reading",
          "No login pages",
          "No form submission",
          "No existing file modification",
        ],
        createdAt: now,
      },
    ],
    sources: [],
    artifacts: [],
  };
}

export function appendEvent(
  task: WutaiTask,
  event: Omit<TaskEvent, "eventId" | "taskId" | "timestamp">,
): WutaiTask {
  const timestamp = new Date().toISOString();

  return {
    ...task,
    updatedAt: timestamp,
    events: [
      ...task.events,
      {
        ...event,
        eventId: `${task.taskId}_event_${task.events.length + 1}`,
        taskId: task.taskId,
        timestamp,
      },
    ],
  };
}
