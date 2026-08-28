---
name: GlassFrog Clipper
last_updated: 2026-08-28
---

# GlassFrog Clipper Strategy

## Purpose

Holacracy practitioners sense tensions while deep in other work — reading, browsing, mid-task — but filing one means leaving that work for GlassFrog. The thought doesn't survive the switch: by the time GlassFrog is open, the tension has gone flat, or gone entirely.

## Positioning

Capture never blocks on a decision, and never discards one already made — a single keystroke files the item with zero required input, while role and work-type are always offered and always kept when the practitioner already knows them. A general-purpose clipper has no role or work-type structure to make optional, so it cannot make this commitment.

## Users

**Primary:** The in-flow practitioner — a Holacracy practitioner who has just sensed something mid-task and is hiring GlassFrog Clipper to get it into GlassFrog and return to what they were doing without losing their concentration. How many roles they fill matters less than what the interruption costs them.

## Boundaries

- **No AI in the capture path — first iteration.** Guessed role or work-type attribution stays out until the human path is proven. Revisitable in a later iteration.
- **GlassFrog is the only target.** Filing into OrgOps or any second system is deferred; it is an architecture question to settle in an ADR before it changes this document.
- **Capture into GlassFrog, don't replace it.** No grooming, browsing, or meeting-processing UI in the extension. "Later" happens in GlassFrog.

_Resist a change when:_ it puts a decision between sensing and filing, or moves the product from capturing *into* GlassFrog toward replacing or generalizing *beyond* it.

## Key metrics

- **Time-to-capture (p50/p95)** — seconds from invoking the extension to a filed item; extension telemetry.
- **Capture abandonment rate** — share of invocations started but cancelled or dropped before filing; extension telemetry.
- **Structure-at-capture rate** — share of items filed with role and/or work-type set at capture rather than deferred; extension telemetry.
- **Triage survival rate** — share of clipped items processed in a tactical or governance meeting rather than deleted or left to rot; GlassFrog API.

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
