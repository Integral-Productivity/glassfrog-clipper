# Telemetry is local-only and allowlisted at the write boundary

Date: 2026-08-31

## Status

Accepted

Implements R13 of [the capture-path plan](../plans/2026-08-28-1123-feat-zero-decision-capture-path-plan.md),
which that plan deferred to issue #3. Reads the queue through
[Queue health is measured from capture, not from last touch](0006-queue-health-is-measured-from-capture-not-from-last-touch.md)
and identifies clipped items by
[Provenance marker rides in the tension body](0004-provenance-marker-rides-in-the-tension-body.md).

## Context

STRATEGY.md names four metrics. Three come from extension telemetry, and one of
those three — structure-at-capture — is the stated falsification test for
Positioning. Until now none of them existed anywhere, so the central bet of the
product could not be disproved.

Instrumenting them runs straight into the Distribution & trust track, which says
plainly that trust is the adoption gate: *capture that nobody grants browser
access to captures nothing*. An extension that reads every page the practitioner
visits, holds a GlassFrog API key, and then starts measuring is asking for a
kind of trust it has not earned and does not need. R13 already forbids the URL,
the page title, the selection text, and the key from reaching a telemetry field.
The open question was what enforces it.

"Be careful" does not, and the two defects recorded in
[the verification record](../plans/2026-08-28-capture-path-verification-record.md)
say why: both reached merge-ready state, both were invisible to a green suite,
and both were wrong beliefs rather than careless code. A telemetry leak has the
same shape and is worse, because there is no moment at which it announces
itself. A filed item that lost its marker looks normal in GlassFrog; a
telemetry record carrying a page title looks normal in `chrome.storage.local`
too, and there is nobody to notice.

The second, quieter problem is measurement integrity. The popup pre-fills its
role picker with the configured capture role. Counting "a role is present" as
structure would score every zero-decision capture as structured, drive
structure-at-capture towards 100%, and produce a falsification test that cannot
fail — the metric equivalent of ADR 0006's touch clock.

## Decision

**Telemetry is recorded locally and never leaves the device except by an act the
practitioner performs.** The options page renders the metrics and offers a copy
button that writes the log to their own clipboard. There is no consent flag, no
endpoint, and no code path that can send anything, because nothing in the
extension may be one setting away from egress.

**R13 is enforced at the write boundary rather than at each call site**, in three
layers:

1. `structureOf` is the only function that ever sees a `Capture`, and it returns
   two booleans. Nothing else can pass captured text into a record.
2. `sanitize` copies an allowlist of nine fields and drops everything else,
   checking types as well as names — so a page title smuggled into `durationMs`
   is dropped too.
3. Tests drive real captures whose URL, title, selection, and key are
   distinctive sentinels, then assert none appears in the serialised log. This
   is the same discipline `test/glassfrog-adapter.test.ts` applies to the wire.

**The service worker records every event**, extending KTD1 from writes to
measurement. The popup speaks the protocol declared in `src/messages.ts` and
never imports the recorder, so the constraint is a property of the module graph.

**Popup abandonment is measured by port disconnect.** Chrome destroys a popup on
blur with no event the popup can send, so the popup opens a long-lived port and
the worker learns of the closure from Chrome.

**Structure-at-capture counts only a role that differs from the configured
default**, plus any explicit work type.

**The queue-health report runs in the options page, over the capture role's
parent circle**, and only when the practitioner presses the button.

## Consequences

The metrics exist and can now fail. That is the point: STRATEGY.md's positioning
was unfalsifiable while none of them was measured, and a rate that is only
*measurable* falsifies nothing.

Structure-at-capture will read lower than a naive implementation would report,
and that is intended in the same way ADR 0006's threshold is set above what
today's queue passes. Under-counting is the safe direction for a test whose job
is to disprove. The cost is real: a practitioner who opens the popup, checks the
pre-filled role, and files deliberately is recorded as having deferred. We
accept it, because the alternative error — a metric that always passes — is
undetectable from the number itself.

Held captures sit outside every rate. R9 parking a capture is the guard working,
and its later filing happens on a clock that has nothing to do with flow. This
means the denominators are smaller than the raw invocation count, and the
difference is shown rather than hidden.

Egress being a button means telemetry cannot be collected at a distance, ever,
without a further decision recorded somewhere like this. If a collection
endpoint is later wanted, this ADR is what has to be superseded — which is the
intended friction, not an oversight.

Two of the four metrics remain limited by what GlassFrog can be asked, and
neither limit is fixable here:

- **A hard-deleted tension is invisible.** Survival's "rather than deleted"
  is observable only as `archived`, because a `DELETE`d tension is simply gone.
  Survival therefore cannot see part of its own denominator, which is a further
  reason it is retained only as a tripwire and never read alone.
- **Outflow is keyed on `updated_at`.** v5 records no "processed at", so the
  best available proxy for when an item was worked is when it was last touched
  — the same coarse field ADR 0006 declines to threshold. Inflow, keyed on
  `created_at`, is exact.

The reading rule for a breached age threshold is settled separately in issue
\#38. This decision constrains it in one way: inflow and outflow are reported as
counts, never as a ratio, because a ratio moves identically whether inflow rose
or outflow fell.
