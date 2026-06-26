# Product Brief

## One-line Definition

Wutai is a local trust and evidence layer for agentic work: a desktop
supervision layer that records what agents did, controls what they can access,
and turns outputs into verifiable work packets.

## User Problem

Modern agent tools are powerful, fragmented, and increasingly autonomous.
Users may run work through Claude Code, Codex, ChatGPT, browser agents, local
scripts, MCP tools, or future OS-level assistants. Each tool may have its own
logs, permissions, credentials, and artifacts.

That fragmentation creates a trust problem. After an agentic session, a user
should be able to answer:

- What did I authorize?
- Which files, tools, URLs, and credentials were touched?
- Which actions required human confirmation?
- What artifacts were created or modified?
- Which claims are sourced, weakly supported, or still unverified?
- What work am I willing to stand behind as a named human reviewer?

## Product Thesis

Agents will run across many surfaces. Some will run locally, some in cloud
browsers, some inside coding tools, and some behind provider APIs. The durable
local need is not one more agent. It is a user-owned trust boundary around
agentic work that touches local context, credentials, files, browser state, and
work products.

Wutai should feel like a supervision console and evidence vault, not a chatbot,
IDE, or workflow builder.

## Target User

Initial users:

- Power users and independent workers who use multiple AI agents for research,
  writing, coding, documents, and operations.
- Developers and maintainers who need agentic work to leave reviewable
  provenance, not just a final diff or transcript.
- Non-programmers who need desktop-level tasks supervised without learning
  provider-specific agent tooling.

Non-goals for the first version:

- Replacing a full IDE.
- Competing with enterprise workflow automation platforms feature-for-feature.
- Building a general-purpose autonomous operating system.
- Becoming the primary agent that does every task itself.
- Acting as a phone-style identity wallet or two-factor approval app.
- Hiding all risk. Wutai should make risk understandable and controllable.

## Differentiation

Wutai is not differentiated by a list of task buttons. ChatGPT, Gemini, Claude,
Copilot, coding agents, and browser agents can already do useful work.

Wutai must differentiate through supervised-session lifecycle:

- Persistent tasks that can pause, resume, and be reviewed.
- Local context from approved folders, files, browser sessions, and generated
  artifacts.
- Plain-language progress instead of raw tool logs.
- Explicit permission checkpoints for sensitive actions.
- Credential access that is scoped by task and purpose.
- Durable outputs such as reports, decks, spreadsheets, websites, notes, and
  automation drafts.
- Evidence receipts, hashes, source ledgers, and known blind spots.
- Human-attested review records instead of automated verdicts.

## First Experience

The initial screen should be minimal and presence-driven:

```text
WUTAI

> What agent work should I supervise?
```

After the user starts or imports a supervised session, Wutai should show:

- The understood goal.
- The proposed plan.
- Required permissions.
- Current progress.
- Artifacts created.
- Evidence and verification status.
- Any decision waiting for the user.

The system can use a dark, terminal-inspired design language, but it must use
natural language rather than command syntax.

## Core Promise

Wutai should make the user feel:

- My agents are working inside a boundary I control.
- I understand what happened.
- I can stop it at any time.
- It will ask before doing risky things.
- I can return later and inspect the evidence.
- I can decide what I am willing to stand behind.
