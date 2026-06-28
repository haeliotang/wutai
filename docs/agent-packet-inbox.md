# Agent Packet Inbox

Wutai v0.5 adds an Agent Packet Inbox over the existing task history. It does
not introduce a second database. The inbox is a derived index over packet
artifacts already stored in each task:

```text
manifest.json
trust-verdict.json
provenance.json
policy.json
retention.json   # optional
```

The inbox answers one operational question: what agent-produced work has landed
on this machine, who produced it, what local trust verdict did Wutai assign, and
should the packet be retained or rejected?

## What The Inbox Shows

Each packet row records:

- packet id, packet type, task status, and updated time
- producer adapter and registry label
- command and exit code when the packet has a local-script trace
- trust verdict: `trusted`, `review_required`, `blocked`, or `no_verdict`
- integrity and provenance status
- policy decision and profile
- attestation state: missing, failed, verified, or trusted
- local retention decision: `retained`, `rejected`, or undecided

The UI supports filtering by search text, producer, verdict, and retention
state. The inbox export writes `agent-packet-inbox.json` for the current filter
set.

## Adapter Registry

The registry lives in `config/wutai-adapter-registry.json` and is mirrored in
the frontend runtime. Registry entries are descriptive, not trust grants. They
declare:

- `adapterId`
- label and category
- supported packet types
- whether the adapter supports signing
- integration status: `native`, `proof_harness`, `external_contract`, or
  `planned`
- boundary text that states what Wutai does and does not control

v0.5 includes proof-harness entries for:

- `codexCli`
- `claudeCode`
- `githubActions`

These entries prove the packet contract can represent those producers. They do
not claim official integration, live supervision, or runtime sandboxing.

## Adapter Proof Runner

Use `examples/adapter-proof-runner.mjs` to wrap an explicit command with a
registered adapter id:

```bash
npm run example:adapter-proof -- \
  --adapter codexCli \
  --quiet \
  --write-derived-artifacts \
  -- node -e "console.log('codex proof')"
```

The runner:

- loads the adapter registry
- runs the explicit command outside Wutai
- writes a Wutai `local_script` packet through the Node SDK
- verifies the packet
- optionally writes derived review artifacts
- exits with the trust-verdict exit code

For real use, replace the command after `--` with the actual external agent or
CI command. The proof runner still only gives Wutai packet-level review.

## Retention Decision

From the packet review UI, a reviewer can mark a packet as retained or rejected.
Wutai writes:

```text
retention.json
```

This is a local decision artifact. It does not delete external files, alter the
original agent runtime, or prove that the packet was safe. It only records how
the local reviewer wants Wutai to treat the packet downstream.
