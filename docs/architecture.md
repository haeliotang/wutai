# Architecture

## Overview

Wutai should own the local supervision console, session ledger, permission and
credential broker, artifact model, evidence model, and adapter contract. It
should reuse open-source runtimes and provider SDKs for actual agent execution
wherever possible.

For the first implementation boundary, see
[Wutai v0.1 PRD](prd/wutai-v0.1.md) and the
[v0.1 adapter shortlist](research/adapter-shortlist-v0.1.md).

```text
Desktop Supervision Console
  -> Supervised Session Ledger
  -> Permission and Credential Broker
  -> Agent Adapter / Proxy Layer
  -> Evidence and Artifact Gate
  -> External agent runtimes and tools
```

## Layer Responsibilities

### Desktop Supervision Console

Responsible for:

- First-run onboarding.
- Natural-language task entry.
- Supervised-session timeline.
- Permission prompts.
- Artifact browsing.
- Evidence and audit browsing.
- Human review and attestation prompts.
- Expert log expansion.

Recommended initial stack:

- Tauri for desktop packaging.
- React and TypeScript for UI.
- SQLite for local persistence.

Electron is acceptable for rapid prototyping, but Tauri is the preferred
long-term default because the shell should feel lightweight and local-first.

### Supervised Session Ledger

Responsible for:

- Session and task creation.
- Plan review.
- Step state.
- Pause, resume, and stop.
- Artifact linkage.
- Evidence linkage.
- Human confirmation routing.
- Task and session history.
- Work-packet export.
- Human-attested review records.

The session ledger is the core product surface. Chat is only one input method.
The durable output is a reviewable work packet, not a transcript.

### Permission and Credential Broker

Responsible for:

- Tracking requested capabilities.
- Scoping permissions by task and session.
- Recording approval status.
- Blocking unapproved actions.
- Providing an audit trail.
- Supporting stop and revoke flows.
- Issuing task-scoped credential access where possible.
- Keeping permanent secrets in the system keychain or equivalent secure store.

The permission broker is not optional. It is the trust layer that lets Wutai
supervise powerful agents without granting broad ambient authority.

### Agent Adapter / Proxy Layer

Responsible for wrapping external tools and runtimes into Wutai's event model.

Initial adapter/proxy shapes:

- In-process adapter for a known runtime.
- CLI wrapper such as `wutai run <command>`.
- MCP proxy that records tool requests and applies policy.
- Browser extension or local browser controller.
- Filesystem watcher for work-product and diff capture.
- Trace importer for runtimes that already emit OpenTelemetry-style spans.

Candidate initial adapters:

- Research: GPT Researcher or Open Deep Research.
- Browser: browser-use or Skyvern.
- Coding/local execution: Codex app-server or OpenHands.
- Claude Code or other coding-agent trace importers.
- Computer use: CUA or Agent-S.
- Workflow automation: n8n or Activepieces.

Adapters should emit Wutai events instead of leaking runtime-specific logs into
the default UI.

### Evidence and Artifact Gate

Responsible for:

- Storing final artifacts and machine sidecars.
- Extracting or importing claims when a task produces factual content.
- Linking claims to sources and provenance.
- Recording hashes and generated-at metadata.
- Preserving blind spots and unsupported claims.
- Producing a human-readable review surface.

Evidence checks are review aids, not guarantees. A pass means the checked
claims met Wutai's configured rules; it does not mean the whole artifact is
true.

## Event Contract

Initial event types:

```text
TaskStarted
TaskStepUpdated
PermissionRequested
PermissionResolved
HumanConfirmationNeeded
ArtifactCreated
ToolCallCaptured
RuntimeEventCaptured
CredentialGrantRecorded
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
- `sessions`
- `task_events`
- `permissions`
- `credential_grants`
- `artifacts`
- `sources`
- `claims`
- `evidence_verifications`
- `human_attestations`
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
7. Evidence Gate and audit artifact.
8. Development CLI wrapper and trace importer for local-script sessions.
9. Signed packet provenance, trusted-key policy management, rule override hardening, imported external-agent trace source, MCP trace import, and local file ingestion.
10. Credential broker for task-scoped provider access.
11. Live MCP proxy, browser/computer-use adapters, and broader runtime permission enforcement.
