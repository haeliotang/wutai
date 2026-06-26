import {
  appendEvent,
  type ArtifactRecord,
  type SourceRecord,
  type WutaiTask,
} from "../domain/task";
import type { ArtifactWriter } from "../artifacts/artifactWriter";
import type { EvidenceVerification } from "../domain/evidence";
import type { ResearchAdapter, TaskUpdateHandler } from "./researchAdapter";

const sources: Array<Omit<SourceRecord, "sourceId" | "taskId">> = [
  {
    title: "GPT Researcher",
    url: "https://github.com/assafelovic/gpt-researcher",
    note: "Deep research runtime candidate for v0.1.",
  },
  {
    title: "Langfuse",
    url: "https://github.com/langfuse/langfuse",
    note: "Open-source LLM observability reference for traces and evaluation.",
  },
  {
    title: "Arize Phoenix",
    url: "https://github.com/Arize-ai/phoenix",
    note: "Open-source AI observability reference for tracing and evaluation.",
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

The first Wutai release should prove a narrow supervised research loop before
adding direct browser control, coding-agent adapters, MCP proxying, or full
computer-use features. The safest starting point is a Tauri desktop console, a
task-scoped permission model, local work-packet storage, and a GPT Researcher
adapter that emits Wutai task events.

## Recommended v0.1 Boundary

- Supervision console: Tauri plus React and TypeScript.
- Local task state: SQLite through the Tauri SQL plugin, with localStorage only
  for browser preview and test runs.
- Research runtime: GPT Researcher.
- Evidence surface: report.md, sources.json, claims.json, verification.json,
  and audit.json.
- Future supervised-session wedges: coding-agent trace import, MCP proxy,
  browser-use, Codex, CUA, and Agent-S.

## Product Boundary

Wutai v0.1 should not expose MCP, skills, raw terminal output, provider setup,
or runtime logs as the default user experience. It should show the task goal,
plain progress, permissions, artifacts, source evidence, and review status.

## Sources

${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}
`;
}

export async function runMockResearchAdapter(
  initialTask: WutaiTask,
  signal: AbortSignal,
  onUpdate: TaskUpdateHandler,
  artifactWriter: ArtifactWriter,
) {
  let task: WutaiTask = {
    ...initialTask,
    status: "running" as const,
    updatedAt: new Date().toISOString(),
  };

  const steps = [
    "Preparing the research plan.",
    "Searching public sources for relevant agent governance and observability tools.",
    "Reading selected source pages.",
    "Comparing supervision and evidence-layer candidates against the v0.1 scope.",
    "Drafting the Markdown report.",
  ];

  for (const summary of steps) {
    await wait(550, signal);
    task = appendEvent(task, {
      type: "TaskStepUpdated",
      summary,
      visibility: "user",
    });
    await onUpdate(task);
  }

  const sourceRecords = sources.map((source, index) => ({
    ...source,
    sourceId: `${task.taskId}_source_${index + 1}`,
    taskId: task.taskId,
  }));

  const createdAt = new Date().toISOString();
  const report = buildReport(task);
  const claims = {
    schemaVersion: 1,
    taskId: task.taskId,
    generatedAt: createdAt,
    claims: [
      {
        claimId: "claim_001",
        text: "GPT Researcher is the selected research runtime for Wutai v0.1.",
        entity: "GPT Researcher",
        category: "product_identity",
        risk: "high",
        statementType: "factual_claim",
        support: "supported",
        evidenceSummary: "The official repository identifies GPT Researcher.",
        sources: [
          {
            url: sources[0].url,
            title: sources[0].title,
            tier: "repository",
          },
        ],
      },
    ],
  };
  const verification: EvidenceVerification = {
    schemaVersion: 1,
    taskId: task.taskId,
    status: "pass",
    readyForTrust: true,
    summary: "Evidence checks passed for the mock research fixture.",
    generatedAt: createdAt,
    metrics: {
      claimCount: 1,
      factualClaimCount: 1,
      citationCoverage: 1,
      primarySourceCount: 4,
      highRiskGapCount: 0,
      conflictCount: 0,
    },
    checks: [
      {
        key: "claim_extraction",
        label: "Claim extraction",
        status: "pass",
        message: "Captured 1 reviewable claim.",
        claimIds: [],
      },
      {
        key: "primary_evidence",
        label: "Primary evidence",
        status: "pass",
        message: "Every high-risk claim has supporting primary evidence.",
        claimIds: [],
      },
    ],
  };
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
    {
      artifactId: `${task.taskId}_artifact_claims`,
      taskId: task.taskId,
      type: "json",
      name: "claims.json",
      virtualPath: `artifacts/${task.taskId}/claims.json`,
      content: JSON.stringify(claims, null, 2),
      createdAt,
    },
    {
      artifactId: `${task.taskId}_artifact_verification`,
      taskId: task.taskId,
      type: "json",
      name: "verification.json",
      virtualPath: `artifacts/${task.taskId}/verification.json`,
      content: JSON.stringify(verification, null, 2),
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
          events: task.events,
          generatedAt: createdAt,
          adapter: "mockResearchAdapter",
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
    summary: "Saved report, sources, claims, verification, and audit artifacts.",
    details:
      artifactWriter.backendName === "Tauri app-data files"
        ? "Artifacts were written to the local Tauri app-data directory."
        : "Artifacts are available in browser preview mode. Tauri writes them to local app-data files.",
    visibility: "user",
  });

  task = appendEvent(task, {
    type: "TaskCompleted",
    summary: "Research task completed.",
    visibility: "user",
  });

  await onUpdate(task);
  return task;
}

export const mockResearchAdapter: ResearchAdapter = {
  backendName: "Mock research adapter",

  async preflight() {
    return {
      ready: true,
      summary: "Offline research preview is ready.",
      checks: [],
      fixes: [],
    };
  },

  run: runMockResearchAdapter,
};
