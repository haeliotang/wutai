# Wutai

Wutai is a local trust and evidence layer for agentic work on personal
computers.

It is designed for the point where an agent stops being a chat answer and starts
touching local files, provider credentials, browser state, source material, or
durable work products. Wutai's job is to make that work permissioned,
auditable, stoppable, and reviewable.

> Repository status: v0.2 foundation in progress. The current code implements
> one supervised research workflow, a v0.2 work-packet manifest, and a
> local-script trace-import, coding-agent trace-import, MCP tool-call
> trace-import, local file ingestion, and developer CLI wrapper wedge. It does
> not yet
> sandbox commands, enforce a general permission broker, or supervise arbitrary
> external agents, browser-control runtimes, live MCP sessions, live coding
> agents, or full computer-use sessions.

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

The v0.1 scaffold proves this loop with a bounded research workflow. The v0.2
foundation extends the work-packet model with local-script trace import,
coding-agent trace import, MCP tool-call trace import, local file ingestion,
and a developer CLI wrapper:

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
  permission summaries, session/audit summaries, evidence status, and
  coverage/blind-spot notes.
- Local-script trace importer that turns an already-run command trace into a
  reviewable work packet without executing the command.
- Coding-agent trace importer that turns an already-run external coding-agent
  session trace into a reviewable `coding_agent` work packet without executing
  the agent, approving tool calls, or supervising filesystem access.
- MCP tool-call trace importer that turns an already-run MCP session trace into
  a reviewable `mcp_tool_call` work packet without proxying the MCP connection,
  approving tool calls, or mediating credentials. The importer rejects missing
  required fields, invalid status/timestamp shapes, negative latency, and
  overlarge tool-call batches before creating a task.
- Local file ingestion for user-selected files. Wutai records file metadata,
  SHA-256 hashes, bounded text previews, and audit entries without crawling
  directories, watching later changes, or retaining full file contents. The UI
  can re-check a file packet against newly selected files and save the result
  as `file-check.json`.
- Developer CLI wrapper, `npm run wutai:run -- -- <command>`, that executes an
  explicitly provided local command, captures bounded stdout/stderr summaries,
  runs structured policy preflight from `config/wutai-cli-policy-profiles.json`,
  supports `standard` / `strict` profiles and dry-run review, records exit code
  and git-status delta, and writes a local work packet. With
  `--signing-key <pem>`, it also writes an optional `attestation.json` that
  signs the final `manifest.json`.
- Desktop review import for CLI wrapper packets. Select the packet directory,
  or select `manifest.json` plus sibling artifacts, to add the run to local task
  history, verify manifest artifact hashes, record local provenance checks,
  inspect policy, trace, ledger, filtered audit details, integrity, and
  provenance artifacts, verify optional packet attestation signatures, and match
  verified signatures against an explicitly loaded local trusted-producer
  policy. Dry-run packets with pending execution can be marked approved or
  denied as a local review record only.

Each completed research task writes a local work packet:

```text
manifest.json
report.md
sources.json
claims.json
verification.json
audit.json
```

Each imported local-script trace writes:

```text
manifest.json
report.md
trace.json
audit.json
```

Each imported coding-agent trace writes:

```text
manifest.json
report.md
trace.json
audit.json
```

Each imported MCP tool-call trace writes:

```text
manifest.json
report.md
trace.json
audit.json
```

Each local file ingestion writes:

```text
manifest.json
report.md
files.json
audit.json
file-check.json   # optional, only after a hash re-check
```

Each developer CLI wrapper run writes:

```text
manifest.json
report.md
policy.json
trace.json
ledger.json
audit.json
attestation.json   # optional, only when --signing-key is supplied
```

Each imported CLI wrapper packet also gets local review-side artifacts:

```text
integrity.json
provenance.json
```

If a dry-run packet is approved or denied in the desktop/web review surface,
Wutai also writes a local review artifact:

```text
review.json
```

Not implemented:

- Runtime-enforced supervised sessions for arbitrary external agents.
- Shell command execution under a full Wutai permission broker or sandbox.
- Live MCP proxy or runtime MCP tool-call recorder.
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

Current code implements the research-adapter slice, a local-script trace import
slice, and a developer CLI wrapper slice of this architecture. The broader
adapter/proxy layers are planned boundaries, not shipped runtime-enforced
behavior.

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

## Developer CLI Wrapper

Run a local command through Wutai's development wrapper:

```bash
npm run wutai:run -- -- npm run test:evidence
```

The wrapper writes a work packet under `artifacts/cli/<session_id>/`. It records
the explicit invocation, argv, working directory, policy preflight decision,
exit code, bounded stdout/stderr summaries, a git-status delta, and artifact
hashes.

The wrapper uses a structured but incomplete policy catalog. Profile behavior is
loaded from `config/wutai-cli-policy-profiles.json`, or from a caller-supplied
`--policy-config <path>`. High-risk patterns
such as shell interpreter command strings, recursive or forced remove,
environment dumps, privilege escalation, destructive git operations, and
recursive permission changes are denied before execution by default. Medium
risk patterns such as dependency mutation or local network listeners are
recorded as warnings. `--policy-profile strict` escalates warning rules to deny.
Profiles can also define rule-level overrides:

```json
{
  "ruleOverrides": {
    "dependency_install_or_update": {
      "effectiveAction": "deny",
      "severity": "high",
      "reviewScope": ["dependency tree", "lockfile mutation"],
      "reason": "Dependency mutation requires explicit review."
    }
  }
}
```

Rule overrides are trusted local configuration. They are recorded in
`policy.json`, can strengthen or weaken individual rules, and are not a sandbox.
To generate a packet without executing the command:

```bash
npm run wutai:run -- --dry-run --policy-profile strict -- npm install
```

To record an explicit override:

```bash
npm run wutai:run -- --allow-high-risk \
  --override-reason "reviewed shell boundary" -- sh -c "printf reviewed"
```

To add a packet attestation, provide an EC P-256 private key:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out wutai-signing-key.pem
npm run wutai:run -- --signing-key ./wutai-signing-key.pem -- npm run test:evidence
```

This writes `attestation.json` beside the packet. The attestation signs the
final `manifest.json` bytes with ECDSA P-256 SHA-256 and includes the public key
needed for verification. This is a tamper check, not a trust guarantee: Wutai
only treats the producer as trusted when the public key hash also matches a
local trusted-producer policy loaded by the user.

Trusted-producer policy files use this shape:

```json
{
  "schemaVersion": 1,
  "kind": "wutai.trusted_producer_policy",
  "policyId": "local-trusted-producers",
  "keys": [
    {
      "keyId": "my-wutai-cli-key",
      "label": "My Wutai CLI key",
      "publicKeySha256": "<64 hex chars>",
      "producerAdapter": "wutaiRunCli",
      "allowedPacketTypes": ["local_script"],
      "status": "active"
    }
  ]
}
```

The example file is
`config/wutai-trusted-producers.example.json`. Load a policy with `Load trust
policy` before importing a signed packet. A packet cannot make itself trusted by
including its own policy; the policy is a local UI setting.

Boundary: this wrapper does not sandbox the process, mediate credentials, block
network or filesystem access, or enforce a complete destructive-command policy.
The policy catalog records rule category, severity, default action, override
state, rationale, and review scope. It is a verified local execution ledger, not
a full permission broker.

To review a generated packet in the app, open the web preview or Tauri shell and
choose `Import CLI packet directory`. The file-based fallback is `Import CLI
packet files`, then select `manifest.json`, `report.md`, `policy.json`,
`trace.json`, `ledger.json`, `audit.json`, and optional `attestation.json` from
the packet directory. The import recomputes selected artifact SHA-256 values
against the manifest and writes `integrity.json` and `provenance.json` into
local task history. The provenance check records manifest hash, producer fields,
required artifact presence, schema-kind consistency, and optional attestation
verification. A valid attestation remains untrusted unless the public key hash
matches the loaded local trusted-producer policy. If the packet is a dry-run
with pending local-script execution permission, the review panel can record
approve or deny into `review.json`. It is review-only; the desktop UI does not
run or re-run the command.

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

Run the CLI wrapper packet tests:

```bash
npm run test:wutai-run
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
- Do not claim live support for browser-use, Codex, Claude Code, MCP proxying,
  or full computer-use supervision until there is code, configuration, and a
  runnable verification path in this repository.

## Roadmap

Near-term engineering work:

- Continue generalizing the work-packet manifest beyond research, imported
  local-script traces, external trace imports, local file ingestion, and
  developer CLI wrapper runs.
- Add an official-source-first research pass before final Evidence Gate review.
- Harden trusted-key enrollment and producer trust policy for signed CLI packets.
- Add more regression coverage and validation for externally configurable rule
  overrides.
- Harden local review artifacts and trusted-key enrollment UX.
- Define the minimal credential-broker boundary for task-scoped provider access.

Longer-term candidates:

- Live MCP proxy or runtime tool-call recorder.
- Browser-agent supervision.
- Live coding-agent adapter.
- Computer-use supervision after stronger safety controls.
- Mobile approval companion for high-risk confirmations.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
