# Product Brief

## One-line Definition

Wutai is a personal computer agent shell for non-programmers: a customizable
desktop control layer that turns complex computer work into permissioned,
auditable, artifact-producing tasks.

## User Problem

Modern agent tools are powerful but expose too much implementation detail.
Non-programmers should not need to understand MCP, skills, model providers,
terminal sessions, worktrees, sandbox modes, or workflow graphs just to ask a
computer to complete a complex task.

At the same time, mobile AI assistants are often too shallow for long-running
desktop work. They can generate text, but they usually do not manage local
files, browser sessions, repeated confirmations, evidence trails, editable
documents, and task history as one coherent workflow.

## Product Thesis

The next computer interface can be task-first. Users should describe the
outcome they want. The system should choose tools, request scoped permissions,
show understandable progress, and produce durable artifacts.

Wutai should feel like a personal computer agent, not a form builder, IDE, or
chatbot.

## Target User

Initial users:

- Non-programmers who do research, writing, documents, presentations, and
  information work.
- Operators, creators, founders, students, analysts, and independent workers
  who need desktop-level depth but do not want developer tooling.
- Power users who are comfortable granting scoped permissions but do not want
  to assemble agent systems manually.

Non-goals for the first version:

- Replacing a full IDE.
- Competing with enterprise workflow automation platforms feature-for-feature.
- Building a general-purpose autonomous operating system.
- Hiding all risk. Wutai should make risk understandable and controllable.

## Differentiation

Wutai is not differentiated by a list of task buttons. ChatGPT, Gemini, Claude,
and many mobile assistants can already offer prompts such as "write copy" or
"make a presentation."

Wutai must differentiate through task lifecycle:

- Persistent tasks that can pause, resume, and be reviewed.
- Local context from approved folders, files, browser sessions, and generated
  artifacts.
- Plain-language progress instead of raw tool logs.
- Explicit permission checkpoints for sensitive actions.
- Durable outputs such as reports, decks, spreadsheets, websites, notes, and
  automation drafts.
- Personal visual and voice identity without weakening safety boundaries.

## First Experience

The initial screen should be minimal and presence-driven:

```text
WUTAI

> What should I handle for you?
```

After the user describes a task, Wutai should show:

- The understood goal.
- The proposed plan.
- Required permissions.
- Current progress.
- Artifacts created.
- Any decision waiting for the user.

The system can use a dark, terminal-inspired design language, but it must use
natural language rather than command syntax.

## Core Promise

Wutai should make the user feel:

- It is working on my behalf.
- I understand what it is doing.
- I can stop it at any time.
- It will ask before doing risky things.
- I can return later and continue the task.
