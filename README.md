# Wutai

Wutai is a local trust and evidence layer for agentic work on personal
computers.

It is designed for the point where an agent stops being a chat answer and starts
touching local files, provider credentials, browser state, source material, or
durable work products. Wutai's job is to make that work permissioned,
auditable, stoppable, and reviewable.

> Repository status: v0.2 foundation in progress. The current code implements
> one supervised research workflow and a v0.2 work-packet manifest for that
> workflow. It does not yet supervise arbitrary external agents,
> browser-control runtimes, MCP tools, coding agents, or full computer-use
> sessions.

## Why This Exists

Agentic work is becoming fragmented across model providers, coding tools,
browser agents, local scripts, MCP servers, and OS-level assistants. Each
runtime can have its own logs, permissions, credentials, and artifacts.

Wutai's product thesis is that users still need a local trust boundary they
control:

- What did the agent ask to access?
- What did the user approve or deny?
- Which provider profile or credential purpose was used?
- Which sources, claims, logs, and artifacts were produced?
- Which parts are verified, weakly supported, or still require human review?

Wutai is not trying to be the agent that does every task. It is the local layer
that records, scopes, and verifies agentic work.

## Current Implementation

The v0.1 scaffold proves this loop with a bounded research workflow:

```text
natural-language task
  -> generated plan
  -> task-scoped permission
  -> research adapter progress
  -> work packet
  -> Evidence Gate review
  -> local task history
```

Implemented:

- Tauri 2 desktop shell with React and TypeScript UI.
- Local task history through SQLite in Tauri and `localStorage` in web preview.
- Task-scoped public web-research permission.
- Offline mock research adapter for deterministic local development and e2e
  tests.
- Optional GPT Researcher Python sidecar for real research tasks.
- Provider Profiles for model, search, and embedding configuration.
- System-keychain storage for provider access keys through `keyring-rs`.
- Sidecar setup preflight and task-scoped sidecar cancellation.
- Redacted expert logs captured into `audit.json`.
- Evidence Gate v0.1 with claim extraction, source-tier classification, and
  deterministic verification summaries.
- Work Packet Manifest v0.2 with artifact inventory, SHA-256 hashes,
  permission summaries, evidence status, and coverage/blind-spot notes.

Each completed real research task writes a local work packet:

```text
manifest.json
report.md
sources.json
claims.json
verification.json
audit.json
```

Not implemented:

- General supervised sessions for arbitrary external agents.
- MCP proxy or tool-call recorder.
- Browser-use, Codex, Claude Code, or full computer-use supervision.
- Cross-agent credential broker.
- Mobile approval companion.
- Production packaging.
- Voice or persona customization.

## Architecture

```text
Desktop Supervision Console
  -> Supervised Session Ledger
  -> Permission and Credential Broker
  -> Agent Adapter / Proxy Layer
  -> Evidence and Artifact Gate
  -> External agent runtimes and tools
```

Current v0.1 only implements the research-adapter slice of this architecture.
The broader adapter/proxy layers are planned boundaries, not shipped behavior.

Key design documents:

- [Development Guide](docs/development.md)
- [Product Brief](docs/product-brief.md)
- [MVP Definition](docs/mvp.md)
- [Architecture](docs/architecture.md)
- [Security Model](docs/security-model.md)
- [Wutai v0.1 PRD](docs/prd/wutai-v0.1.md)
- [v0.1 Scaffold Technical Design](docs/technical-design/v0.1-scaffold.md)
- [Market Scan](docs/research/market-scan.md)

## Quick Start

Prerequisites:

- Node.js and npm
- Rust and Cargo
- Python 3.11 through 3.13 for the optional GPT Researcher sidecar

Install dependencies:

```bash
npm install
```

Run the web preview with the offline mock adapter:

```bash
npm run dev
```

Run the Tauri desktop shell:

```bash
npm run tauri dev
```

## Optional Real Research Adapter

The real research path uses a Python sidecar and is opt-in:

```bash
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-gpt-researcher.txt
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher npm run tauri dev
```

Wutai automatically prefers the project `.venv`. Set
`WUTAI_GPT_RESEARCHER_PYTHON` only to override that interpreter.

When the GPT Researcher adapter is enabled, Wutai checks:

- Python availability and supported version.
- Sidecar script availability.
- `gpt-researcher` package availability.
- Active Provider Profile validity.
- Required model, search, and embedding access.
- Ollama endpoint reachability when Ollama is selected.

Provider metadata is stored in the app-data directory. Secret values are stored
separately in the system keychain and scoped by profile, provider, and purpose.
The developer environment variables `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, and
`TAVILY_API_KEY` remain available as fallbacks.

Verify the optional sidecar environment without API keys or network research:

```bash
cargo test --manifest-path src-tauri/Cargo.toml \
  installed_gpt_researcher_sidecar_smoke -- --ignored
```

## Verification

Build the frontend:

```bash
npm run build
```

Run the Playwright e2e tests:

```bash
npm run test:e2e
```

Run the Provider Profiles UI contract test:

```bash
npm run test:e2e:providers
```

Run the Evidence Gate regressions:

```bash
npm run test:evidence
```

Run the desktop command and IPC tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

The Rust tests use Tauri's mock runtime and an in-memory credential store. They
do not read or write the user's system keychain. The Python tests do not call
external model or search APIs.

## Development Boundaries

Wutai keeps a strict distinction between implemented behavior and roadmap
direction:

- Adapters must translate runtime output into Wutai events before it reaches the
  default UI.
- Runtime logs are expert context, not the primary user experience.
- Evidence Gate results are review aids, not guarantees that every statement is
  true.
- External runtimes that cannot enforce Wutai's permission boundary must remain
  experimental and out of the default path.
- Do not claim support for browser-use, Codex, Claude Code, MCP proxying, or
  full computer-use supervision until there is code, configuration, and a
  runnable verification path in this repository.

## Roadmap

Near-term engineering work:

- Generalize the work-packet manifest beyond supervised research reports.
- Add an official-source-first research pass before final Evidence Gate review.
- Add one external-agent supervision wedge, likely a CLI wrapper or trace
  importer, before direct desktop control.
- Define the minimal credential-broker boundary for task-scoped provider access.

Longer-term candidates:

- MCP proxy or tool-call recorder.
- Browser-agent supervision.
- Coding-agent trace import or adapter.
- Computer-use supervision after stronger safety controls.
- Mobile approval companion for high-risk confirmations.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
