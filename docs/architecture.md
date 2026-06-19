# Architecture

## Overview

Wutai should own the product shell, task model, permission broker, artifact
model, and adapter contract. It should reuse open-source runtimes for actual
agent execution wherever possible.

```text
Desktop UI Shell
  -> Persona and Voice Layer
  -> Task OS Layer
  -> Agent Adapter Layer
  -> Local Permission Broker
  -> External runtimes and tools
```

## Layer Responsibilities

### Desktop UI Shell

Responsible for:

- First-run onboarding.
- Natural-language task entry.
- Task timeline.
- Permission prompts.
- Artifact browsing.
- Persona/theme controls.
- Expert log expansion.

Recommended initial stack:

- Tauri for desktop packaging.
- React and TypeScript for UI.
- SQLite for local persistence.

Electron is acceptable for rapid prototyping, but Tauri is the preferred
long-term default because the shell should feel lightweight and local-first.

### Persona and Voice Layer

Responsible for:

- Assistant name.
- Visual theme.
- Voice provider selection.
- Speaking style.
- User preference memory.
- Safety-preserving personality boundaries.

This layer must not override safety rules. A persona can change how Wutai
speaks, not what Wutai is allowed to do.

### Task OS Layer

Responsible for:

- Task creation.
- Plan review.
- Step state.
- Pause, resume, and stop.
- Artifact linkage.
- Evidence linkage.
- Human confirmation routing.
- Task history.

The task model is the core product surface. Chat is only one input method.

### Agent Adapter Layer

Responsible for wrapping external tools and runtimes into Wutai's event model.

Candidate initial adapters:

- Research: GPT Researcher or Open Deep Research.
- Browser: browser-use or Skyvern.
- Coding/local execution: Codex app-server or OpenHands.
- Computer use: CUA or Agent-S.
- Workflow automation: n8n or Activepieces.

Adapters should emit Wutai events instead of leaking runtime-specific logs into
the default UI.

### Local Permission Broker

Responsible for:

- Tracking requested capabilities.
- Scoping permissions by task.
- Recording approval status.
- Blocking unapproved actions.
- Providing an audit trail.
- Supporting stop and revoke flows.

The permission broker is not optional. It is the trust layer that lets the UI
feel powerful without being reckless.

## Event Contract

Initial event types:

```text
TaskStarted
TaskStepUpdated
PermissionRequested
HumanConfirmationNeeded
ArtifactCreated
ToolLogAdded
TaskCompleted
TaskFailed
```

Each event should include:

- `task_id`
- `event_id`
- `timestamp`
- `summary`
- `details`
- `visibility`

`visibility` should support at least:

- `user`: safe for the default timeline.
- `expert`: available when expanded.
- `internal`: persisted for debugging only when safe.

## Data Model Sketch

Core tables:

- `tasks`
- `task_events`
- `permissions`
- `artifacts`
- `sources`
- `personas`
- `settings`

The schema should favor auditability over cleverness. Users should be able to
understand what happened after a task completes.

## Implementation Sequence

1. Static product shell with onboarding screens.
2. Local task database.
3. Mock adapter that emits realistic events.
4. Permission broker flow.
5. Research adapter.
6. Artifact generation.
7. Voice and persona controls.
8. Browser/computer-use adapters.
