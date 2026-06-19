import { Channel, invoke } from "@tauri-apps/api/core";
import type { ArtifactRecord, SourceRecord, WutaiTask } from "../domain/task";
import { appendEvent } from "../domain/task";
import type {
  ResearchAdapter,
  ResearchPreflight,
  TaskUpdateHandler,
} from "./researchAdapter";

interface GptResearcherSource {
  title?: string;
  url: string;
  note?: string;
}

interface GptResearcherRunOutput {
  report: string;
  sources: GptResearcherSource[];
  audit: unknown;
  logs?: string[];
  progress?: GptResearcherProgressEvent[];
}

interface GptResearcherProgressEvent {
  kind: "phase" | "log";
  phase?: string;
  message: string;
}

const MAX_TASK_LOG_EVENTS = 200;
const STREAM_UPDATE_INTERVAL_MS = 200;

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Task cancelled", "AbortError");
  }
}

function expertLogSummary(log: string) {
  return log.length > 160 ? `${log.slice(0, 157)}...` : log;
}

export const gptResearcherAdapter: ResearchAdapter = {
  backendName: "GPT Researcher sidecar",

  async preflight() {
    return invoke<ResearchPreflight>("check_gpt_researcher");
  },

  async run(
    initialTask: WutaiTask,
    signal: AbortSignal,
    onUpdate: TaskUpdateHandler,
    artifactWriter,
  ) {
    const cancelSidecar = () => {
      void invoke<boolean>("cancel_gpt_researcher", {
        taskId: initialTask.taskId,
      }).catch((error) => {
        console.error("Failed to cancel GPT Researcher sidecar", error);
      });
    };

    signal.addEventListener("abort", cancelSidecar, { once: true });
    if (signal.aborted) {
      cancelSidecar();
      signal.removeEventListener("abort", cancelSidecar);
      throw new DOMException("Task cancelled", "AbortError");
    }

    let task = appendEvent(
      {
        ...initialTask,
        status: "running" as const,
        updatedAt: new Date().toISOString(),
      },
      {
        type: "TaskStepUpdated",
        summary: "Starting GPT Researcher sidecar.",
        details:
          "Wutai will call the local Python adapter and translate the result into task artifacts.",
        visibility: "user",
      },
    );
    await onUpdate(task);

    assertNotAborted(signal);

    const streamedLogCounts = new Map<string, number>();
    const seenPhases = new Set<string>();
    let observedLogCount = 0;
    let acceptChannelEvents = true;
    let streamUpdateError: unknown;
    let streamUpdatePending = false;
    let pendingPublish: ReturnType<typeof setTimeout> | undefined;
    let updateQueue = Promise.resolve();

    const publishStreamSnapshot = () => {
      if (!streamUpdatePending) return;
      streamUpdatePending = false;
      const snapshot = task;
      updateQueue = updateQueue
        .then(async () => onUpdate(snapshot))
        .catch((error) => {
          streamUpdateError ??= error;
        });
    };

    const scheduleStreamUpdate = () => {
      streamUpdatePending = true;
      if (pendingPublish !== undefined) return;
      pendingPublish = setTimeout(() => {
        pendingPublish = undefined;
        publishStreamSnapshot();
      }, STREAM_UPDATE_INTERVAL_MS);
    };

    const flushStreamUpdates = async () => {
      if (pendingPublish !== undefined) {
        clearTimeout(pendingPublish);
        pendingPublish = undefined;
      }
      publishStreamSnapshot();
      await updateQueue;
      if (streamUpdateError) {
        throw streamUpdateError;
      }
    };

    const applyProgressEvent = (event: GptResearcherProgressEvent) => {
      const message = event.message?.trim();
      if (!message) return;

      if (event.kind === "phase") {
        const phase = event.phase?.trim() || message;
        if (seenPhases.has(phase)) return;
        seenPhases.add(phase);
        task = appendEvent(task, {
          type: "TaskStepUpdated",
          summary: message,
          visibility: "user",
        });
      } else {
        observedLogCount += 1;
        if (observedLogCount > MAX_TASK_LOG_EVENTS) return;
        task = appendEvent(task, {
          type: "ToolLogAdded",
          summary: `GPT Researcher sidecar: ${expertLogSummary(message)}`,
          details: message,
          visibility: "expert",
        });
      }
      scheduleStreamUpdate();
    };

    const progressChannel = new Channel<GptResearcherProgressEvent>((event) => {
      if (!acceptChannelEvents || signal.aborted) return;
      if (event.kind === "log") {
        streamedLogCounts.set(
          event.message,
          (streamedLogCounts.get(event.message) ?? 0) + 1,
        );
      }
      applyProgressEvent(event);
    });

    task = appendEvent(task, {
      type: "TaskStepUpdated",
      summary: "Running open-source deep research adapter.",
      visibility: "user",
    });
    await onUpdate(task);

    let result: GptResearcherRunOutput;
    try {
      result = await invoke<GptResearcherRunOutput>("run_gpt_researcher", {
        input: {
          taskId: task.taskId,
          query: task.userRequest,
          reportType: "research_report",
          tone: "objective",
        },
        progress: progressChannel,
      });
    } catch (error) {
      acceptChannelEvents = false;
      await flushStreamUpdates();
      if (signal.aborted) {
        throw new DOMException("Task cancelled", "AbortError");
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      signal.removeEventListener("abort", cancelSidecar);
    }

    acceptChannelEvents = false;
    await flushStreamUpdates();
    assertNotAborted(signal);

    for (const event of result.progress ?? []) {
      applyProgressEvent(event);
    }

    for (const log of result.logs ?? []) {
      const streamedCount = streamedLogCounts.get(log) ?? 0;
      if (streamedCount > 0) {
        streamedLogCounts.set(log, streamedCount - 1);
      } else {
        applyProgressEvent({ kind: "log", message: log });
      }
    }

    if (observedLogCount > MAX_TASK_LOG_EVENTS) {
      task = appendEvent(task, {
        type: "ToolLogAdded",
        summary: "Additional sidecar logs are retained in audit.json.",
        details: `Task history keeps the first ${MAX_TASK_LOG_EVENTS} sidecar log lines. The audit artifact keeps all ${observedLogCount} captured lines.`,
        visibility: "expert",
      });
      scheduleStreamUpdate();
    }
    await flushStreamUpdates();

    const createdAt = new Date().toISOString();
    const sourceRecords: SourceRecord[] = result.sources.map((source, index) => ({
      sourceId: `${task.taskId}_source_${index + 1}`,
      taskId: task.taskId,
      title: source.title?.trim() || source.url,
      url: source.url,
      note: source.note?.trim() || "Captured by GPT Researcher.",
    }));

    const artifacts: ArtifactRecord[] = [
      {
        artifactId: `${task.taskId}_artifact_report`,
        taskId: task.taskId,
        type: "markdown",
        name: "report.md",
        virtualPath: `artifacts/${task.taskId}/report.md`,
        content: result.report,
        createdAt,
      },
      {
        artifactId: `${task.taskId}_artifact_sources`,
        taskId: task.taskId,
        type: "json",
        name: "sources.json",
        virtualPath: `artifacts/${task.taskId}/sources.json`,
        content: JSON.stringify(sourceRecords, null, 2),
        createdAt,
      },
      {
        artifactId: `${task.taskId}_artifact_audit`,
        taskId: task.taskId,
        type: "json",
        name: "audit.json",
        virtualPath: `artifacts/${task.taskId}/audit.json`,
        content: JSON.stringify(
          {
            taskId: task.taskId,
            userRequest: task.userRequest,
            permissions: task.permissions,
            adapter: "gpt-researcher",
            generatedAt: createdAt,
            sidecarAudit: result.audit,
            sidecarLogs: result.logs ?? [],
          },
          null,
          2,
        ),
        createdAt,
      },
    ];

    task = {
      ...task,
      status: "completed",
      sources: sourceRecords,
      artifacts,
      updatedAt: createdAt,
    };

    task = await artifactWriter.write(task);

    task = appendEvent(task, {
      type: "ArtifactCreated",
      summary: "Saved GPT Researcher report, sources, and audit artifacts.",
      details: "Artifacts were generated by the GPT Researcher sidecar.",
      visibility: "user",
    });

    task = appendEvent(task, {
      type: "TaskCompleted",
      summary: "Research task completed.",
      visibility: "user",
    });

    await onUpdate(task);
    return task;
  },
};
