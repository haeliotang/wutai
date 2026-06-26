# Market Scan

This note summarizes the current open-source landscape around personal computer
agents, task-first AI workspaces, browser automation, research agents, agent
UIs, and agent work governance. It is a product-positioning scan, not a
benchmark.

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
- Agent observability, evals, and governance tools.

There is still room for a product that gives individuals and small teams a
local trust layer across these implementation layers: scoped access, audit,
work packets, evidence receipts, and human review.

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

Product lesson: the space is moving quickly, but "be the user's agent app" is
crowded and vulnerable to OS and model-provider platforms. Wutai should not
compete mainly on doing tasks better.

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
reviewing supervised work packets.

### Agent Observability, Evals, and Governance

- LangSmith, Langfuse, Phoenix, Braintrust, and Weave focus on tracing,
  evaluation, debugging, and monitoring.
- Gateway and governance products focus on policy, access, audit, and provider
  control, usually for teams or enterprises.
- OS and model-provider platforms are adding their own agent registries,
  permissions, connectors, and runtime traces.

Product lesson: enterprise observability and platform control planes are
crowded. The clearer gap is personal or small-team local provenance: what an
agent was allowed to touch on this machine, what it produced, and what a human
has actually reviewed.

## Positioning Gap

The opportunity is not another AI IDE, chat client, workflow builder, or
general-purpose autonomous agent. The gap is a local trust and evidence layer
for agentic work with:

- Agent-agnostic supervised sessions.
- Plain progress and user-safe timelines.
- Scoped permissions and revocation.
- Credential access by task and purpose.
- Local task and session history.
- Durable work packets.
- Evidence receipts, claim ledgers, and known blind spots.
- Human-attested review records.
- Adapter-based execution and trace import.

## MVP Implication

Start with a narrow workflow where correctness and trust can be evaluated:

1. Deep research.
2. Sourced report generation.
3. Project or coding-agent session review.

Add browser and computer control only after the permission broker, credential
boundary, work-packet schema, and audit trail are working.
