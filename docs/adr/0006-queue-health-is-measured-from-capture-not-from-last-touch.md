# 5. Queue health is measured from capture, not from last touch

Date: 2026-08-31

## Status

Accepted

Settles the triage-survival criterion in [STRATEGY.md](../../STRATEGY.md) and
OQ8 of [the capture-path plan](../plans/2026-08-28-1123-feat-zero-decision-capture-path-plan.md).
Depends on [4. Provenance marker rides in the tension body](0004-provenance-marker-rides-in-the-tension-body.md)
for the marker that makes clipped items identifiable at all.

## Context

STRATEGY.md defined *triage survival rate* as the share of clipped items
"processed in a tactical or governance meeting rather than deleted or left to
rot." Nothing in the practitioner's queue is ever deleted, so survival is
effectively 100% while items sit unprocessed for up to 22 months. "Left to rot"
is precisely the state the measure cannot detect, because rotting and surviving
are indistinguishable to it.

The obvious repair is to add an age measure. That repair has a trap in it, and
the trap is only visible against real data.

Measured live on 2026-08-31 — 15 unprocessed tensions across the Anchor Circle
tree, two of them clipped that day:

| clock | median | p90 | max |
|---|---|---|---|
| since `created_at` | 38 d | 662 d | 671 d |
| since `updated_at` | 31 d | 38 d | 38 d |

Five of the fifteen are past a year on the capture clock. **Nothing is past 38
days on the touch clock.** An inbox-processing pass on 2026-07-31 sharpened
every aged item — adding provenance notes, applying the S.5.5.1d independence
test, assigning venues — without resolving any of them.

So a "days since last activity" measure would report this queue as immaculate.
It would reproduce survival rate's failure mode one level down: mistaking
engagement for resolution, exactly as survival mistakes non-deletion for health.

## Decision

Queue health is measured as the **p90 age of unprocessed clipped items since
capture**. The touch clock is reported beside it, never in place of it.

Survival rate is retained, but only as a tripwire for outright deletion, and is
marked in STRATEGY.md as never read alone. Inflow versus outflow per period
joins it, because the capture path exists to raise inflow and a growing
unworked queue must not read as improving health.

Thresholds apply to clipped items; the whole unprocessed queue is reported
alongside so that a clipped sample of two stays readable. p90 since capture
≤ 90 days, with no clipped item unprocessed past 180.

We deliberately choose **p90 rather than median**. The median of this queue is
38 days on both clocks — it is blind to the entire aged tail, which is where
every item this metric exists to find is sitting.

## Consequences

The metric now reports failure on the queue as it stands. The 90-day threshold
is above what today's items would pass, and that is intended: a threshold
calibrated to be passable on day one would restate the defect being fixed.

Two clocks means two numbers to read rather than one. The cost buys a
distinction nothing else supplies — an item never looked at and an item
repeatedly reworked but never resolved are different failures with different
remedies, and the capture clock alone cannot separate them.

A breach of the capture-age threshold is ambiguous in a way the metric does not
resolve: it can mean the capture path is over-producing, or that the meeting
cadence consuming the queue has lapsed. Those have opposite remedies, and the
inflow-versus-outflow companion is likely but not certainly sufficient to tell
them apart. What a breach routes to is tracked in issue #38, not settled here.

The touch clock depends on `updated_at`, which GlassFrog moves for any edit.
Sharpening a tension and correcting a typo are the same event to it, so the
touch clock is a coarse signal and is not thresholded.
