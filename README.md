# Wutai

Wutai is a local trust and evidence layer for agentic work on personal
computers. It records what agents did, controls what they can access, and turns
their outputs into verifiable artifacts.

Wutai is not trying to be another agent that does the work itself, another AI
IDE, another chat client, or another workflow-builder UI. The product bet is
that agents will run across many surfaces -- local apps, cloud browsers,
coding tools, MCP servers, and model-provider runtimes -- but work that touches
the user's files, credentials, browser state, or durable outputs still needs a
local trust boundary owned by the user.

The current repository is a v0.1 scaffold. It implements one supervised
research workflow and uses that workflow to prove the local ledger, permission,
artifact, and Evidence Gate loop. It does not yet supervise arbitrary external
agents.

## Product Principles

- Agent-agnostic: Wutai should supervise work from many agent runtimes instead
  of competing to be the only agent application.
- Permissioned: every sensitive capability is explicit, scoped, reversible, and
  auditable.
- Credential-minimizing: agents should receive task-scoped access, not
  permanent secrets or broad ambient authority.
- Artifact-centered: the main output is a durable report, deck, spreadsheet,
  automation, file set, code diff, or decision record, not a transient chat
  answer.
- Evidence-first: important claims and work products should carry sources,
  hashes, audit trails, blind spots, and review status.
- Adapter-first: reuse open-source runtimes and tools instead of rebuilding
  browser automation, research agents, coding agents, file parsers, or speech
  engines.
- Human-attested: Wutai can surface risk and evidence, but important alignment
  judgments belong to a named human reviewer.

## What Wutai Should Feel Like

The first screen should feel like a local supervision console has booted on the
user's machine:

```text
WUTAI

> What agent work should I supervise?
```

The UI can use a dark terminal-inspired visual language, but it must not behave
like a programmer terminal. Users should speak in natural language. Wutai should
translate complex backend activity into plain status updates, permission
requests, evidence warnings, and final work packets.

## Initial Scope

The first useful version should prove one thing: a user can run a bounded agent
task under local supervision, understand what was allowed, inspect what
happened, and keep a verifiable work packet after completion.

The v0.1 implementation proves this with a sourced research workflow. A
completed real research task writes:

- `report.md`
- `sources.json`
- `claims.json`
- `verification.json`
- `audit.json`

Future supervised-session adapters can apply the same ledger to coding agents,
browser agents, computer-use runtimes, and local scripts.

## Architecture Direction

```text
Desktop Supervision Console
  -> Supervised Session Ledger
  -> Permission and Credential Broker
  -> Agent Adapter / Proxy Layer
  -> Evidence and Artifact Gate
  -> External agent runtimes and tools
```

Wutai should own the local event ledger, task/session lifecycle, permission
model, credential boundary, evidence model, artifact model, and adapter
contract. It should reuse proven projects for execution.

See:

- [Product Brief](docs/product-brief.md)
- [MVP Definition](docs/mvp.md)
- [Architecture](docs/architecture.md)
- [Security Model](docs/security-model.md)
- [Persona and Voice](docs/persona-and-voice.md)
- [Wutai v0.1 PRD](docs/prd/wutai-v0.1.md)
- [v0.1 Scaffold Technical Design](docs/technical-design/v0.1-scaffold.md)
- [Market Scan](docs/research/market-scan.md)

## Development

Prerequisites:

- Node.js
- npm
- Rust and Cargo
- Python 3.11 through 3.13 for the optional GPT Researcher sidecar; 3.13 is
  recommended

Install dependencies:

```bash
npm install
```

Run the web shell:

```bash
npm run dev
```

Run the Tauri shell:

```bash
npm run tauri dev
```

Run the Tauri shell with the optional GPT Researcher sidecar:

```bash
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-gpt-researcher.txt
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher npm run tauri dev
```

Wutai automatically prefers the project `.venv`. Set
`WUTAI_GPT_RESEARCHER_PYTHON` only to override that interpreter.

Verify the installed sidecar without API keys or network research:

```bash
cargo test --manifest-path src-tauri/Cargo.toml \
  installed_gpt_researcher_sidecar_smoke -- --ignored
```

Then open Research setup in the app and choose a Provider Profile. Model,
search, and embedding providers are configured independently. The current UI
supports DeepSeek, OpenAI, OpenAI-compatible endpoints, and Ollama for models;
Tavily or DuckDuckGo for search; and OpenAI-compatible or Ollama embeddings.
The default profile is DeepSeek + Tavily + local Ollama embeddings.

Profile metadata is stored in the app-data directory. API keys are stored
separately in the system keychain through `keyring-rs` and are scoped by
profile, provider, and purpose. Developers can still use `DEEPSEEK_API_KEY`,
`OPENAI_API_KEY`, and `TAVILY_API_KEY` as environment-variable fallbacks.

Without `VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher`, Wutai keeps using the
offline mock adapter for local development and e2e tests.

When the GPT Researcher adapter is enabled, Wutai runs a startup setup check
for Python, the sidecar script, the `gpt-researcher` package, the active
Provider Profile, required access keys, and a configured Ollama endpoint when
used. If setup is incomplete, Wutai blocks new real research tasks and shows
the missing steps in the app. While a real research task is running, Stop
asks Tauri to terminate the Python sidecar process for that task. Sidecar stderr
logs stream through a Tauri IPC Channel into expert-only task events and stay
hidden from the default timeline. Structured sidecar stages provide stable
plain-language progress for normal users. Task history keeps at most 200 expert
log events; `audit.json` retains every captured, redacted, per-line-bounded log
entry. Evidence Gate v0.1 extracts a structured claim ledger after report
generation, classifies captured source provenance with deterministic rules, and
marks tasks that need evidence review instead of presenting every generated
report as fully trusted. Each real research task writes `report.md`,
`sources.json`, `claims.json`, `verification.json`, and `audit.json`.

Build the frontend:

```bash
npm run build
```

Run the core scenario e2e test:

```bash
npm run test:e2e
```

Run the Provider Profiles UI contract test:

```bash
npm run test:e2e:providers
```

Run the offline Evidence Gate regressions:

```bash
npm run test:evidence
```

Run the desktop command and IPC tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

These Rust tests use Tauri's official mock runtime and an in-memory credential
store, never the user's system keychain. They cover profile validation,
provider-to-runtime mapping, provider-key precedence, setup preflight and
process cancellation through the Tauri invoke handler, plus the streaming
stderr parser; Playwright covers the default offline task flow and the
Provider Profiles UI at desktop minimum width. Python unit tests cover source
classification, evidence warnings, and locked OpenClaw/Multica license facts
without calling external APIs.

## Repository Status

This repository contains the first runnable Wutai local trust-layer scaffold. It
includes task creation, task-scoped permission, local persistence, artifact
writing, an offline mock research adapter, and an optional GPT Researcher
sidecar with Provider Profiles, Evidence Gate artifacts, keychain-backed setup
preflight, redacted expert logs, and task-scoped sidecar cancellation.

Implemented behavior:

- One supervised research task lifecycle.
- Task-scoped public web-research permission.
- Local task history and app-data artifact writing.
- Provider Profile metadata plus system-keychain secrets.
- Evidence Gate claim extraction and deterministic verification summaries.
- `audit.json` with permission, event, provider, and sidecar-log context.

Planned behavior:

- Supervised sessions for external coding agents, browser agents, local
  scripts, and MCP tools.
- A permission and credential broker that can sit in front of external agent
  runtimes.
- A general work-packet format for cross-agent audit, provenance, and
  human-attested review.

Not implemented:

- Browser-use, Codex app-server, Claude Code, MCP-proxy, or full computer-use
  supervision.
- Production packaging.
- Mobile approval companion.
- Voice or persona customization.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
