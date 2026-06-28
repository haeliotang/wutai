# Scoped Ratification Prereg v0.7

This prereg is intentionally thin. It exists to prevent a future reviewer
session from turning a review-compression win into a ratification claim.

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

## Baseline Arm

Before showing the packet, capture:

- Whether the reviewer would sign their name to the work.
- The scope they would sign, if any.
- The risks they can restate from the diff alone.

If the reviewer already refuses all agent work, or already sees the target
scope/evidence/empty-seat gap from the diff alone, the packet cannot claim
causal credit for the refusal.

## Packet Arm

After showing the packet, capture:

- Did the packet change where they looked or what they asked?
- Did they sign a declared scope?
- Did they explicitly exclude any scope?
- Did they refuse, and why?
- Did they attribute behavior change to a sham or irrelevant field?

## Outcome Grid

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

## Pass Rules

A single positive case is not enough to build product.

The strongest first-session pass is:

```text
negative-control null + real-change MOAT-win
```

`WEDGE-win + MOAT-null` only licenses review-compression bait. It does not
license scoped ratification.

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
