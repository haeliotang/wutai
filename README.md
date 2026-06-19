# Wutai

Wutai is a personal computer agent shell: a customizable, voice-enabled,
task-first desktop layer that helps non-programmers delegate complex computer
work while keeping permissions, evidence, and final artifacts under their
control.

The project is not trying to build another AI IDE, another chat client, or
another workflow-builder UI. Wutai's product bet is that the next personal
computer interface is organized around tasks, not apps, and that advanced
agent capabilities should be hidden behind a calm, understandable control
surface.

## Product Principles

- Task-first: users describe outcomes, not tools, prompts, or protocols.
- Permissioned: every sensitive capability is explicit, scoped, reversible, and
  auditable.
- Artifact-centered: the main output is a durable report, deck, spreadsheet,
  automation, file set, or decision record, not a transient chat answer.
- Adapter-first: reuse open-source runtimes and tools instead of rebuilding
  browser automation, research agents, coding agents, file parsers, or speech
  engines.
- Personal: the shell can have a custom visual style, name, voice, and behavior
  profile, while the safety model remains clear and predictable.

## What Wutai Should Feel Like

The first screen should feel like a private computer agent has booted on the
user's machine:

```text
WUTAI

> What should I handle for you?
```

The UI can use a dark terminal-inspired visual language, but it must not behave
like a programmer terminal. Users should speak in natural language. Wutai should
translate complex backend activity into plain status updates, permission
requests, and final artifacts.

## Initial Scope

The first useful version should prove one thing: a non-programmer can start a
long-running computer task, understand what the agent is doing, approve
sensitive steps, and receive a durable artifact.

Candidate first workflows:

- Research a topic and produce a sourced report.
- Read a folder of files and generate a structured summary.
- Compare products, projects, or competitors and produce a decision memo.
- Generate a presentation outline or editable document from collected sources.

## Architecture Direction

```text
Custom UI Shell
  -> Persona and Voice Layer
  -> Task OS Layer
  -> Agent Adapter Layer
  -> Local Permission Broker
  -> Open-source runtimes and tools
```

Wutai should own the user experience, task lifecycle, permission model, and
adapter contract. It should reuse proven projects for execution.

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
- Python 3.11 or 3.12 for the optional GPT Researcher sidecar

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
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-gpt-researcher.txt
export WUTAI_GPT_RESEARCHER_PYTHON="$PWD/.venv/bin/python"
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher npm run tauri dev
```

Then open Research setup in the app and save the model access key and web search
key. Wutai stores these in the system keychain through `keyring-rs`. Developers
can still use `OPENAI_API_KEY` and `TAVILY_API_KEY` as environment-variable
fallbacks.

Without `VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher`, Wutai keeps using the
offline mock adapter for local development and e2e tests.

When the GPT Researcher adapter is enabled, Wutai runs a startup setup check
for Python, the sidecar script, the `gpt-researcher` package, and the required
access keys. If setup is incomplete, Wutai blocks new real research tasks and
shows the missing steps in the app. While a real research task is running, Stop
asks Tauri to terminate the Python sidecar process for that task. Sidecar stderr
logs are stored as expert-only task events and stay hidden from the default
timeline.

Build the frontend:

```bash
npm run build
```

Run the core scenario e2e test:

```bash
npm run test:e2e
```

Run the desktop command and IPC tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

These Rust tests use Tauri's official mock runtime and an in-memory credential
store, never the user's system keychain. They cover provider-key precedence,
setup preflight and process cancellation through the Tauri invoke handler;
Playwright covers the default offline task flow.

## Repository Status

This repository contains the first runnable Wutai shell scaffold. It includes
task creation, task-scoped permission, local persistence, artifact writing, an
offline mock research adapter, and an optional GPT Researcher sidecar with
keychain-backed setup preflight.
It does not yet implement browser-use, Codex app-server integration, full
computer-use control, voice, or production packaging.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
