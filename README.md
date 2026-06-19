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
- [Market Scan](docs/research/market-scan.md)

## Repository Status

This repository is in product-definition stage. The current documents define
the first implementation boundary and acceptance criteria. They do not claim
that the desktop shell, agent adapters, voice system, or permission broker have
already been implemented.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
