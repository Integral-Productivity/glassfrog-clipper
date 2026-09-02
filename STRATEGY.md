---
name: GlassFrog Clipper
last_updated: 2026-08-31
---

# GlassFrog Clipper Strategy

## Purpose

Holacracy practitioners sense tensions while deep in other work — reading, browsing, mid-task — but filing one means leaving that work for GlassFrog. The thought doesn't survive the switch: by the time GlassFrog is open, the tension has gone flat, or gone entirely.

## Positioning

Capture never blocks on a decision at capture time, and never discards one already made — a single keystroke files the item with zero required input, given a capture role configured once in advance, while role and work-type are always offered and always kept when the practitioner already knows them. A general-purpose clipper has no role or work-type structure to make optional, so it cannot make this commitment.

## Users

**Primary:** The in-flow practitioner — a Holacracy practitioner who has just sensed something mid-task and is hiring GlassFrog Clipper to get it into GlassFrog and return to what they were doing without losing their concentration. How many roles they fill matters less than what the interruption costs them.

## Boundaries

- **No AI in the capture path — first iteration.** Guessed role or work-type attribution stays out until the human path is proven. Revisitable in a later iteration.
- **GlassFrog is the only target.** Filing into OrgOps or any second system is deferred; it is an architecture question to settle in an ADR before it changes this document.
- **Capture into GlassFrog, don't replace it.** No grooming, browsing, or meeting-processing UI in the extension. "Later" happens in GlassFrog.

_Resist a change when:_ it puts a decision between sensing and filing, or moves the product from capturing *into* GlassFrog toward replacing or generalizing *beyond* it.

## Key metrics

Thresholds are judged over a rolling 30 days with at least 20 captures, except
triage, which is judged over a rolling 90 days. Where a threshold applies to
clipped items, the whole unprocessed queue is reported alongside it, so a small
clipped sample stays readable.

- **Time-to-capture (p50/p95)** — seconds from invoking the extension to a filed item; extension telemetry. **Threshold: p95 ≤ 2s on the keystroke path.** The popup path is recorded but not thresholded — human deliberation dominates it, so it is not a measure of flow.
- **Capture abandonment rate** — share of invocations started but cancelled or dropped before filing; extension telemetry. **Threshold: ≤ 30% on the popup path, and ≤ 1% capture failure on the keystroke path** — a keystroke that does not file is a defect, not a preference.
- **Structure-at-capture rate** — share of items filed with role and/or work-type set at capture rather than deferred; extension telemetry. **Threshold: ≥ 25%.** This is the falsification test for Positioning: below it, the optional path is not reachable enough and "never discard" is aspirational.
- **Triage survival rate** — share of clipped items processed in a tactical or governance meeting rather than deleted; GlassFrog API. Retained only as a tripwire for outright deletion. On its own it reports near-perfect health on a stalled backlog, because rotting and surviving look identical to it, so it is never read alone. Its companions:
  - **Age of unprocessed clipped items (p90), on two clocks** — since capture, and since last touch. **Threshold: p90 since capture ≤ 90 days, and no clipped item unprocessed past 180 days.** Capture-age is the health signal; touch-age separates "stuck in triage" from "never looked at". An item can be reworked repeatedly and still never resolve, which is precisely the state survival cannot see.
  - **Inflow versus outflow per period** — clipped items filed against clipped items processed, reported as **two counts, never only as a ratio**. The capture path exists to raise inflow; without this, a queue that grows without being worked reads as healthier over time, not worse. The two terms are kept separate because a ratio cannot support the reading rule below: rising inflow and falling outflow move it identically.

_Reading a capture-age breach._ A breach of the p90-since-capture threshold does
not say **which** of two things happened — the capture path is over-producing (a
product problem, remedied in the extension) or the consuming cadence has lapsed
(a practice problem, which no extension change fixes). These have opposite
remedies, and acting on the wrong one is worse than not acting. Read the
inflow/outflow pair before acting, in this order:

1. **First, ask whether the breaching items predate the capture path.** If the
   items driving p90 past the threshold were captured before the extension was
   in use, the breach is the inherited backlog surfacing, and neither reading
   applies. Work the tail down; the breach is not evidence about either cause.
   Against the 2026-08-31 baseline this is the expected case for the first
   several breaches, not an edge case.
2. **Otherwise compare the trailing 90 days against the preceding 90.** A term
   has *moved* when it differs from the prior period by 30% or more; below that
   it is steady.

| inflow | outflow | reading | remedy |
|---|---|---|---|
| moved up | steady | **over-production** | The extension made filing cheap and the queue outran the rhythm consuming it. Act in the product — or accept that a fast clipper implies a triage rhythm to match, and change the rhythm deliberately rather than by default. |
| steady | moved down | **lapsed cadence** | Tactical and governance meetings were skipped. Act in the practice; no extension change reaches this. |
| any other combination | | **read as lapsed cadence** | Both terms moved, or neither did. Act on the cadence first. |

The default in the third row is deliberate and is not a coin flip. The practice
remedy is cheap and reversible where an extension change is neither; the
observed queue already carries an unprocessed tension recording exactly the
lapsed-cadence condition; and a cadence that cannot consume its current inflow
will not consume a reduced one either, so acting there first is informative even
when over-production is also present. If cadence is restored and the breach
persists, the reading falls through to over-production with the cadence
explanation eliminated rather than assumed.

A breach always routes somewhere. There is no branch of this rule that ends in
re-deciding from scratch.

_Observed baseline, 2026-08-31 — 15 unprocessed tensions across the Anchor Circle
tree, two of them clipped that day. Since capture: median 38 days, p90 662, max
671; 5 of the 15 past a year. Since last touch: median 31 days, p90 38, max 38 —
nothing is stale on that clock, because an inbox-processing pass on 2026-07-31
touched every aged item without resolving any. The two clocks disagreeing by an
order of magnitude is why both are named, and the 90-day threshold is set against
the capture clock knowingly above what today's queue would pass._

## Tracks

### Capture surface

The zero-friction path itself — keystroke invocation, page and selection context, and the progressive-disclosure UI that reveals role and work-type without demanding them. Browser-first; a mobile share-sheet companion is on-strategy but sequenced later.

_Why it serves the approach:_ this track is the "never block" half of the policy made concrete.

### Role & identity resolution

Authentication to GlassFrog, the practitioner's live role set, and proposing the sensing role and circle at the moment of capture.

_Why it serves the approach:_ makes the optional structure cheap enough that people actually use it, which is the "never discard" half.

### Round-trip & triage

Getting captured items to where the practice already lives — the deferred-classification queue and its hand-off into GlassFrog.

_Why it serves the approach:_ makes "classify later" a real promise rather than a backlog dump, without becoming a second GlassFrog client.

### Distribution & trust

Install path, browser-permission posture, and eventual open-sourcing to the GlassFrog community.

_Why it serves the approach:_ capture that nobody grants browser access to captures nothing; trust is the adoption gate.
