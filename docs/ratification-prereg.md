# Scoped Ratification Prereg v0.8

This prereg is intentionally thin. It exists to prevent a future reviewer
session from turning an attention win or review-compression win into a
ratification claim.

## Hypothesis

A non-Hao reviewer may use a Wutai packet to execute a scoped ratification act:
either they sign a declared boundary, or they refuse because the packet exposes
intent drift, an empty accountable seat, or unevidenced claims.

## Required Setup

- One real reviewer who is not Hao.
- One agent-generated change with a plausible trust-boundary handoff.
- One packet rendered from the available declared trace.
- One negative-control change where the packet should add no meaningful review
  signal.
- Hao is not present while the reviewer forms the decision.

The first run is Wizard-of-Oz unless explicitly proven otherwise: the packet
may be hand-rendered from a clean trace. Any pass is conditional on the same
fields later being reproducible automatically from a complete trace.

## Arm 0: Would-Look Baseline

Before showing the diff or packet, capture:

- Whether the reviewer would look at this PR/change at all.
- Why they would or would not enter the review scene.

If the reviewer would not have looked, later packet viewing can only count as
`ATTENTION-win`. It cannot count as packet-caused scoped ratification.

## Arm A: Diff-Only Baseline

Before showing the packet, capture:

- Whether the reviewer would sign their name to the work.
- The scope they would sign, if any.
- The risks they can restate from the diff alone.

If the reviewer already refuses all agent work, or already sees the target
scope/evidence/empty-seat gap from the diff alone, the packet cannot claim
causal credit for the refusal.

## Arm B: Packet-Assisted Arm

After showing the packet, capture:

- Did the packet change where they looked or what they asked?
- Did they sign a declared scope?
- Did they explicitly exclude any scope?
- Did they refuse, and why?
- Did they attribute behavior change to a sham or irrelevant field?

## Outcome Grid

`ATTENTION-win`

The packet caused the reviewer to enter a review they otherwise would not have
entered. This is a distribution/attention wedge, not a ratification moat.

`ATTENTION-null`

The reviewer would have looked anyway, or attention was not changed.

`WEDGE-win`

The packet changed where the reviewer looked or what they asked.

`WEDGE-null`

The packet did not change where the reviewer looked or what they asked.

`MOAT-win`

The reviewer either:

- refuses with a scope/evidence/empty-seat reason, or
- ratifies with a declared scope they can restate.

`THEATER`

The reviewer signs but cannot restate the scope. This is an anti-signal, not a
null.

`MOAT-null`

No scoped ratification or scoped refusal occurred.

`CAUSAL-CREDIT: packet_changed_moat`

Only valid when all are true:

- Arm 0 says the reviewer would have looked anyway.
- Arm A did not produce the same scoped decision.
- Arm A did not already see the target gap.
- Arm B produced scoped ratification or scoped refusal.
- Negative control and sham controls did not fire.

`CAUSAL-CREDIT: packet_changed_attention`

Valid when Arm 0 says the reviewer would not have looked, but Arm B shows they
viewed the packet. This cannot be upgraded into a moat claim.

`CAUSAL-CREDIT: contaminated`

Use when the negative control is reported useful, the sham field is credited,
the trace is incomplete enough to hide scope/evidence gaps, or the packet
fields cannot later be reproduced automatically.

## Pass Rules

A single positive case is not enough to build product.

The strongest first-session pass is:

```text
negative-control null + Arm 0 would-look + Arm A diff-only null + Arm B MOAT-win
```

`WEDGE-win + MOAT-null` only licenses review-compression bait. It does not
license scoped ratification.

`ATTENTION-win + MOAT-win` licenses only attention/distribution value unless a
separate would-look case also produces packet-caused moat credit.

`THEATER` is worse than null because it shows the act can degrade into a green
check.

## Kill Conditions

Stop the run or mark it contaminated if:

- The reviewer only looks at the diff and ignores the packet.
- The packet only repeats what the diff already made obvious.
- The negative-control packet is reported as useful.
- The reviewer attributes behavior change to a sham field.
- The reviewer signs but cannot restate the declared scope.
- The packet was hand-rendered and the same fields cannot later be reproduced
  automatically.
- The trace is incomplete enough that intent drift or unevidenced claims could
  be hidden by producer omission.

## Scope Vocabulary

Use separate terms:

- `intent scope`: what the user asked the agent to do.
- `epistemic scope`: what the packet claims and what evidence supports.
- `declared ratification scope`: what the reviewer chooses to sign or exclude.

Do not call the current declared-trace path a witness. Wutai records supplied
trace data unless and until a path-level witness exists.
