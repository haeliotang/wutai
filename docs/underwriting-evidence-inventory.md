# Evidence Inventory for AI-Liability Underwriting and Claims Forensics

One page. What Wutai's `attention-decision.json` artifact records about
agent-produced work, written for two consumers: an underwriter pricing the
process-control risk of an organization that builds software with coding
agents, and a claims/forensics reader reconstructing what was authorized
after a loss.

Status honesty first: this is an open (Apache-2.0) reference format at
v0.10. It has no production deployments and no external adopters yet. It is
offered as a concrete artifact to react to, not as an established standard.

## What one decision record contains

| Field | What it tells an underwriter or claims reader |
|---|---|
| `decision` — `auto_accepted_under_policy` / `human_attention_required` / `scoped_ratified` / `blocked_or_unowned` | Every unit of agent work was routed to an explicit oversight outcome. There is no silent pass-through state. |
| `permissionBasis[]` (each entry `grantEligible: true`, `evaluationMethod` restricted to `mechanical_allowlist` or `deterministic_external_check`) | What authorized an auto-acceptance. Only replayable, deterministic facts can grant release — a hash match, a trusted signing key, a passing test suite. Enforced in the JSON schema, not by convention. |
| `riskSignals[]` (each entry `grantEligible: false`; methods include `model_backed_external_check`, `semantic_comparison`, `model_judgment`) | Model-derived judgments are structurally barred from authorizing release. They can only escalate to a human. An "AI said it was safe" release path cannot be expressed in this format. |
| `no_human_review` audit reason (unconditional) | When no human reviewed the work, the record says so — including on auto-accepted work. Absence of oversight is recorded as absence, never dressed as oversight. |
| `accountability.accountableSeatStatus` + `accountable_seat_missing` / `accountable_seat_required` reasons | Whether a named responsible party existed for this class of work, and whether policy blocked release without one. The built-in default policy refuses auto-acceptance with no accountable seat. |
| `accountability.scopedRatification` (`declaredScope`, `excludedScope`, staleness binding to `manifestSha256`) | Where a human did sign, the record shows the exact scope they accepted and the scope they explicitly declined to stand behind. An unscoped signature is flagged as a theater anti-signal, not counted as review. |
| `packet.manifestSha256`, signed provenance, trusted-producer key policy | Tamper-evident linkage from the decision record to the exact work artifact it covers. |
| `policy.policyId` + `sourceLabel` + `requireAccountableSeatForAutoAccept` | Which policy version, configured by whom, authorized each auto-acceptance — delegation is auditable, not ambient. |
| `limitation` (on every record) | A machine-carried statement of what the record does not prove. |

## Worked examples (committed, regenerable)

- [`examples/attention-decision.auto-accepted.example.json`](../examples/attention-decision.auto-accepted.example.json)
  — trusted signed packet + passing deterministic check + assigned seat →
  auto-accepted, with `no_human_review` still on the record.
- [`examples/attention-decision.blocked-unowned.example.json`](../examples/attention-decision.blocked-unowned.example.json)
  — same packet under the built-in default policy with no accountable seat →
  blocked, exit code 20.

Regenerate: `npm run wutai:run -- -- <command>` to produce a packet, then
`npm run wutai:attention -- <packet-dir> --write-artifacts` (see
[attention-decision-gate.md](attention-decision-gate.md)).

## What this artifact does NOT prove

- Trace completeness or authenticity. Traces are producer-declared; an agent
  runtime that omits actions defeats the record. There is no on-path witness.
- Reviewer identity. `scoped_ratification` binds a name and a scope to a
  hash; it does not verify the person.
- Silent review. A human who read the diff without recording it appears as
  `no_human_review`.
- Runtime control. Nothing here sandboxes, blocks, or supervises the agent
  at execution time.
- Semantic correctness of the work itself. Provenance is orthogonal to
  whether the code is right.

If a field you need for underwriting due diligence or claims replay is
missing from this inventory, that gap is exactly what we want to hear about.
