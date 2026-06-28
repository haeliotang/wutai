# Consumer Attestation Gate v0.6

Wutai v0.6 adds a post-hoc consumer gate for agent packets. The goal is to test
whether a packet is actually consumed and ratified by a reviewer who is not the
packet author, without claiming Wutai supervised the original runtime.

This is a demand and accountability wedge, not a sandbox.

## What It Checks

`wutai attest-packet` verifies the selected packet first, then checks a sibling
or explicitly supplied `consumer-attestation.json`.

The gate passes only when:

- The Wutai packet verifier does not return `blocked`.
- The attestation kind is `wutai.consumer_attestation`.
- The decision is `ratified`.
- `reviewer.id` is present.
- `reviewer.id` is not in the caller-supplied `--disallow-reviewer` list.
- The attestation subject binds to the current `manifest.json` SHA-256.
- The attestation subject matches `packetId`, `taskId`, and `producerAdapter`.
- The attestation includes a non-empty review statement and timestamp.

Exit codes:

```text
0   passed
20  failed
2   usage, read, or JSON error
```

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
  "reviewedAt": "2026-06-28T00:00:00.000Z",
  "statement": "I reviewed the packet artifacts and ratify this result."
}
```

The schema lives at `schemas/consumer-attestation.schema.json`; an example
fixture lives at `examples/consumer-attestation.example.json`.

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

## GitHub Actions Example

`.github/workflows/wutai-consumer-attestation.example.yml` is a template for
using the gate in CI. It expects a packet directory and a consumer attestation
artifact. The workflow disallows a configured reviewer id, then fails the job if
the packet is blocked, stale, self-attested, rejected, or missing ratification.

This example does not automatically prove that the GitHub reviewer identity is
the same person named in `consumer-attestation.json`. A production workflow
would need to generate or validate the attestation from trusted GitHub review
metadata.

## Boundary

Implemented:

- Packet verifier re-run before ratification.
- Manifest-hash binding.
- Packet identity binding.
- Non-self reviewer list.
- `ratified` decision requirement.
- Machine-readable `consumer-attestation-check.json`.
- CLI and CI-template usage.

Not implemented:

- Cryptographic identity proof for the reviewer.
- Automatic extraction from GitHub PR approval metadata.
- Runtime supervision, sandboxing, or credential mediation.
- Proof that non-Hao users already want to perform this review.

The v0.6 question is narrower: can Wutai force a concrete review act into the
workflow, and can that act be audited against the packet that was actually
produced?
