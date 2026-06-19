import {
  appendEvent,
  type ArtifactRecord,
  type SourceRecord,
  type WutaiTask,
} from "../domain/task";

const sources: Array<Omit<SourceRecord, "sourceId" | "taskId">> = [
  {
    title: "GPT Researcher",
    url: "https://github.com/assafelovic/gpt-researcher",
    note: "Deep research runtime candidate for v0.1.",
  },
  {
    title: "browser-use",
    url: "https://github.com/browser-use/browser-use",
    note: "Browser automation candidate for v0.2.",
  },
  {
    title: "OpenAI Codex",
    url: "https://github.com/openai/codex",
    note: "Future coding and local execution adapter candidate.",
  },
  {
    title: "Tauri",
    url: "https://github.com/tauri-apps/tauri",
    note: "Desktop shell framework selected for the app scaffold.",
  },
];

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException("Task cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

function buildReport(task: WutaiTask) {
  return `# Wutai v0.1 Mock Research Report

## Request

${task.userRequest}

## Summary

The first Wutai release should prove a narrow deep-research lifecycle before
adding browser control, coding adapters, voice, or full computer-use features.
The safest starting point is a Tauri desktop shell, a task and permission
model, and a GPT Researcher adapter that emits Wutai task events.

## Recommended v0.1 Stack

- Desktop shell: Tauri.
- UI: React and TypeScript.
- Local task state: SQLite in the real adapter path; localStorage only in this
  scaffold.
- Research runtime: GPT Researcher.
- Future adapters: browser-use, Codex app-server, CUA, and Agent-S.

## Product Boundary

Wutai v0.1 should not expose MCP, skills, raw terminal output, provider setup,
or runtime logs as the default user experience. It should show the task goal,
plain progress, permissions, artifacts, and sources.

## Sources

${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}
`;
}

export async function runMockResearchAdapter(
  initialTask: WutaiTask,
  signal: AbortSignal,
  onUpdate: (task: WutaiTask) => void,
) {
  let task: WutaiTask = {
    ...initialTask,
    status: "running" as const,
    updatedAt: new Date().toISOString(),
  };

  const steps = [
    "Preparing the research plan.",
    "Searching public sources for relevant projects.",
    "Reading selected source pages.",
    "Comparing adapter candidates against the v0.1 scope.",
    "Drafting the Markdown report.",
  ];

  for (const summary of steps) {
    await wait(550, signal);
    task = appendEvent(task, {
      type: "TaskStepUpdated",
      summary,
      visibility: "user",
    });
    onUpdate(task);
  }

  const sourceRecords = sources.map((source, index) => ({
    ...source,
    sourceId: `${task.taskId}_source_${index + 1}`,
    taskId: task.taskId,
  }));

  const createdAt = new Date().toISOString();
  const report = buildReport(task);
  const artifacts: ArtifactRecord[] = [
    {
      artifactId: `${task.taskId}_artifact_report`,
      taskId: task.taskId,
      type: "markdown",
      name: "report.md",
      virtualPath: `artifacts/${task.taskId}/report.md`,
      content: report,
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
  ];

  task = {
    ...task,
    status: "completed",
    sources: sourceRecords,
    artifacts,
    updatedAt: createdAt,
  };

  task = appendEvent(task, {
    type: "ArtifactCreated",
    summary: "Saved report.md and sources.json as task artifacts.",
    details:
      "This scaffold stores artifacts in local browser state. The next storage milestone replaces this with SQLite-backed local files.",
    visibility: "user",
  });

  task = appendEvent(task, {
    type: "TaskCompleted",
    summary: "Research task completed.",
    visibility: "user",
  });

  onUpdate(task);
  return task;
}
