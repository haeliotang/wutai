import { useEffect, useMemo, useRef, useState } from "react";
import { createArtifactWriter, type ArtifactWriter } from "./artifacts/artifactWriter";
import { appendEvent, createTask, type WutaiTask } from "./domain/task";
import { createResearchAdapter } from "./runtime/createResearchAdapter";
import {
  activateResearchProviderProfile,
  clearResearchProviderSetup,
  deleteResearchProviderProfile,
  getResearchProviderSetup,
  saveResearchProviderSetup,
  type EmbeddingProvider,
  type ModelProvider,
  type ResearchProviderProfile,
  type ResearchProviderSetup,
  type SearchProvider,
} from "./runtime/researchProviderSetup";
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

function newProviderProfile(): ResearchProviderProfile {
  return {
    profileId: `profile-${Date.now()}`,
    name: "New profile",
    modelProvider: "deepseek",
    model: "deepseek-v4-flash",
    modelBaseUrl: null,
    searchProvider: "tavily",
    embeddingProvider: "ollama",
    embeddingModel: "nomic-embed-text",
    embeddingBaseUrl: "http://127.0.0.1:11434",
  };
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
  const [providerSetup, setProviderSetup] =
    useState<ResearchProviderSetup | null>(null);
  const [providerProfile, setProviderProfile] =
    useState<ResearchProviderProfile | null>(null);
  const [modelAccessKey, setModelAccessKey] = useState("");
  const [webSearchKey, setWebSearchKey] = useState("");
  const [embeddingAccessKey, setEmbeddingAccessKey] = useState("");
  const [providerSetupMessage, setProviderSetupMessage] = useState<string | null>(
    null,
  );
  const [providerSetupSaving, setProviderSetupSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const store = await createTaskStore();
      const writer = createArtifactWriter();
      const adapter = createResearchAdapter();
      const items = await store.list();
      const preflight = await runPreflight(adapter);
      const setup =
        adapter.backendName === "GPT Researcher sidecar"
          ? await getResearchProviderSetup()
          : null;
      if (!active) return;
      setTaskStore(store);
      setArtifactWriter(writer);
      setResearchAdapter(adapter);
      setResearchPreflight(preflight);
      setProviderSetup(setup);
      setProviderProfile(setup?.activeProfile ?? null);
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

  function applyProviderSetup(setup: ResearchProviderSetup) {
    setProviderSetup(setup);
    setProviderProfile({ ...setup.activeProfile });
    setModelAccessKey("");
    setWebSearchKey("");
    setEmbeddingAccessKey("");
  }

  async function saveProviderSetup() {
    if (!researchAdapter || !providerProfile) return;

    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await saveResearchProviderSetup({
        profile: providerProfile,
        modelApiKey: modelAccessKey.trim() || null,
        searchApiKey: webSearchKey.trim() || null,
        embeddingApiKey: embeddingAccessKey.trim() || null,
      });
      applyProviderSetup(setup);
      setProviderSetupMessage("Provider Profile saved. Secrets stay in the system keychain.");
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(
        error instanceof Error
          ? error.message
          : "Wutai could not save research access.",
      );
    } finally {
      setProviderSetupSaving(false);
    }
  }

  async function clearProviderSetup() {
    if (!researchAdapter) return;

    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await clearResearchProviderSetup();
      applyProviderSetup(setup);
      setProviderSetupMessage("Secrets for this Provider Profile were removed.");
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(
        error instanceof Error
          ? error.message
          : "Wutai could not clear research access.",
      );
    } finally {
      setProviderSetupSaving(false);
    }
  }

  async function selectProviderProfile(profileId: string) {
    if (!researchAdapter) return;
    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await activateResearchProviderProfile(profileId);
      applyProviderSetup(setup);
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderSetupSaving(false);
    }
  }

  async function deleteProviderProfile() {
    if (!researchAdapter || !providerProfile) return;
    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await deleteResearchProviderProfile(providerProfile.profileId);
      applyProviderSetup(setup);
      setProviderSetupMessage("Provider Profile deleted.");
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderSetupSaving(false);
    }
  }

  function changeModelProvider(modelProvider: ModelProvider) {
    if (!providerProfile) return;
    const defaults: Record<ModelProvider, Pick<ResearchProviderProfile, "model" | "modelBaseUrl">> = {
      deepseek: { model: "deepseek-v4-flash", modelBaseUrl: null },
      openai: { model: "gpt-4o-mini", modelBaseUrl: null },
      "openai-compatible": {
        model: "compatible-model",
        modelBaseUrl: "https://api.example.com/v1",
      },
      ollama: { model: "qwen3:8b", modelBaseUrl: "http://127.0.0.1:11434" },
    };
    const next = { ...providerProfile, modelProvider, ...defaults[modelProvider] };
    if (modelProvider === "ollama" && next.embeddingProvider === "ollama") {
      next.embeddingBaseUrl = next.modelBaseUrl;
    }
    if (
      next.embeddingProvider === "openai" &&
      (modelProvider === "openai" || modelProvider === "openai-compatible")
    ) {
      next.embeddingBaseUrl = next.modelBaseUrl;
    }
    setProviderProfile(next);
  }

  function changeEmbeddingProvider(embeddingProvider: EmbeddingProvider) {
    if (!providerProfile) return;
    setProviderProfile({
      ...providerProfile,
      embeddingProvider,
      embeddingModel:
        embeddingProvider === "ollama"
          ? "nomic-embed-text"
          : "text-embedding-3-small",
      embeddingBaseUrl:
        embeddingProvider === "ollama"
          ? providerProfile.modelProvider === "ollama"
            ? providerProfile.modelBaseUrl
            : "http://127.0.0.1:11434"
          : providerProfile.modelProvider === "openai-compatible"
            ? providerProfile.modelBaseUrl
            : null,
    });
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
      let latestTask = nextTask;
      try {
        await researchAdapter.run(
          nextTask,
          controller.signal,
          async (task) => {
            latestTask = task;
            await persist(task);
          },
          artifactWriter,
        );
      } catch (error) {
        const wasAbort = error instanceof DOMException && error.name === "AbortError";
        const failedTask = appendEvent(
          {
            ...latestTask,
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
  const modelNeedsKey = providerProfile?.modelProvider !== "ollama";
  const searchNeedsKey = providerProfile?.searchProvider === "tavily";
  const embeddingNeedsSeparateKey =
    providerProfile?.embeddingProvider === "openai" &&
    providerProfile.modelProvider !== "openai" &&
    providerProfile.modelProvider !== "openai-compatible";
  const editingStoredProfile = Boolean(
    providerProfile &&
      providerSetup?.profiles.profiles.some(
        (profile) => profile.profileId === providerProfile.profileId,
      ),
  );
  const modelKeyIsConfigured = Boolean(
    editingStoredProfile &&
      providerSetup?.modelKeyConfigured &&
      providerProfile?.modelProvider === providerSetup.activeProfile.modelProvider,
  );
  const searchKeyIsConfigured = Boolean(
    editingStoredProfile &&
      providerSetup?.searchKeyConfigured &&
      providerProfile?.searchProvider === providerSetup.activeProfile.searchProvider,
  );
  const embeddingKeyIsConfigured = Boolean(
    editingStoredProfile &&
      providerSetup?.embeddingKeyConfigured &&
      providerProfile?.embeddingProvider ===
        providerSetup.activeProfile.embeddingProvider &&
      providerProfile?.modelProvider === providerSetup.activeProfile.modelProvider,
  );

  return (
    <main className="app-shell">
      <section className="hero-console">
        <div className="system-line">WUTAI / OBSERVE MODE</div>
        <h1>Personal computer agent shell</h1>
        <p>
          v0.1 scaffold. Natural-language task entry, task-scoped permission,
          auditable research progress, and local artifact preview.
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
              {providerProfile && providerSetup && (
                <div className="provider-setup-form" aria-label="Provider Profiles">
                  <div className="profile-toolbar">
                    <label>
                      <span>Provider Profile</span>
                      <select
                        value={
                          providerSetup.profiles.profiles.some(
                            (profile) => profile.profileId === providerProfile.profileId,
                          )
                            ? providerProfile.profileId
                            : "new"
                        }
                        onChange={(event) => {
                          if (event.target.value !== "new") {
                            void selectProviderProfile(event.target.value);
                          }
                        }}
                        disabled={providerSetupSaving}
                      >
                        {providerSetup.profiles.profiles.map((profile) => (
                          <option key={profile.profileId} value={profile.profileId}>
                            {profile.name}
                          </option>
                        ))}
                        {!providerSetup.profiles.profiles.some(
                          (profile) => profile.profileId === providerProfile.profileId,
                        ) && <option value="new">New profile</option>}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setProviderProfile(newProviderProfile());
                        setProviderSetupMessage(null);
                      }}
                      disabled={providerSetupSaving}
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={deleteProviderProfile}
                      disabled={
                        providerSetupSaving ||
                        !providerSetup.profiles.profiles.some(
                          (profile) => profile.profileId === providerProfile.profileId,
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>

                  <label>
                    <span>Profile name</span>
                    <input
                      value={providerProfile.name}
                      onChange={(event) =>
                        setProviderProfile({
                          ...providerProfile,
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Model service</span>
                    <select
                      value={providerProfile.modelProvider}
                      onChange={(event) =>
                        changeModelProvider(event.target.value as ModelProvider)
                      }
                    >
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai">OpenAI</option>
                      <option value="openai-compatible">OpenAI-compatible</option>
                      <option value="ollama">Ollama (local)</option>
                    </select>
                  </label>
                  <label>
                    <span>Model</span>
                    <input
                      value={providerProfile.model}
                      onChange={(event) =>
                        setProviderProfile({
                          ...providerProfile,
                          model: event.target.value,
                        })
                      }
                    />
                  </label>
                  {modelNeedsKey && (
                    <label>
                      <span>Model access key</span>
                      <input
                        type="password"
                        value={modelAccessKey}
                        onChange={(event) => setModelAccessKey(event.target.value)}
                        autoComplete="off"
                        placeholder={
                          modelKeyIsConfigured
                            ? "Saved - enter to replace"
                            : "Paste key"
                        }
                      />
                    </label>
                  )}
                  <label>
                    <span>Web search</span>
                    <select
                      value={providerProfile.searchProvider}
                      onChange={(event) =>
                        setProviderProfile({
                          ...providerProfile,
                          searchProvider: event.target.value as SearchProvider,
                        })
                      }
                    >
                      <option value="tavily">Tavily</option>
                      <option value="duckduckgo">DuckDuckGo (no key)</option>
                    </select>
                  </label>
                  {searchNeedsKey && (
                    <label>
                      <span>Web search key</span>
                      <input
                        type="password"
                        value={webSearchKey}
                        onChange={(event) => setWebSearchKey(event.target.value)}
                        autoComplete="off"
                        placeholder={
                          searchKeyIsConfigured
                            ? "Saved - enter to replace"
                            : "Paste key"
                        }
                      />
                    </label>
                  )}

                  <details className="provider-advanced">
                    <summary>Advanced</summary>
                    <div className="provider-advanced-grid">
                      {(providerProfile.modelProvider === "openai-compatible" ||
                        providerProfile.modelProvider === "ollama") && (
                        <label>
                          <span>Model base URL</span>
                          <input
                            value={providerProfile.modelBaseUrl ?? ""}
                            onChange={(event) => {
                              const modelBaseUrl = event.target.value || null;
                              setProviderProfile({
                                ...providerProfile,
                                modelBaseUrl,
                                embeddingBaseUrl:
                                  (providerProfile.modelProvider === "ollama" &&
                                    providerProfile.embeddingProvider === "ollama") ||
                                  (providerProfile.modelProvider === "openai-compatible" &&
                                    providerProfile.embeddingProvider === "openai")
                                    ? modelBaseUrl
                                    : providerProfile.embeddingBaseUrl,
                              });
                            }}
                          />
                        </label>
                      )}
                      <label>
                        <span>Document memory</span>
                        <select
                          value={providerProfile.embeddingProvider}
                          onChange={(event) =>
                            changeEmbeddingProvider(
                              event.target.value as EmbeddingProvider,
                            )
                          }
                        >
                          <option value="ollama">Ollama (local)</option>
                          <option value="openai">OpenAI-compatible</option>
                        </select>
                      </label>
                      <label>
                        <span>Embedding model</span>
                        <input
                          value={providerProfile.embeddingModel}
                          onChange={(event) =>
                            setProviderProfile({
                              ...providerProfile,
                              embeddingModel: event.target.value,
                            })
                          }
                        />
                      </label>
                      {!(
                        (providerProfile.modelProvider === "ollama" &&
                          providerProfile.embeddingProvider === "ollama") ||
                        (providerProfile.modelProvider === "openai-compatible" &&
                          providerProfile.embeddingProvider === "openai")
                      ) && (
                        <label>
                          <span>Embedding base URL</span>
                          <input
                            value={providerProfile.embeddingBaseUrl ?? ""}
                            onChange={(event) =>
                              setProviderProfile({
                                ...providerProfile,
                                embeddingBaseUrl: event.target.value || null,
                              })
                            }
                            placeholder={
                              providerProfile.embeddingProvider === "ollama"
                                ? "http://127.0.0.1:11434"
                                : "Optional"
                            }
                          />
                        </label>
                      )}
                      {embeddingNeedsSeparateKey && (
                        <label>
                          <span>Embedding access key</span>
                          <input
                            type="password"
                            value={embeddingAccessKey}
                            onChange={(event) =>
                              setEmbeddingAccessKey(event.target.value)
                            }
                            autoComplete="off"
                            placeholder={
                              embeddingKeyIsConfigured
                                ? "Saved - enter to replace"
                                : "Paste key"
                            }
                          />
                        </label>
                      )}
                    </div>
                  </details>

                  <div className="provider-setup-actions">
                    <button
                      type="button"
                      className="primary-action"
                      onClick={saveProviderSetup}
                      disabled={
                        providerSetupSaving ||
                        !providerProfile.name.trim() ||
                        !providerProfile.model.trim() ||
                        !providerProfile.embeddingModel.trim()
                      }
                    >
                      {providerSetupSaving ? "Saving" : "Save profile"}
                    </button>
                    <button
                      type="button"
                      onClick={clearProviderSetup}
                      disabled={providerSetupSaving || !editingStoredProfile}
                    >
                      Clear profile secrets
                    </button>
                  </div>
                  {providerSetupMessage && (
                    <p className="provider-setup-message">{providerSetupMessage}</p>
                  )}
                </div>
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
