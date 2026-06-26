# Wutai Agent Guidance

## Product Boundary

Wutai is a local trust and evidence layer for agentic work on personal
computers. Keep the user-facing surface focused on supervised sessions,
permissions, credentials, progress, evidence, artifacts, audit trails, and
human review. Do not expose MCP, skills, provider settings, terminal output, or
tool traces as primary UX unless the task explicitly targets expert mode.

Wutai should not be framed as the agent that does all work itself. It should
supervise agentic work by recording what happened, controlling sensitive access,
and producing durable work packets.

## Engineering Boundary

Prefer adapter-first integration over rebuilding existing agent infrastructure.
When possible, wrap external runtimes behind a Wutai-owned event contract:

- `TaskStarted`
- `TaskStepUpdated`
- `PermissionRequested`
- `HumanConfirmationNeeded`
- `ArtifactCreated`
- `ToolLogAdded`
- `TaskCompleted`
- `TaskFailed`

Backend capabilities must remain swappable. Do not bind the product model to a
single provider, model, or agent runtime.

For new integrations, prefer thin wrappers and proxies that preserve Wutai's
local ledger and permission boundary:

- CLI wrapper
- MCP proxy
- filesystem watcher
- browser extension
- keychain or credential broker
- trace importer

## Safety Boundary

Do not describe Wutai as "fully taking over the computer" or "running every
agent locally" without also stating the control boundary. The intended model is
a permissioned local supervision layer: observable by default, scoped by task,
stoppable by the user, and auditable after execution.

High-risk actions require explicit confirmation:

- Sending messages, email, or posts.
- Deleting, overwriting, moving, or publishing files.
- Installing software or changing system settings.
- Making purchases or payments.
- Sharing private data with external services.
- Granting credentials or long-lived tokens to an external runtime.

When an external runtime cannot enforce Wutai's permission boundary, document it
as experimental and keep it out of the default non-expert path.

## Documentation Standard

For product or architecture updates, include acceptance criteria before
implementation claims. Separate:

- implemented behavior
- planned behavior
- demo-only behavior
- external runtime capability

Do not overclaim that an adapter capability is available until there is code,
configuration, and a runnable verification path in this repo.
