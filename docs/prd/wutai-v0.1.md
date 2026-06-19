# Wutai v0.1 PRD

Status: Draft for implementation planning  
Last updated: 2026-06-19  
Owner: haeliotang

## 1. Product Goal

Wutai v0.1 proves one narrow product claim:

> A non-programmer can open a desktop agent shell, describe a deep research
> task in natural language, grant scoped web-research permission, observe
> plain-language progress, and receive a durable sourced report.

v0.1 is not a general computer-control product. It is the first audited task
lifecycle.

## 2. Core Scenario

The v0.1 core scenario is:

```text
User opens Wutai.
User enters: "Research open-source personal computer agent projects and produce
a short market comparison report."
Wutai restates the goal.
Wutai proposes a research plan.
Wutai asks for permission to use public web search and read public webpages.
User approves.
Wutai runs the research adapter.
Wutai shows progress in plain language.
Wutai generates a Markdown report with sources.
User opens the report and reviews the task audit trail.
```

The product succeeds only if the user does not need to understand agents,
models, MCP, skills, browser automation, command lines, or workflow builders.

## 3. Target User

Primary v0.1 user:

- Non-programmer doing information work on a desktop.
- Comfortable asking AI for help, but not comfortable configuring agent tools.
- Wants evidence and artifacts, not just a chat answer.

Secondary user:

- Power user who wants a cleaner shell over existing open-source agent tools.

## 4. Non-goals

v0.1 will not implement:

- Full desktop takeover.
- Mouse and keyboard control.
- Voice interaction.
- Voice cloning.
- Plugin marketplace.
- Multi-agent orchestration.
- Coding tasks.
- Email sending, social posting, or form submission.
- Destructive file operations.
- Background execution across days.
- PPT, PDF, or spreadsheet generation as required outputs.

These may appear in later versions after the permission broker and audit trail
are proven.

## 5. User Experience

### 5.1 First Launch

The app opens to a minimal dark console:

```text
WUTAI

Your personal computer agent is in observe mode.

> What should I handle for you?
```

The black-console style is visual identity, not a command-line contract. The
user types natural language.

### 5.2 Onboarding

On first launch, Wutai explains:

- It starts in observe mode.
- It will ask before accessing web, files, browser, or system controls.
- v0.1 can run public web research and generate local Markdown artifacts.
- The user can stop a task at any time.
- Sensitive actions are unavailable in v0.1.

Required onboarding actions:

- Accept local task-history storage.
- Choose an artifact output folder or accept the default local app folder.
- Confirm that v0.1 may ask for web-research permission during tasks.

### 5.3 Main Task View

The default task view shows:

- Task title.
- Current status.
- Plain-language step timeline.
- Pending permission request, if any.
- Created artifacts.
- Source count.
- Stop button.

Expert logs are collapsed by default.

### 5.4 Permission Prompt

For the core scenario, Wutai asks:

```text
Wutai wants to search public webpages and read public source pages for this
task.

Scope:
- Public web search
- Public webpage reading
- No login pages
- No form submission
- No file modification

[Allow for this task] [Deny]
```

The permission is task-scoped. It does not become a permanent global grant.

### 5.5 Completion View

When the task completes, Wutai shows:

- Final report artifact.
- Source list.
- Permission summary.
- Task timeline.
- Any errors or skipped steps.

## 6. Functional Requirements

### 6.1 Task Entry

- User can create a task from natural language.
- Wutai creates a task record before execution.
- Wutai generates a short plan before requesting permission.
- User can cancel before execution.

### 6.2 Task Planning

The plan must include:

- Goal restatement.
- Research questions.
- Expected artifact.
- Required permission.
- Out-of-scope actions.

### 6.3 Permission Broker

The permission broker must support:

- Task-scoped permission requests.
- Approval and denial.
- Plain-language scope.
- Persisted decision history.
- Runtime blocking when approval is absent.

v0.1 permission types:

- `public_web_search`
- `public_webpage_read`
- `artifact_write`

### 6.4 Research Adapter

The research adapter must:

- Receive a task goal and plan.
- Use a mature open-source research runtime.
- Emit Wutai task events.
- Return a structured report draft.
- Return source metadata when available.
- Fail gracefully with a user-readable error.

### 6.5 Progress Timeline

The timeline must show user-safe summaries such as:

- "Preparing the research plan."
- "Searching public sources."
- "Reading selected source pages."
- "Drafting the report."
- "Saving the artifact."

Raw runtime logs must not be the default experience.

### 6.6 Artifact Output

The core artifact is Markdown:

- `artifacts/<task_id>/report.md`
- `artifacts/<task_id>/sources.json`
- `artifacts/<task_id>/audit.json`

Markdown is required for v0.1 because it is transparent, easy to diff, and easy
to export later.

### 6.7 Task History

The user can reopen a completed task and see:

- Original request.
- Plan.
- Permission decisions.
- Timeline.
- Artifacts.
- Sources.

## 7. Technical Direction

Wutai must not rebuild mature infrastructure unless there is a strong product
reason. v0.1 should wrap existing open-source tools behind Wutai-owned product
contracts.

### 7.1 Selected v0.1 Stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Desktop shell | Tauri | Mature open-source desktop shell with lightweight local app model. |
| UI | React + TypeScript | Mature UI ecosystem and fast iteration. |
| Local storage | SQLite via Tauri SQL plugin | Local, durable task and audit storage without rebuilding database infrastructure. |
| Credential storage | System keychain via keyring-rs | Saves provider access keys without building a custom secret store. |
| Research runtime | GPT Researcher sidecar with setup preflight | Mature open-source deep research agent; Apache-2.0. Wutai owns the task UX, setup explanation, and permission model, not the research engine. |
| Browser automation | Not required in v0.1 core path | Add later through browser-use if the research workflow needs direct browser control. |
| Coding/local execution | Not required in v0.1 | Add later through Codex app-server adapter. |
| Computer use | Not required in v0.1 | Add later through CUA or Agent-S after stronger safety controls. |

See [Adapter Shortlist](../research/adapter-shortlist-v0.1.md).

### 7.2 Wutai Event Contract

The adapter boundary uses these events:

- `TaskStarted`
- `TaskStepUpdated`
- `PermissionRequested`
- `PermissionResolved`
- `ArtifactCreated`
- `SourceCaptured`
- `ToolLogAdded`
- `TaskCompleted`
- `TaskFailed`

Every event includes:

- `event_id`
- `task_id`
- `timestamp`
- `summary`
- `details`
- `visibility`

`visibility` values:

- `user`
- `expert`
- `internal`

### 7.3 Data Model

Minimum local tables:

- `tasks`
- `task_events`
- `permission_requests`
- `artifacts`
- `sources`
- `settings`

Minimum task states:

- `draft`
- `waiting_for_permission`
- `running`
- `completed`
- `failed`
- `cancelled`

### 7.4 Adapter Rule

External runtime output must be translated before it reaches the default UI.

Do not show:

```text
Calling tool search_web with payload...
```

Show:

```text
Searching public sources for relevant projects.
```

## 8. Safety Requirements

v0.1 starts in observe mode.

Allowed after approval:

- Public web research.
- Public webpage reading.
- Writing new artifacts into the configured output folder.

Blocked in v0.1:

- Reading arbitrary local folders.
- Modifying existing user files.
- Sending messages.
- Submitting forms.
- Installing software.
- Changing system settings.
- Operating mouse or keyboard.
- Accessing credentials.

The stop button must be visible while a task is running.

## 9. Acceptance Criteria

The v0.1 core scenario is complete when:

1. A user can launch the app shell.
2. The app shows observe-mode onboarding.
3. A user can enter the core research request.
4. Wutai creates a persisted task record.
5. Wutai shows a generated plan before execution.
6. Wutai asks for task-scoped web-research permission.
7. Denying permission prevents execution and records the decision.
8. Approving permission starts the research adapter.
9. Progress appears as plain-language timeline events.
10. The task creates `report.md`, `sources.json`, and `audit.json`.
11. The completion view links to the artifact.
12. The user can reopen the task and inspect the audit trail.
13. No default offline flow exposes MCP, skills, raw terminal output, or
    provider setup.
14. No v0.1 flow performs file modification, desktop control, email sending, or
    form submission.

## 10. Implementation Milestones

### Milestone 1: Static Shell and Local Model

- Tauri app scaffold.
- React dark console UI.
- SQLite task database.
- Mock task adapter emitting Wutai events.
- Onboarding copy.

### Milestone 2: Permission Broker

- Task-scoped permission request UI.
- Permission persistence.
- Permission-denied path.
- Stop control.

### Milestone 3: Research Adapter

- GPT Researcher adapter.
- Event translation.
- Markdown report artifact.
- Source and audit files.

### Milestone 4: Core Scenario QA

- Run the full core scenario.
- Verify artifacts exist.
- Verify denied permission blocks execution.
- Verify no raw expert concepts appear in the default UI.
- Verify task reopen works.

## 11. Future Roadmap

v0.2 candidates:

- browser-use adapter for direct browser workflows.
- PDF export.
- Local file ingestion for user-selected files.
- Persona/theme settings.

v0.3 candidates:

- Codex app-server adapter for local code or file tasks.
- Voice output.
- Multi-step task resume.
- Rich artifact library.

Later candidates:

- CUA or Agent-S computer-use adapter.
- n8n or Activepieces workflow automation adapter.
- Stronger policy engine for high-risk actions.
- User-created task templates.

## 12. Open Questions

- Should v0.1 use GPT Researcher as an embedded dependency, a sidecar process,
  or an adapter service?
- Should generated artifacts live in the repo-style `artifacts/` folder or an
  OS app-data directory by default?
- Which LLM provider is the initial default for research tasks?
- Should v0.1 support only API-key auth, or also local model providers?
- What is the minimum acceptable source-quality filter for generated reports?
