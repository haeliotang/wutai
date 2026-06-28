# Wutai v0.4 Packet Contract

Wutai v0.4 defines an External Agent Integration Contract: an external agent,
coding tool, script runner, or wrapper can produce a local work packet that
Wutai can verify without owning the runtime that created it.

Wutai v0.5 consumes the same packet contract through Agent Packet Inbox. The
inbox indexes packet producer, trust verdict, provenance, policy, and local
retention state; it does not change the runtime boundary described here.

This is a packet contract, not a sandbox contract. Wutai verifies artifact
integrity, packet provenance, optional manifest attestation, local
trusted-producer policy, policy-review signals, and the final trust verdict. It
does not prove that the external process was sandboxed, that credentials were
brokered by Wutai, or that the external adapter enforced the policy it records.

## Directory Contract

A v0.4 external local-script packet is a directory with these files:

```text
manifest.json
report.md
policy.json
trace.json
ledger.json
audit.json
attestation.json   # optional
```

After Wutai verification, derived review artifacts may also be written:

```text
integrity.json
provenance.json
policy-review.json
trust-verdict.json
```

`manifest.json` is the root of trust for packet integrity. It must use:

```json
{
  "kind": "wutai.work_packet_manifest",
  "packetType": "local_script",
  "producer": {
    "adapter": "yourAdapterName"
  }
}
```

The verifier accepts any non-empty `producer.adapter` for `local_script`
packets. Trust is not granted by adapter name alone. A packet can only become
`trusted` when the local trust policy and optional trusted-producer policy allow
it.

## Required Artifacts

`policy.json`
: `kind: "wutai.cli_policy_preflight"`. For external adapters this can be a
declaration supplied by the adapter. It should state the decision, matched
rules, rationale, execution mode, command, argv, and limitations.

`trace.json`
: `kind: "wutai.local_script_trace"`. It records the command, argv, working
directory, execution mode, timestamps, exit code, bounded stdout/stderr
summaries, and any adapter-reported touched files or produced artifacts.

`ledger.json`
: `kind: "wutai.session_ledger"`. It records the task, permissions, events, and
user-facing session summary.

`audit.json`
: `kind: "wutai.session_audit"`. It records permissions, policy, events,
tool-call style command metadata, runtime events, and credential-grant metadata
when provided by the adapter.

`report.md`
: A human-readable summary of the command, producer, policy declaration,
results, and known blind spots.

`attestation.json`
: Optional `kind: "wutai.packet_attestation"`. It signs the final
`manifest.json` bytes with ECDSA P-256 SHA-256. A valid signature detects
manifest tampering but does not make the producer trusted unless the public key
hash also matches local trusted-producer policy.

Schemas for the stable packet surface live in `schemas/`.

## Trust Verdict

`npm run wutai:verify -- <packet-dir>` emits a `wutai.trust_verdict` JSON object
and exits with:

```text
0   trusted
10  review_required
20  blocked
2   usage or packet-read error
```

The trust verdict combines:

- manifest artifact hash checks
- required artifact and schema-kind checks
- optional packet attestation verification
- trusted-producer policy matching
- policy-review checks for denies, overrides, missing rationale, and warnings
- local trust-policy profiles or a caller-supplied rule-level trust policy

Default profile:

```bash
npm run wutai:verify -- ./packet
```

Strict local profile:

```bash
npm run wutai:verify -- --trust-policy-profile strict-local ./packet
```

Caller-supplied trust policy:

```bash
npm run wutai:verify -- --trust-policy ./policy.json ./packet
```

Persist derived review artifacts:

```bash
npm run wutai:verify -- --write-artifacts ./packet
```

Built-in profiles are configured in `config/wutai-trust-policy-profiles.json`:

- `personal-default`: unsigned or warning-bearing packets require review.
- `strict-local`: unsigned packets and policy warnings block by default.
- `ci-review`: CI-oriented profile; high-risk allow and missing rationale block.

## Node SDK

The Node SDK is exported at `./node` and available directly at
`sdk/node/index.mjs`.

```js
import {
  createPacket,
  writePacket,
  verifyPacket,
} from "./sdk/node/index.mjs";

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

const { packetDir } = await writePacket(packet, {
  outputDir: "artifacts/external-agent"
});
const { trustVerdict } = await verifyPacket(packetDir, {
  trustPolicyProfile: "personal-default"
});
```

The SDK writes Wutai-compatible packet files and delegates verification to the
same verifier used by the CLI. It does not execute commands.

## Wrapper Example

`examples/external-agent-wrapper.mjs` shows a complete external adapter:

```bash
npm run example:external-agent -- --quiet -- node -e "console.log('external')"
```

The example:

- runs the explicit command outside Wutai
- captures bounded stdout/stderr summaries
- writes a packet through the SDK
- verifies the packet
- prints the trust verdict result
- exits using the trust-verdict exit code

For CI or local automation:

```bash
npm run example:external-agent -- \
  --quiet \
  --write-derived-artifacts \
  --trust-policy-profile ci-review \
  -- npm run test:evidence
```

## Integration Boundary

External adapters must not claim Wutai supervised the runtime unless the runtime
actually went through a future Wutai-controlled permission broker or sandbox.
Today the v0.4 contract supports:

- packet production by non-Wutai agents
- local manifest hash verification
- optional manifest signing and trusted-producer matching
- rule-level trust policy evaluation
- machine-readable trust verdicts for CI and other agents

Today the v0.4 contract does not support:

- live filesystem, network, browser, shell, or credential mediation
- guaranteed identity for an external producer
- proof that adapter-declared policy was enforced upstream
- automatic trust from a self-declared producer name or embedded public key
