import { useEffect, useMemo, useRef, useState } from "react";
import { createArtifactWriter, type ArtifactWriter } from "./artifacts/artifactWriter";
import { appendEvent, createTask, type WutaiTask } from "./domain/task";
import { createResearchAdapter } from "./runtime/createResearchAdapter";
import type { ResearchAdapter, ResearchPreflight } from "./runtime/researchAdapter";
import { createTaskStore } from "./storage/createTaskStore";
import type { TaskStore } from "./storage/taskStore";

const CORE_SCENARIO =
  "Research open-source personal computer agent projects and produce a short market comparison report.";

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function downloadArtifact(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [tasks, setTasks] = useState<WutaiTask[]>([]);
  const [activeTask, setActiveTask] = useState<WutaiTask | null>(null);
  const [request, setRequest] = useState(CORE_SCENARIO);
  const [error, setError] = useState<string | null>(null);
  const [taskStore, setTaskStore] = useState<TaskStore | null>(null);
  const [artifactWriter, setArtifactWriter] = useState<ArtifactWriter | null>(null);
  const [researchAdapter, setResearchAdapter] = useState<ResearchAdapter | null>(null);
  const [researchPreflight, setResearchPreflight] =
    useState<ResearchPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const store = await createTaskStore();
      const writer = createArtifactWriter();
      const adapter = createResearchAdapter();
      const items = await store.list();
      const preflight = await runPreflight(adapter);
      if (!active) return;
      setTaskStore(store);
      setArtifactWriter(writer);
      setResearchAdapter(adapter);
      setResearchPreflight(preflight);
      setTasks(items);
      setActiveTask(items[0] ?? null);
    }

    bootstrap().catch((error) => {
      console.error(error);
      setError("Wutai failed to initialize local storage.");
    });

    return () => {
      active = false;
    };
  }, []);

  async function runPreflight(adapter: ResearchAdapter): Promise<ResearchPreflight> {
    try {
      return await adapter.preflight();
    } catch (error) {
      return {
        ready: false,
        summary: "Wutai could not check the research setup.",
        checks: [
          {
            key: "preflight",
            label: "Research setup",
            status: "fail",
            message: "The setup check did not finish.",
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
        fixes: ["Restart Wutai and run the setup check again."],
      };
    }
  }

  async function refreshResearchSetup() {
    if (!researchAdapter) return;

    setPreflightLoading(true);
    setResearchPreflight(await runPreflight(researchAdapter));
    setPreflightLoading(false);
  }

  const pendingPermission = activeTask?.permissions.find(
    (permission) => permission.status === "pending",
  );

  const reportArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((artifact) => artifact.name === "report.md") ??
      null,
    [activeTask],
  );

  async function persist(task: WutaiTask) {
    if (!taskStore) return;

    await taskStore.save(task);
    const nextTasks = await taskStore.list();
    setTasks(nextTasks);
    setActiveTask(task);
  }

  async function startTask() {
    if (!taskStore || !artifactWriter || !researchAdapter) {
      setError("Wutai is still initializing local storage.");
      return;
    }

    if (!researchPreflight || preflightLoading) {
      setError("Wutai is still checking the research setup.");
      return;
    }

    if (!researchPreflight.ready) {
      setError(researchPreflight.summary);
      return;
    }

    if (!request.trim()) {
      setError("Enter a task before starting.");
      return;
    }

    setError(null);
    const task = createTask(request.trim());
    await persist(task);
  }

  async function resolvePermission(status: "approved" | "denied") {
    if (!activeTask || !pendingPermission) return;

    const now = new Date().toISOString();
    let nextTask: WutaiTask = {
      ...activeTask,
      status: status === "approved" ? "running" : "cancelled",
      updatedAt: now,
      permissions: activeTask.permissions.map((permission) =>
        permission.requestId === pendingPermission.requestId
          ? { ...permission, status, resolvedAt: now }
          : permission,
      ),
    };

    nextTask = appendEvent(nextTask, {
      type: "PermissionResolved",
      summary:
        status === "approved"
          ? "Public web-research permission approved for this task."
          : "Public web-research permission denied. Task was not executed.",
      visibility: "user",
    });

    await persist(nextTask);

    if (status === "approved") {
      if (!artifactWriter || !researchAdapter) return;

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await researchAdapter.run(
          nextTask,
          controller.signal,
          persist,
          artifactWriter,
        );
      } catch (error) {
        const wasAbort = error instanceof DOMException && error.name === "AbortError";
        const failedTask = appendEvent(
          {
            ...nextTask,
            status: wasAbort ? "cancelled" : "failed",
            updatedAt: new Date().toISOString(),
          },
          {
            type: "TaskFailed",
            summary:
              wasAbort
                ? "Task stopped by user."
                : `${researchAdapter.backendName} failed before completion.`,
            details: error instanceof Error ? error.message : String(error),
            visibility: "user",
          },
        );
        await persist(failedTask);
      } finally {
        abortRef.current = null;
      }
    }
  }

  async function stopTask() {
    abortRef.current?.abort();
  }

  async function clearHistory() {
    if (!taskStore) return;

    await taskStore.clear();
    setTasks([]);
    setActiveTask(null);
  }

  const shouldShowResearchSetup =
    researchPreflight !== null && researchPreflight.checks.length > 0;

  return (
    <main className="app-shell">
      <section className="hero-console">
        <div className="system-line">WUTAI / OBSERVE MODE</div>
        <h1>Personal computer agent shell</h1>
        <p>
          v0.1 scaffold. Natural-language task entry, task-scoped permission,
          mock research progress, and local artifact preview.
        </p>
        <p className="runtime-line">
          Storage: {taskStore?.backendName ?? "initializing"} / Artifacts:{" "}
          {artifactWriter?.backendName ?? "initializing"} / Adapter:{" "}
          {researchAdapter?.backendName ?? "initializing"}
        </p>
      </section>

      <section className="workspace">
        <aside className="history-panel" aria-label="Task history">
          <div className="panel-header">
            <span>Task history</span>
            <button type="button" onClick={clearHistory} disabled={!tasks.length}>
              Clear
            </button>
          </div>
          <div className="task-list">
            {tasks.length === 0 ? (
              <p className="muted">No tasks yet.</p>
            ) : (
              tasks.map((task) => (
                <button
                  key={task.taskId}
                  type="button"
                  className={
                    activeTask?.taskId === task.taskId
                      ? "task-row task-row-active"
                      : "task-row"
                  }
                  onClick={() => setActiveTask(task)}
                >
                  <span>{task.title}</span>
                  <small>{task.status}</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="task-console" aria-label="Task console">
          <div className="prompt-line">
            <span>&gt;</span>
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              rows={3}
              aria-label="Task request"
            />
          </div>
          <div className="action-bar">
            <button type="button" className="primary-action" onClick={startTask}>
              Create plan
            </button>
            <button
              type="button"
              onClick={() => setRequest(CORE_SCENARIO)}
              aria-label="Restore core scenario"
            >
              Core scenario
            </button>
            <button
              type="button"
              onClick={stopTask}
              disabled={activeTask?.status !== "running"}
            >
              Stop
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}

          {shouldShowResearchSetup && (
            <section
              className={
                researchPreflight.ready
                  ? "research-setup research-setup-ready"
                  : "research-setup research-setup-blocked"
              }
              aria-label="Research setup"
            >
              <div className="panel-header">
                <h2>Research setup</h2>
                <button
                  type="button"
                  onClick={refreshResearchSetup}
                  disabled={preflightLoading}
                >
                  {preflightLoading ? "Checking" : "Recheck"}
                </button>
              </div>
              <p>{researchPreflight.summary}</p>
              <div className="preflight-checks">
                {researchPreflight.checks.map((check) => (
                  <div className="preflight-row" key={check.key}>
                    <span className={`preflight-status preflight-${check.status}`}>
                      {check.status}
                    </span>
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.message}</span>
                    </div>
                  </div>
                ))}
              </div>
              {researchPreflight.fixes.length > 0 && (
                <ul className="preflight-fixes">
                  {researchPreflight.fixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTask ? (
            <div className="task-detail">
              <div className="status-grid">
                <div>
                  <span>Status</span>
                  <strong>{activeTask.status}</strong>
                </div>
                <div>
                  <span>Sources</span>
                  <strong>{activeTask.sources.length}</strong>
                </div>
                <div>
                  <span>Artifacts</span>
                  <strong>{activeTask.artifacts.length}</strong>
                </div>
              </div>

              <section className="plan-section">
                <h2>Plan</h2>
                <ol>
                  {activeTask.plan.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>

              {pendingPermission && (
                <section className="permission-box">
                  <div>
                    <h2>Permission required</h2>
                    <p>
                      Wutai wants task-scoped public web research permission.
                      It will not access login pages, submit forms, modify
                      existing files, or control the desktop.
                    </p>
                    <ul>
                      {pendingPermission.scope.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="permission-actions">
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => resolvePermission("approved")}
                    >
                      Allow for this task
                    </button>
                    <button
                      type="button"
                      onClick={() => resolvePermission("denied")}
                    >
                      Deny
                    </button>
                  </div>
                </section>
              )}

              <section className="timeline-section">
                <h2>Timeline</h2>
                <div className="timeline">
                  {activeTask.events
                    .filter((event) => event.visibility === "user")
                    .map((event) => (
                      <div className="timeline-row" key={event.eventId}>
                        <time>{formatTime(event.timestamp)}</time>
                        <span>{event.summary}</span>
                      </div>
                    ))}
                </div>
              </section>

              {reportArtifact && (
                <section className="artifact-section">
                  <div className="panel-header">
                    <h2>Artifact preview</h2>
                    <button
                      type="button"
                      onClick={() =>
                        downloadArtifact(reportArtifact.name, reportArtifact.content)
                      }
                    >
                      Download report.md
                    </button>
                  </div>
                  <pre>{reportArtifact.content}</pre>
                </section>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <h2>Ready</h2>
              <p>
                Create the core research task to test plan, permission,
                progress, and artifact flow.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
