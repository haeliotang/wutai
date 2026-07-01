# Attention Decision Gate v0.9

Wutai v0.9 adds an attention and accountability gate for agent work that may
not receive careful human review.

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
packets to pass without scoped human ratification, and any required accountable
seat is present. The output still records `no_human_review` as an audit signal.

`human_attention_required`

The packet is not blocked, but the trust verdict or attention policy requires a
human seat. Common reasons include untrusted producer, policy warnings,
high-risk allow, reviewer-required trust rules, or missing scoped
ratification.

`scoped_ratified`

A current `consumer-attestation-check.json` accepted scoped ratification for
the same packet id and manifest hash.

`blocked_or_unowned`

The packet verifier blocked the packet, or the attention policy requires an
accountable seat for auto acceptance and no matching seat is configured.

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
  "policyId": "example-attention-policy-v0.9",
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
  "reasonSeats": {
    "untrusted_producer": "maintainer",
    "high_risk_allow": "security_reviewer",
    "accountable_seat_missing": "owner"
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
- Machine-readable `attention-decision.json`.

Not implemented:

- Silent GitHub reviewer detection.
- Cryptographic proof of reviewer identity.
- Automatic PR owner extraction from CODEOWNERS.
- Runtime supervision, sandboxing, or credential mediation.
- Path-level witnessing of external runtime behavior.
- Proof that external users want this routing.
