# Attention Decision Gate v0.10

Wutai v0.9 added an attention and accountability gate for agent work that may
not receive careful human review. v0.10 hardens the permission semantics for
policy auto acceptance.

The gate does not decide whether a diff is semantically correct. It routes a
verified packet into one of four states:

```text
auto_accepted_under_policy
human_attention_required
scoped_ratified
blocked_or_unowned
```

## What It Consumes

`wutai attention-decision` re-runs packet verification, then optionally reads a
current `consumer-attestation-check.json`.

Inputs:

- packet directory with `manifest.json` and packet artifacts.
- optional `consumer-attestation-check.json` from the scoped ratification gate.
- optional trusted producer policy for packet verification.
- optional trust policy or trust-policy profile for packet verification.
- optional `wutai.attention_policy`.

## Decision Meanings

`auto_accepted_under_policy`

The packet verifier returned `trusted`, the attention policy allows trusted
packets to pass without scoped human ratification, any required accountable
seat is present, and the packet has at least one grant-eligible
`permissionBasis`. The output still records `no_human_review` as an audit
signal.

`human_attention_required`

The packet is not blocked, but the trust verdict or attention policy requires a
human seat. Common reasons include untrusted producer, policy warnings,
high-risk allow, reviewer-required trust rules, or missing scoped
ratification. Model-backed external checks, semantic comparisons, and model
judgments can only route here; they cannot grant auto acceptance.

`scoped_ratified`

A current `consumer-attestation-check.json` accepted scoped ratification for
the same packet id and manifest hash.

`blocked_or_unowned`

The packet verifier blocked the packet, or the attention policy requires an
accountable seat for auto acceptance and no matching seat is configured.

## Permission Basis Typing

v0.10 separates facts that may grant policy auto acceptance from facts that can
only raise attention.

`permissionBasis[]`

Grant-eligible basis entries. Each entry has `grantEligible: true` and an
`evaluationMethod` that is allowed to support `auto_accepted_under_policy`.
Current grant-eligible methods:

- `mechanical_allowlist`: Wutai verifier or local policy facts such as
  `verdict=trusted` or a trusted-producer key match.
- `deterministic_external_check`: an external check declared deterministic by
  the attention policy and recorded with `status: "pass"`.

`riskSignals[]`

Non-granting signals. Each entry has `grantEligible: false`. They may explain
why attention is required, but they cannot support auto acceptance. Current
non-granting methods include:

- `model_backed_external_check`
- `semantic_comparison`
- `model_judgment`
- deterministic external checks that failed or were not recorded

This distinction is structural: "external" is not the same as "mechanical".
A third-party check that is model-backed is recorded as a risk signal even when
it reports success. Wutai records the determinism declared by local policy; it
does not independently prove how a third-party checker was implemented.

## CLI Usage

Built-in attention policy:

```bash
npm run wutai:attention -- ./artifacts/cli/<session_id>
```

Explicit attention policy:

```bash
npm run wutai:attention -- \
  --attention-policy config/wutai-attention-policy.example.json \
  ./artifacts/cli/<session_id>
```

Trusted producer policy:

```bash
npm run wutai:attention -- \
  --trusted-producers ./trusted-producers.json \
  ./artifacts/cli/<session_id>
```

Write artifacts:

```bash
npm run wutai:attention -- \
  --write-artifacts \
  ./artifacts/cli/<session_id>
```

The unified entrypoint is equivalent:

```bash
npm run wutai -- attention-decision ./artifacts/cli/<session_id>
```

Exit codes:

```text
0   auto_accepted_under_policy or scoped_ratified
10  human_attention_required
20  blocked_or_unowned
2   usage, read, JSON, or packet verification error
```

## Attention Policy Shape

The example policy is `config/wutai-attention-policy.example.json`.

```json
{
  "schemaVersion": 1,
  "kind": "wutai.attention_policy",
  "policyId": "example-attention-policy-v0.10",
  "autoAcceptTrusted": true,
  "requireAccountableSeatForAutoAccept": true,
  "accountableSeats": [
    {
      "id": "repo-maintainer",
      "role": "maintainer",
      "match": {
        "packetType": "local_script"
      }
    }
  ],
  "externalChecks": [
    {
      "checkId": "required_tests_passed",
      "label": "Required test suite passed",
      "status": "pass",
      "determinism": "deterministic",
      "source": "ci"
    },
    {
      "checkId": "ai_review_passed",
      "label": "AI review passed",
      "status": "pass",
      "determinism": "model_backed",
      "source": "external-ai-reviewer"
    }
  ],
  "reasonSeats": {
    "untrusted_producer": "maintainer",
    "high_risk_allow": "security_reviewer",
    "accountable_seat_missing": "owner",
    "permission_basis_missing": "owner",
    "model_backed_external_check": "maintainer"
  }
}
```

Schemas:

- `schemas/attention-policy.schema.json`
- `schemas/attention-decision.schema.json`

## Boundary

Implemented:

- Packet verifier re-run before attention routing.
- Optional scoped-ratification check binding by packet id and manifest hash.
- Policy-backed accountable-seat matching by packet type or producer adapter.
- Explicit `no_human_review` audit signal when no scoped ratification is
  accepted.
- `permissionBasis[]` and `riskSignals[]` split in `attention-decision.json`.
- Auto acceptance requires at least one grant-eligible permission basis.
- Deterministic external checks can grant permission only when they pass.
- Model-backed external checks are always non-granting risk signals.
- Machine-readable `attention-decision.json`.

Not implemented:

- Silent GitHub reviewer detection.
- Cryptographic proof of reviewer identity.
- Automatic PR owner extraction from CODEOWNERS.
- Runtime supervision, sandboxing, or credential mediation.
- Path-level witnessing of external runtime behavior.
- Independent proof that a declared external check is deterministic.
- Proof that external users want this routing.
