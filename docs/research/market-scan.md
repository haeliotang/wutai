# Market Scan

This note summarizes the current open-source landscape around personal computer
agents, task-first AI workspaces, browser automation, research agents, and
agent UIs. It is a product-positioning scan, not a benchmark.

Repository popularity changes quickly. Re-check current GitHub metadata before
using these numbers in external material.

## Main Finding

The market is active, but the open-source ecosystem is still split across
separate categories:

- AI chat clients.
- No-code agent builders.
- Workflow automation tools.
- Browser and computer-use runtimes.
- Developer agent workspaces.
- Research agents.
- Early personal assistant shells.

There is still room for a product that hides these implementation layers behind
a simple task-first desktop experience for non-programmers.

## Relevant Projects

### Personal Assistant and Desktop Agent Shells

- OpenClaw: personal AI assistant direction, broad platform ambition.
- Hermes Agent: persistent agent runtime with memory and integrations.
- AionUi: local UI for multiple agents and CLI tools.
- LobsterAI: desktop-grade agent for office work, research, documents, slides,
  data analysis, and remote commands.
- OpenLoaf: local-first AI workspace with agents, docs, media, mail, calendar,
  and terminal concepts.
- Cherry Studio and Chatbox: mature multi-model AI clients, closer to chat
  productivity than task lifecycle.

Product lesson: the space is moving quickly, but many products still expose
agent, model, skill, provider, or workflow complexity.

### No-code Agent and Workflow Platforms

- Dify.
- Langflow.
- Flowise.
- n8n.
- Activepieces.

Product lesson: these are powerful builders, but the user is still expected to
understand application construction, nodes, flows, integrations, or agents.
Wutai should consume this layer when useful, not reproduce its UI for ordinary
users.

### Research Agents

- GPT Researcher.
- Open Deep Research.

Product lesson: deep research is a strong MVP workflow because it produces a
clear artifact and can expose source evidence without requiring dangerous
desktop control.

### Browser and Computer-use Runtimes

- browser-use.
- Skyvern.
- CUA.
- Agent-S.
- Open Computer Use.

Product lesson: these are infrastructure. Wutai should wrap them behind a
permission broker and task event model, not expose them directly as the user
experience.

### Developer Agent Workspaces

- OpenHands.
- Codeg.
- Routa.
- Codex app-server and SDK.

Product lesson: developer agent UIs are useful references for streaming events,
tool traces, approvals, and workspaces. They are not the target UX for
non-programmers.

## Positioning Gap

The opportunity is not another AI IDE, chat client, or workflow builder. The
gap is a personal computer agent shell with:

- A strong first-screen presence.
- Natural-language task entry.
- Plain progress.
- Scoped permissions.
- Local task history.
- Durable artifacts.
- Adapter-based execution.
- Persona and voice customization.

## MVP Implication

Start with a narrow workflow where correctness and trust can be evaluated:

1. Deep research.
2. Local document summarization.
3. Sourced report generation.

Add browser and computer control only after the permission broker and audit
trail are working.
