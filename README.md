# Wutai

<!-- StillMirror maintainer-review badge — advancing-the-core vs upkeep, refreshed weekly in CI; evidence, not a verdict -->
![StillMirror](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/haeliotang/wutai/stillmirror-badges/maintainer-badge.json)

Wutai is a local trust and evidence layer for agentic work crossing a trust
boundary.

It is designed for the point where an agent stops being a chat answer and starts
touching local files, provider credentials, browser state, source material, or
durable work products. Wutai's job is to make that work permissioned,
auditable, stoppable, and reviewable.

> Repository status: v0.9 attention and accountability gate. The current code
> implements one supervised research workflow, a v0.2+ work-packet manifest, and a
> local-script trace-import, coding-agent trace-import, MCP tool-call
> trace-import, local file ingestion, and developer CLI wrapper wedge. It does
> not yet sandbox commands, enforce a general permission broker, or supervise
> arbitrary external agents, browser-control runtimes, live MCP sessions, live
> coding agents, or full computer-use sessions. v0.5 adds a local Agent Packet
> Inbox over the packet contract, so external-agent work can be collected,
> filtered, explained, retained, or rejected without implying Wutai controlled
> the original runtime. v0.7 adds a CLI/CI scoped ratification harness that
> re-verifies a packet, separates review-compression (`wedgeOutcome`) from
> ratification (`moatOutcome`), requires `declaredScope` and `excludedScope`
> for acceptance, and marks unscoped ratification as a theater anti-signal.
> v0.8 adds an optional `review-session.json` scorer so the harness can
> distinguish attention credit from packet-caused scoped ratification credit.
> v0.9 adds an attention-decision gate that routes verified packets into
> `auto_accepted_under_policy`, `human_attention_required`,
> `scoped_ratified`, or `blocked_or_unowned` while explicitly recording when
> no scoped human review evidence is present.
> It does not prove reviewer identity, trace completeness, or external demand.

## Why This Exists

Agentic work is becoming fragmented across model providers, coding tools,
browser agents, local scripts, MCP servers, and OS-level assistants. Each
runtime can have its own logs, permissions, credentials, and artifacts.

Wutai's product thesis is that agent work needs a local record before it crosses
a trust boundary:

- What did the agent ask to access?
- What did the user approve or deny?
- Which provider profile or credential purpose was used?
- Which sources, claims, logs, and artifacts were produced?
- Which parts are verified, weakly supported, or still require human review?

Wutai is not trying to be the agent that does every task. It is the layer that
records declared traces, scopes claims and intent, and tests whether a named
reviewer will ratify or refuse the work within an explicit boundary.

## Current Implementation

The v0.1 scaffold proves this loop with a bounded research workflow. The v0.2
foundation extends the work-packet model with local-script trace import,
coding-agent trace import, MCP tool-call trace import, local file ingestion,
and a developer CLI wrapper. v0.4 adds an External Agent Integration Contract:
third-party agents and wrappers can write Wutai-compatible local-script packets,
then call the same local verifier and trust policy gate that Wutai uses. v0.5
turns those packets into a local inbox for review and retention. v0.7 adds a
scoped ratification harness for testing whether a second, non-self reviewer
will sign a declared boundary or refuse because of intent drift, an empty
accountability seat, or unevidenced claims. v0.8 adds review-session
instrumentation for the preceding question: would the reviewer have looked at
all, and did the packet causally change the scoped decision? v0.9 adds an
attention-decision gate for the likely operating reality where most agent work
will not receive careful human review: trusted packets may be auto-accepted
under policy, review-required packets route to a required human seat, scoped
ratification remains a first-class acceptance path, and blocked or unowned work
is explicit.

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
  verified signatures against an explicitly loaded or locally enrolled
  trusted-producer policy. Dry-run packets with pending execution can be marked
  approved or denied as a local review record only.
- Trust Verdict v0.3 for imported or externally verified CLI wrapper packets.
  Wutai combines manifest integrity, packet provenance, trusted-producer status,
  policy override review, high-risk override rationale, and optional
  rule-level trust policy into one `trusted`, `review_required`, or `blocked`
  result.
- Agent-callable packet verification with `wutai verify-packet` /
  `npm run wutai:verify -- <packet-dir>`. The verifier emits machine-readable
  `trust-verdict.json` and can optionally write derived review artifacts back
  into the packet directory.
- External Agent Integration Contract v0.4. Non-Wutai local-script producers can
  generate reviewable packets through `sdk/node`, `examples/external-agent-wrapper.mjs`,
  and the schemas under `schemas/`. The verifier now accepts any
  `local_script` packet with a declared `producer.adapter`; local trust still
  depends on hash checks, optional attestation, trusted-producer policy, and
  trust-policy profiles.
- Built-in verifier trust-policy profiles in
  `config/wutai-trust-policy-profiles.json`: `personal-default`,
  `strict-local`, and `ci-review`.
- Example GitHub Actions packet-verification gate in
  `.github/workflows/wutai-verify-packet.example.yml`.
- Scoped Ratification Gate v0.7. `wutai attest-packet` /
  `npm run wutai:attest -- <packet-dir>` re-runs packet verification, reads a
  `consumer-attestation.json`, rejects caller-disallowed reviewer ids, binds
  the review to the current `manifest.json` SHA-256, separates
  `wedgeOutcome` from `moatOutcome`, requires `declaredScope` and
  `excludedScope` for acceptance, records scoped refusal as a valid moat
  readout but not an acceptance pass, and marks unscoped ratification as a
  theater anti-signal.
- Review Session Instrumentation v0.8. `wutai attest-packet --review-session
  <path>` can read a `review-session.json` with Arm 0 would-look baseline, Arm
  A diff-only baseline, Arm B packet-assisted review, and contamination
  controls. The output adds `attentionOutcome`, `causalCredit`, and
  `reviewSession` so an attention win cannot be counted as packet-caused
  scoped ratification.
- Attention Decision Gate v0.9. `wutai attention-decision` /
  `npm run wutai:attention -- <packet-dir>` re-runs packet verification, reads
  optional `consumer-attestation-check.json`, applies a local
  `wutai.attention_policy`, and emits `attention-decision.json` with
  `auto_accepted_under_policy`, `human_attention_required`,
  `scoped_ratified`, or `blocked_or_unowned`. It records `no_human_review` as
  an audit signal when policy permits auto acceptance without scoped human
  ratification.
- Example GitHub Actions consumer-attestation gate in
  `.github/workflows/wutai-consumer-attestation.example.yml`.
- Agent Packet Inbox v0.5. The UI derives a packet inbox from local task
  history, indexes packet producer, packet type, trust verdict, provenance,
  policy decision, attestation state, and retention state, and supports search,
  producer, verdict, and retention filters.
- Adapter registry in `config/wutai-adapter-registry.json`, mirrored in the UI,
  with native adapters and proof-harness entries for `codexCli`, `claudeCode`,
  and `githubActions`.
- Adapter proof runner, `npm run example:adapter-proof -- --adapter <id> -- <command>`,
  that wraps an explicit external command, writes a Wutai SDK packet, verifies
  it, and optionally writes derived review artifacts.
- Packet retention decisions. The review UI can record `retained` or
  `rejected` into `retention.json` and export the current inbox or packet
  summary.

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

Each external-agent SDK packet writes the same local-script contract:

```text
manifest.json
report.md
policy.json
trace.json
ledger.json
audit.json
attestation.json   # optional, only when a signing key is supplied
```

Each imported CLI wrapper packet also gets local review-side artifacts:

```text
integrity.json
provenance.json
policy-review.json
trust-verdict.json
```

If a dry-run packet is approved or denied in the desktop/web review surface,
Wutai also writes a local review artifact:

```text
review.json
```

If a packet is processed by the scoped ratification gate, Wutai may also write:

```text
consumer-attestation.json
consumer-attestation-check.json
```

A v0.8 review-session run may also supply:

```text
review-session.json
```

If a packet is processed by the v0.9 attention-decision gate, Wutai may also
write:

```text
attention-decision.json
```

Not implemented:

- Runtime-enforced supervised sessions for arbitrary external agents.
- Shell command execution under a full Wutai permission broker or sandbox.
- Live MCP proxy or runtime MCP tool-call recorder.
- Browser-use, Codex, Claude Code, or full computer-use supervision.
- Official live Codex CLI, Claude Code, or GitHub Actions integrations beyond
  the v0.5 packet proof harness.
- Cryptographic consumer-reviewer identity proof or automatic GitHub PR
  reviewer extraction.
- Proof that a maintainer silently looked at a PR without leaving review
  artifacts.
- Path-level witnessing of external runtimes; current external packet paths
  record declared traces supplied by producers.
- Proof that non-author users already want to perform scoped ratification; v0.9
  provides gates for attention routing and policy-backed auto acceptance, not
  external demand proof.
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
- [Attention Decision Gate](docs/attention-decision-gate.md)
- [Scoped Ratification Gate](docs/consumer-attestation-gate.md)
- [Scoped Ratification Prereg](docs/ratification-prereg.md)
- [Agent Packet Inbox](docs/agent-packet-inbox.md)
- [v0.4 Packet Contract](docs/packet-contract.md)
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
local trusted-producer policy loaded or explicitly enrolled by the user.

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
policy` before importing a signed packet, or import a signed packet first and
use `Trust this producer key` after Wutai verifies the attestation signature.
Enrollment writes a local policy entry scoped to the observed producer adapter
and packet type, then re-checks packet provenance. The local trust registry can
show, revoke, reactivate, and export trusted-producer keys. A packet cannot make
itself trusted by including its own policy; trust remains a local UI setting.

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
matches the loaded or enrolled local trusted-producer policy. If the signature
is verified but the key is unknown, the review panel can enroll the key for the
observed producer adapter and packet type. The trust registry can revoke or
reactivate local keys and immediately re-check the active packet. If the packet
is a dry-run with pending local-script execution permission, the review panel
can record approve or deny into `review.json`. It is review-only; the desktop UI
does not run or re-run the command.

To verify a packet from an external agent or script without opening the UI:

```bash
npm run wutai:verify -- ./artifacts/cli/<session_id>
```

or through the unified local entrypoint:

```bash
npm run wutai -- verify-packet ./artifacts/cli/<session_id>
```

The verifier prints a `wutai.trust_verdict` JSON object. Exit codes are:

```text
0   trusted
10  review_required
20  blocked
2   usage or packet-read error
```

For signed packets, pass a local trusted-producer policy:

```bash
npm run wutai:verify -- \
  --trusted-producers ./wutai-trusted-producers.json \
  ./artifacts/cli/<session_id>
```

The verifier loads `personal-default` from
`config/wutai-trust-policy-profiles.json` unless a profile or explicit policy is
provided. Built-in profiles:

```text
personal-default  unsigned and warning-bearing packets require review
strict-local      unsigned packets and policy warnings block by default
ci-review         CI-oriented profile; high-risk allow and missing rationale block
```

Select a profile with:

```bash
npm run wutai:verify -- \
  --trust-policy-profile strict-local \
  ./artifacts/cli/<session_id>
```

To apply a rule-level trust policy, pass `--trust-policy <path>`. This is
separate from the CLI execution policy. Execution policy decides whether the
wrapper should run a command; trust policy decides whether a produced packet can
be accepted locally as trusted, needs review, or must be blocked. The example
file is `config/wutai-trust-policy.example.json`:

```json
{
  "kind": "wutai.trust_policy",
  "requireTrustedProducerForTrusted": true,
  "rulePolicies": {
    "shell_interpreter_command_string": {
      "action": "review",
      "requireRationale": true,
      "requireTrustedProducer": true
    }
  }
}
```

To persist the verifier's derived artifacts beside the packet:

```bash
npm run wutai:verify -- --write-artifacts ./artifacts/cli/<session_id>
```

## Attention Decision Gate

v0.9 adds a policy-backed attention router for the case where most agent work
will not receive careful human review. It consumes the packet verifier result
and optional `consumer-attestation-check.json`, then emits one decision:

```text
auto_accepted_under_policy
human_attention_required
scoped_ratified
blocked_or_unowned
```

Run with the built-in attention policy:

```bash
npm run wutai:attention -- ./artifacts/cli/<session_id>
```

Use an explicit policy and trusted producer policy:

```bash
npm run wutai:attention -- \
  --attention-policy config/wutai-attention-policy.example.json \
  --trusted-producers ./trusted-producers.json \
  ./artifacts/cli/<session_id>
```

Write the derived artifacts beside the packet:

```bash
npm run wutai:attention -- \
  --write-artifacts \
  --attention-policy config/wutai-attention-policy.example.json \
  ./artifacts/cli/<session_id>
```

The output records whether attention is required, which seat should be pulled
in, whether a scoped ratification check was accepted, and whether the packet
was auto-accepted despite no scoped human review evidence. This is attention
routing over declared packet artifacts. It does not prove silent maintainer
review, reviewer identity, trace completeness, or runtime sandboxing.

## Scoped Ratification Gate

v0.8 keeps the v0.7 scoped ratification gate and adds optional review-session
instrumentation. The gate still asks whether a non-author reviewer performed
scoped ratification, refused for a real scope/evidence/accountability reason,
or merely rubber-stamped the packet. The new session scorer asks the prior
causal question: would the reviewer have looked anyway, and did the packet
change the scoped decision?

Create or supply a `consumer-attestation.json` that binds to the current
`manifest.json` SHA-256, packet id, task id, and producer adapter. A ratified
decision must include reviewer-written `declaredScope` and `excludedScope`.
Then run:

```bash
npm run wutai:attest -- \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

The unified entrypoint is equivalent:

```bash
npm run wutai -- attest-packet \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

To write the derived gate artifact:

```bash
npm run wutai:attest -- \
  --write-artifacts \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

To include v0.8 session instrumentation:

```bash
npm run wutai:attest -- \
  --review-session ./review-session.json \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

The gate re-runs packet verification first. It fails if the packet is blocked,
if the reviewer is missing or self-disallowed, if the attestation points at a
stale manifest hash, or if a ratified decision lacks scope boundaries. It
outputs `wedgeOutcome`, `moatOutcome`, and `experimentCell` so a
review-compression win cannot be counted as a ratification win. A scoped
refusal is a valid moat readout but exits non-zero because the work was not
accepted.

When `--review-session` is supplied, the output also includes:

- `attentionOutcome`: `attention_win`, `attention_null`, or `not_recorded`.
- `causalCredit`: `packet_changed_moat`, `packet_changed_attention`,
  `no_causal_credit`, `contaminated`, or `not_recorded`.
- `reviewSession`: recorded inputs, contamination reasons, no-credit reasons,
  and session notes.

If Arm 0 says the reviewer would not have looked, packet viewing can only earn
`packet_changed_attention`; it cannot count as packet-caused scoped
ratification. If Arm A already saw the same gap or produced the same scoped
decision from the diff alone, the packet gets `no_causal_credit`. If the
negative control is reported useful, a sham field is credited, trace
completeness is inadequate, or automatic reproduction is false, the session is
marked `contaminated`.

Session scoring does not change the original CI acceptance semantics. A scoped
ratification can still exit `0` while `causalCredit` is `contaminated`; that
means the work was accepted by the supplied attestation, but the experiment
cannot claim packet-caused ratification.

This is a ratification experiment harness, not reviewer identity proof,
runtime supervision, path-level witnessing, automatic GitHub PR metadata
extraction, or evidence that outside users already want to do the review.

## External Agent Integration Contract

v0.4 lets an external agent runtime produce a Wutai packet without pretending
that Wutai controlled that runtime. The contract is documented in
`docs/packet-contract.md`; stable schemas live in `schemas/`.

Use the Node SDK when another tool already ran the work and needs to hand Wutai
a packet:

```js
import { createPacket, writePacket, verifyPacket } from "wutai/node";

const packet = createPacket({
  argv: ["node", "-e", "console.log('hello')"],
  exitCode: 0,
  stdoutSummary: "hello",
  stderrSummary: "No output captured.",
  producer: {
    name: "my-agent",
    adapter: "myAgentAdapter",
    runtime: "node"
  }
});

const { packetDir } = await writePacket(packet);
const { trustVerdict } = await verifyPacket(packetDir, {
  trustPolicyProfile: "personal-default"
});
```

Use the wrapper example when you want a minimal external adapter that runs a
command, writes a packet, verifies it, and exits with the trust-verdict code:

```bash
npm run example:external-agent -- --quiet -- node -e "console.log('external')"
```

For stricter local or CI gates:

```bash
npm run example:external-agent -- \
  --quiet \
  --write-derived-artifacts \
  --trust-policy-profile ci-review \
  -- npm run test:evidence
```

The example GitHub Actions gate is
`.github/workflows/wutai-verify-packet.example.yml`.

## Agent Packet Inbox

v0.5 adds a local inbox over work-packet history. The inbox is derived from
stored task artifacts rather than a separate database. It reads
`manifest.json`, `trust-verdict.json`, `provenance.json`, `policy.json`, and
optional `retention.json`.

In the app, Agent Packet Inbox supports:

- search across packet id, producer, command, policy, and title
- producer filter
- verdict filter: `trusted`, `review_required`, `blocked`, or `no_verdict`
- retention filter: undecided, retained, rejected
- adapter registry review
- current inbox export as `agent-packet-inbox.json`
- per-packet retain/reject decisions written to `retention.json`

The adapter registry is `config/wutai-adapter-registry.json`. It records
adapter ids, packet types, signing support, proof commands, and boundary notes.
Registry entries are descriptive; they do not grant trust.

To run a packet proof for a registered external producer:

```bash
npm run example:adapter-proof -- \
  --adapter codexCli \
  --quiet \
  --write-derived-artifacts \
  -- node -e "console.log('codex proof')"
```

The v0.5 proof-harness entries for `codexCli`, `claudeCode`, and
`githubActions` prove that Wutai can receive and verify packets from those
producer identities. They are not official live integrations and do not imply
runtime supervision.

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

This includes the `verify-packet` regression matrix for trusted packets,
unsigned packets, revoked keys, tampered artifacts, missing override rationale,
high-risk allow, invalid policy schema, external rule-level trust policy, and
artifact writing.

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
- Add more regression coverage and validation for externally configurable rule
  overrides and trust policies.
- Package the verifier contract for external agent adapters.
- Define the minimal credential-broker boundary for task-scoped provider access.

Longer-term candidates:

- Live MCP proxy or runtime tool-call recorder.
- Browser-agent supervision.
- Live coding-agent adapter.
- Computer-use supervision after stronger safety controls.
- Mobile approval companion for high-risk confirmations.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
