# Wutai v0.1 PRD

Status: Draft for implementation planning  
Last updated: 2026-06-27
Owner: haeliotang

## 1. Product Goal

Wutai v0.1 proves one narrow product claim:

> A user can run a bounded agentic research task under local supervision, grant
> scoped web-research permission, observe plain-language progress, and receive
> a durable work packet with artifacts, sources, claims, evidence checks, and
> an audit trail.

v0.1 is not a general computer-control product and not a general agent
orchestrator. It is the first audited supervised-session lifecycle.

## 2. Core Scenario

The v0.1 core scenario is:

```text
User opens Wutai.
User enters: "Research agent work governance tools and produce a short market
comparison report."
Wutai restates the goal.
Wutai proposes a research plan.
Wutai asks for permission to use public web search and read public webpages.
User approves.
Wutai runs the research adapter.
Wutai shows progress in plain language.
Wutai generates a work packet: report, sources, claims, verification, and audit.
User opens the work packet and reviews the evidence and task audit trail.
```

The product succeeds only if the user can review what happened without
understanding agents, models, MCP, skills, browser automation, command lines, or
workflow builders.

## 3. Target User

Primary v0.1 user:

- Power user or non-programmer doing information work on a desktop.
- Comfortable asking AI for help, but not comfortable auditing raw agent logs.
- Wants evidence, artifacts, and a local audit trail, not just a chat answer.

Secondary user:

- Developer or maintainer who wants an early supervised-session loop over
  agentic work.

## 4. Non-goals

v0.1 will not implement:

- Full desktop takeover.
- Mouse and keyboard control.
- Voice interaction.
- Voice cloning.
- Plugin marketplace.
- Multi-agent orchestration.
- General-purpose MCP proxy.
- Cross-agent credential broker.
- Coding tasks.
- Email sending, social posting, or form submission.
- Destructive file operations.
- Background execution across days.
- PPT, PDF, or spreadsheet generation as required outputs.

These may appear in later versions after the permission broker, credential
boundary, and audit trail are proven.

## 5. User Experience

### 5.1 First Launch

The app opens to a minimal dark console:

```text
WUTAI

Local supervision is in observe mode.

> What agent work should I supervise?
```

The black-console style is visual identity, not a command-line contract. The
user types natural language.

### 5.2 Onboarding

On first launch, Wutai explains:

- It starts in observe mode.
- It will ask before accessing web, files, browser, or system controls.
- v0.1 can run supervised public web research and generate a local work packet.
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
- Evidence Gate status.
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
- Claim ledger.
- Evidence verification summary.
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

The core output is a work packet:

- `artifacts/<task_id>/report.md`
- `artifacts/<task_id>/sources.json`
- `artifacts/<task_id>/claims.json`
- `artifacts/<task_id>/verification.json`
- `artifacts/<task_id>/audit.json`
- `artifacts/<task_id>/manifest.json`

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
- Claims and evidence verification.
- Audit metadata.

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
| Provider configuration | Wutai Provider Profiles | Keeps model, search, and embedding choices independent while hiding endpoint details from the default flow. |
| Research runtime | GPT Researcher sidecar with setup preflight | Mature open-source deep research agent; Apache-2.0. Wutai owns the task UX, setup explanation, and permission model, not the research engine. |
| Browser automation | Not required in v0.1 core path | Add later through browser-use if the research workflow needs direct browser control. |
| Coding/local execution | Not required in v0.1 | Add later through Codex app-server adapter. |
| External trace import / CLI wrapper | Local-script trace import, developer CLI wrapper with structured policy preflight, external profile config, dry-run review packets, optional signed packet attestation, UI packet review, manifest hash check, packet provenance check, and filtered audit detail browsing in v0.2 foundation | Extend later to Claude Code, Codex, or other agent traces after the work-packet schema is stable. |
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
- `claims`
- `evidence_verifications`
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
- Accessing arbitrary user secrets, wallets, passwords, or credential stores
  outside configured Provider Profiles.
- Passing raw provider keys to an unmediated external runtime.

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
10. The task creates `manifest.json`, `report.md`, `sources.json`,
    `claims.json`, `verification.json`, and `audit.json`.
11. The completion view links to the work packet.
12. The user can reopen the task and inspect the audit trail.
13. No default offline flow exposes MCP, skills, raw terminal output, or
    provider setup.
14. No v0.1 flow performs file modification, desktop control, email sending, or
    form submission.
15. A real-research user can save, switch, and delete Provider Profiles without
    storing API keys in the profile metadata file.
16. Model, search, and embedding providers can be changed independently, while
    Base URL and embedding controls remain under Advanced settings.
17. A report with missing primary evidence or locked reference-fact conflicts
    is shown as needing review rather than fully trusted.
18. Evidence verification distinguishes factual claims, vendor claims,
    third-party observations, and inferences.

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
- Claim ledger and evidence verification artifacts.
- Visible `completed_with_warnings` state for reports that need evidence review.
- Provider Profiles for DeepSeek, OpenAI, OpenAI-compatible endpoints, and
  Ollama-backed local models.

### Milestone 4: Core Scenario QA

- Run the full core scenario.
- Verify artifacts exist.
- Verify denied permission blocks execution.
- Verify no raw expert concepts appear in the default UI.
- Verify task reopen works.

## 11. Future Roadmap

v0.2 candidates:

- Work-packet manifest hardening for sessions beyond research, imported local-script traces, and developer CLI wrapper runs.
- Trusted-key policy for signed packet provenance, external rule overrides, or coding-agent trace importer for one external workflow.
- Local file ingestion for user-selected files.
- PDF export.

v0.3 candidates:

- MCP proxy or tool-call recorder for supervised agent sessions.
- Credential broker for task-scoped provider access.
- Codex, Claude Code, or similar coding-agent adapter.
- Rich artifact and audit library.

Later candidates:

- CUA or Agent-S computer-use adapter.
- n8n or Activepieces workflow automation adapter.
- Stronger policy engine for high-risk actions.
- User-created task templates.
- Mobile approval companion for high-risk confirmations.

## 12. Open Questions

- Should v0.1 use GPT Researcher as an embedded dependency, a sidecar process,
  or an adapter service?
- Should generated artifacts live in the repo-style `artifacts/` folder or an
  OS app-data directory by default?
- What is the minimum acceptable source-quality filter for generated reports?
- How should the current work-packet manifest evolve from research and
  local-script trace import to coding and browser work without becoming
  enterprise telemetry?
