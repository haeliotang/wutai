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
export OPENAI_API_KEY=...
export TAVILY_API_KEY=...
export WUTAI_GPT_RESEARCHER_PYTHON="$PWD/.venv/bin/python"
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher npm run tauri dev
```

Without `VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher`, Wutai keeps using the
offline mock adapter for local development and e2e tests.

Build the frontend:

```bash
npm run build
```

Run the core scenario e2e test:

```bash
npm run test:e2e
```

## Repository Status

This repository contains the first runnable Wutai shell scaffold. It includes
task creation, task-scoped permission, local persistence, artifact writing, an
offline mock research adapter, and an optional GPT Researcher sidecar boundary.
It does not yet implement browser-use, Codex app-server integration, full
computer-use control, voice, or production packaging.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
