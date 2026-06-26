# Adapter Shortlist for v0.1

Last checked: 2026-06-19 via GitHub repository metadata.

Wutai should not rebuild mature agent infrastructure. The v0.1 product should
wrap mature open-source projects behind a small Wutai-owned supervision,
permission, evidence, and artifact contract.

## Selected for v0.1

| Capability | Project | License | Why |
| --- | --- | --- | --- |
| Desktop shell | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | Apache-2.0 | Mature desktop shell with Rust backend and web frontend. |
| UI | [facebook/react](https://github.com/facebook/react) | MIT | Mature UI library and ecosystem. |
| Local storage | [SQLite](https://github.com/sqlite/sqlite) through [tauri-plugin-sql](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/sql) | SQLite upstream uses public domain style terms; Tauri SQL plugin uses MIT or MIT/Apache-2.0 terms | Local durable storage for task, event, permission, and artifact metadata without rebuilding database infrastructure. |
| Credential storage | [open-source-cooperative/keyring-rs](https://github.com/open-source-cooperative/keyring-rs) | MIT/Apache-2.0 | Reuses native secure stores for provider access keys instead of writing a custom secret store. |
| Deep research runtime | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | Mature open-source deep research agent that maps directly to the v0.1 core scenario; Wutai uses it through an optional Python sidecar instead of rebuilding research orchestration. |

## Hold for v0.2+

| Capability | Project | License | Reason to defer |
| --- | --- | --- | --- |
| Browser automation | [browser-use/browser-use](https://github.com/browser-use/browser-use) | MIT | Strong candidate, but v0.1 can prove the product with research first. |
| Research alternative | [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) | MIT | Keep as fallback or comparison, not initial dependency. |
| Coding/local execution | [openai/codex](https://github.com/openai/codex) | Apache-2.0 | Useful future adapter or trace source; not part of v0.1 research flow. |
| Coding-agent trace source | Claude Code plugin/hooks ecosystem | Provider platform terms | Useful future supervised-session wedge if Wutai can ingest sanitized local traces without depending on a private transcript format. |
| MCP proxy | Model Context Protocol servers and clients | Varies by server | Useful future permission and tool-call boundary; defer until Wutai has a stable work-packet schema. |
| Computer-use runtime | [trycua/cua](https://github.com/trycua/cua) | MIT | Powerful but higher safety risk; requires stronger permission controls first. |
| Computer-use agent | [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) | Apache-2.0 | Same defer reason as CUA. |
| Browser workflow automation | [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern) | AGPL-3.0 | Mature and relevant, but AGPL and workflow scope make it a later evaluation. |
| Workflow automation | [n8n-io/n8n](https://github.com/n8n-io/n8n) | Fair-code / custom terms | Useful later for workflows; too much builder complexity for v0.1. |
| Workflow automation | [activepieces/activepieces](https://github.com/activepieces/activepieces) | Custom/open-core terms | Useful later; not needed for core research scenario. |

## Selection Rules

- Prefer permissive or Apache-compatible licenses for core dependencies.
- Prefer sidecar or adapter integration over forking.
- Do not expose third-party runtime concepts as default UX.
- Do not add direct desktop control until Wutai's permission broker is proven.
- Keep every external runtime behind Wutai event translation.
- Prefer trace import or proxy integration before direct control when it can
  prove the same work-packet loop with less risk.

## Current v0.1 Dependency Boundary

Build:

- Wutai shell.
- Wutai task model.
- Wutai permission broker.
- Wutai event contract.
- Wutai artifact and audit model.
- Wutai Evidence Gate.
- GPT Researcher adapter.

Reuse:

- Desktop shell framework.
- UI framework.
- Local database engine.
- Native credential storage.
- Deep research runtime.
- Search and page-reading capabilities provided by the research runtime.

Do not build yet:

- General CLI supervision wrapper.
- MCP proxy.
- Browser automation engine.
- Computer-use engine.
- Workflow automation engine.
- Coding agent runtime.
- Voice engine.
