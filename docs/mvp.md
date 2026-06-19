# MVP Definition

## Objective

Build the smallest Wutai version that proves a non-programmer can start a
desktop-grade task, grant scoped permissions, observe progress, and receive a
durable artifact without seeing developer-facing agent complexity.

The implementation source of truth for the first release is
[Wutai v0.1 PRD](prd/wutai-v0.1.md).

## Candidate MVP Workflow

Deep research is the recommended first workflow because it tests task planning,
browser/search integration, evidence capture, artifact generation, and long
running progress without requiring dangerous desktop control.

Example task:

```text
Research open-source personal computer agent projects and produce a short
market report with sources.
```

## User-facing Requirements

- A desktop shell opens into a minimal command-console style UI.
- The user can describe a task in natural language.
- Wutai converts the request into a readable plan before execution.
- Wutai requests permission before using browser/search or reading local files.
- The user can approve, deny, or scope each permission request.
- Progress is shown in plain language.
- Raw logs are available in an expanded expert view, not the default view.
- The task produces at least one durable artifact.
- The task can be reopened from history.

## Technical Requirements

- A local app shell exists.
- A task record is persisted locally.
- A permission request object is persisted with status and scope.
- An artifact record is persisted with path, type, source task, and creation
  timestamp.
- At least one backend adapter can run through the Wutai task event contract.
- The adapter emits enough events to render a useful progress timeline.
- The app can run without exposing API keys or local secrets in logs.

## Safety Requirements

- Wutai starts in observe-only mode.
- File access is limited to user-approved files or folders.
- Browser/search access is explicit.
- High-risk actions are unavailable in the MVP unless gated behind a
  confirmation flow.
- The app includes a visible stop control during task execution.
- The final artifact includes source notes when external sources are used.

## Acceptance Criteria

The MVP is acceptable when a fresh user can:

1. Launch Wutai.
2. Complete onboarding for basic permissions.
3. Start a research task from natural language.
4. Review and approve the generated plan.
5. Watch progress without understanding tools or protocols.
6. Open the generated artifact.
7. Review which permissions and sources were used.
8. Resume or revisit the task later.

## Out of Scope

- Fully autonomous desktop takeover.
- Background execution across days.
- Voice cloning.
- App store or marketplace.
- Custom plugin authoring UI.
- Multi-agent orchestration UI.
- Payments, email sending, social posting, or destructive file operations.
