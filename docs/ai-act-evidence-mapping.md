# Attention-Decision Evidence to EU AI Act Mapping (v0.10)

One-page working map: which fields of `attention-decision.json` and the
scoped-ratification artifacts it consumes may serve as development-process
evidence for teams preparing EU AI Act high-risk obligations. This is a
conversation aid, not a legal opinion, conformity claim, or compliance
guarantee.

## Scope Caveat

A coding agent is not automatically an Annex III high-risk AI system. This map
targets one narrower situation: a provider or deployer of a high-risk AI system
uses coding agents during development and wants process evidence for quality
management, technical documentation, logging, and human oversight.

Timeline caveat (as amended by the Digital Omnibus on AI; Parliament vote
2026-06-16, Council final approval 2026-06-29): Annex III high-risk
obligations — the chapter containing Art. 12 record-keeping, Art. 14 human
oversight, and Art. 17 QMS — apply from 2027-12-02 (fixed date; originally
2026-08-02). Annex I product-embedded high-risk applies from 2028-08-02.
Art. 50 transparency remains on 2026-08-02 but does not map to this
artifact. Dates were amended once already; verify against the Official
Journal before relying on them externally.

## Field-Level Map

| Wutai artifact / field | AI Act hook | What it evidences |
| --- | --- | --- |
| `decision` (`auto_accepted_under_policy` / `human_attention_required` / `scoped_ratified` / `blocked_or_unowned`) | Human oversight / deployer assignment / logging | Every agent work packet was routed to an explicit oversight outcome; no silent pass-through is represented as review. |
| `no_human_review` audit reason | Human oversight | Absence of human review is recorded as absence, not implied as oversight. |
| `accountable_seat_missing` audit reason + `accountable_seat_required` blocker + `reasonSeats` routing | Deployer assignment / quality management | Whether a competent seat was configured for this packet type or producer, and whether policy enforced it before auto acceptance. |
| `permissionBasis[]` vs `riskSignals[]`; grant restricted to `mechanical_allowlist` and passed `deterministic_external_check` | Automation-bias guard / human oversight | Model judgments, including model-backed external checks, cannot self-authorize release; they can only escalate to a human. |
| `scoped_ratified` with `declaredScope` and `excludedScope`; unscoped sign-off flagged as theater | Human oversight | Human acceptance, where recorded, was bounded and falsifiable: the reviewer stated what they did and did not stand behind. |
| `manifest.json` SHA-256 binding, signed provenance, trusted-producer key policy | Logging / technical documentation | Tamper-evident linkage from the decision record to the exact reviewed packet artifact. |
| `policy.policyId`, `sourceLabel`, external checks with `determinism`, and optional `configSha256` | Quality management | Which local policy version authorized each auto acceptance, and whether external checks were declared deterministic or model-backed. |
| `limitation` field on each decision | Boundary documentation | The artifact carries its own limits instead of relying on a separate disclaimer. |

## What This Does Not Evidence

- Runtime sandboxing or live supervision of the agent.
- Reviewer identity proof, or detection of silent unrecorded review.
- Completeness or authenticity of producer-declared traces.
- Independent proof that a declared external check is deterministic.
- Conformity of the high-risk system itself. This is process evidence feeding a
  provider's or deployer's documentation, nothing more.

## Question for the Policy Owner

> Would your auditor accept this artifact as part of logging, human-oversight,
> or quality-management evidence for agent-assisted development? If not, which
> field is missing?

## Sources to Re-check Before External Use

- European Commission, AI Act overview and implementation timeline:
  https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- Regulation (EU) 2024/1689 official text:
  https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng
