# Scoped Ratification Gate v0.7

Wutai v0.7 turns the v0.6 consumer attestation gate into a scoped
ratification experiment harness. The goal is not to prove market demand in
code. The goal is to make the future reviewer session harder to self-certify.

This harness separates two outcomes:

- `wedgeOutcome`: did the packet change where the reviewer looked or what they
  asked?
- `moatOutcome`: did the reviewer execute a scoped ratification act, refuse it
  for a scope/evidence/empty-seat reason, rubber-stamp it, or do nothing?

Packet remains plumbing. The product hypothesis is the scoped, named second
seat across a trust boundary.

## What It Checks

`wutai attest-packet` verifies the selected packet first, then checks a sibling
or explicitly supplied `consumer-attestation.json`.

The harness records:

- `gateDecision`: `accepted`, `not_accepted`, or `invalid`.
- `wedgeOutcome`: `wedge_win`, `wedge_null`, or `not_recorded`.
- `moatOutcome`: `scoped_ratified`, `refused_with_scope_reason`,
  `theater_signature`, or `no_action`.
- `experimentCell`: the cross-product used to prevent a wedge win from being
  counted as a moat win.

Exit codes remain CI-compatible:

```text
0   accepted scoped ratification
20  not accepted, invalid, refused, theater, blocked, or stale
2   usage, read, or JSON error
```

`refused_with_scope_reason` is a valid moat readout, but it is not an
acceptance pass. It exits `20` because the reviewer did not accept the work.

## Attestation Shape

```json
{
  "schemaVersion": 1,
  "kind": "wutai.consumer_attestation",
  "subject": {
    "manifestSha256": "<sha256 of manifest.json bytes>",
    "packetId": "<manifest.packetId>",
    "taskId": "<manifest.taskId>",
    "producerAdapter": "<manifest.producer.adapter>"
  },
  "reviewer": {
    "id": "external-reviewer",
    "name": "External Reviewer",
    "role": "maintainer",
    "source": "github_review"
  },
  "decision": "ratified",
  "declaredScope": "I ratify only the manifest-bound packet artifacts for this task.",
  "excludedScope": "I do not ratify trace completeness, sandboxing, or behavior outside the manifest.",
  "scopeReasons": [],
  "wedge": {
    "changedReviewBehavior": false,
    "signals": ["none"],
    "statement": "The packet did not change where I looked."
  },
  "experiment": {
    "arm": "packet",
    "wizardOfOz": true,
    "baselineSignatureDisposition": "captured in the prereg session notes",
    "baselineRiskRestatement": "captured in the prereg session notes",
    "shamFieldAttributed": false
  },
  "reviewedAt": "2026-06-28T00:00:00.000Z",
  "statement": "I reviewed the packet artifacts and ratify this result."
}
```

The schema lives at `schemas/consumer-attestation.schema.json`; an example
fixture lives at `examples/consumer-attestation.example.json`.

## Moat Outcomes

`scoped_ratified`

The reviewer ratified and wrote both `declaredScope` and `excludedScope`. This
is the only acceptance pass.

`refused_with_scope_reason`

The reviewer refused, rejected, or requested changes and supplied at least one
scope reason:

```text
intent_drift
empty_seat
unevidenced_claims
scope_boundary
trace_incomplete
other
```

This is a moat win for the experiment, but not an acceptance pass.

`theater_signature`

The reviewer ratified without both `declaredScope` and `excludedScope`. This is
an anti-signal, not a null. It means the act degraded into a rubber stamp.

`no_action`

No scoped ratification or scoped refusal was observed.

## CLI Usage

Default attestation path:

```bash
npm run wutai:attest -- \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

Explicit attestation path:

```bash
npm run wutai:attest -- \
  --attestation ./consumer-attestation.json \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

Write derived artifacts beside the packet:

```bash
npm run wutai:attest -- \
  --write-artifacts \
  --disallow-reviewer haeliotang \
  ./artifacts/cli/<session_id>
```

This writes `consumer-attestation-check.json`. It may also write the verifier's
derived artifacts when `--write-artifacts` is supplied.

The unified entrypoint is equivalent:

```bash
npm run wutai -- attest-packet --disallow-reviewer haeliotang ./artifacts/cli/<session_id>
```

## Boundary

Implemented:

- Packet verifier re-run before ratification.
- Manifest-hash binding.
- Packet identity binding.
- Non-self reviewer list.
- Scoped ratification requirement for acceptance.
- Theater signature anti-signal.
- Scoped refusal readout for `intent_drift`, `empty_seat`, and
  `unevidenced_claims`.
- Separate `wedgeOutcome`, `moatOutcome`, and `experimentCell`.
- Machine-readable `consumer-attestation-check.json`.
- CLI and CI-template usage.

Not implemented:

- Cryptographic identity proof for the reviewer.
- Automatic extraction from GitHub PR approval metadata.
- Runtime supervision, sandboxing, or credential mediation.
- Path-level witnessing; Wutai records a declared trace supplied by the
  producer.
- Proof that non-Hao users already want to perform scoped ratification.

Use `docs/ratification-prereg.md` before running a real reviewer session.
