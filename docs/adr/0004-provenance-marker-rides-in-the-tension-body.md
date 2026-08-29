# 4. Provenance marker rides in the tension body

Date: 2026-08-28

## Status

Accepted

Revises the field choice in KTD5 of
[the capture-path plan](../plans/2026-08-28-1123-feat-zero-decision-capture-path-plan.md).
Builds on [3. GlassFrog v5 has no role-less write path](0003-glassfrog-v5-has-no-role-less-write-path.md).

## Context

R11 requires a filed item to carry a marker identifying it as created by the
extension, sufficient to distinguish it from items created directly in
GlassFrog. Triage survival — one of STRATEGY.md's four metrics — is uncomputable
without it.

KTD5 placed that marker, with the page title, in the tension's `label`, keeping
it in a different field from the evidence so that truncating a long selection
could never silently destroy it. The generated OpenAPI types support this:
`TensionInput` lists `label` alongside `body`.

Verification against the live v5 API contradicted that. Two findings, both
invisible to the test suite because the capture path is exercised through a
narrow port against a fake client:

1. **`POST /roles/{id}/tensions` rejects `label`.** A tension is created without
   it and the label set afterwards via `PATCH`. Confirmed empirically: create
   returned `"label": null`, and a follow-up `PATCH` set it successfully.
2. **`label` caps at 200 characters.** Composition truncated the title to R7's
   4,000-character evidence limit and emitted roughly 4,020.

Either alone breaks R11 in production. Together they mean every tension capture
would have failed outright, or landed with no marker at all — while every filed
item looked perfectly normal in GlassFrog.

## Decision

The provenance marker leads the tension `body`. No `label` is sent on create.

A headline limit of 200 characters is applied uniformly, including to an
action's or project's `description`, so no field can become a wall of text.

We deliberately do **not** create the tension and then `PATCH` the label, even
though that would preserve KTD5's field split literally.

## Consequences

KTD5's substance is preserved and only its field choice changes. The marker
leads its field and is never truncated, which is the property the decision was
written to guarantee: nothing the practitioner captured can displace it.

One write per capture is retained. This is the reason for rejecting
create-then-`PATCH`: KTD7's at-most-once turns on there being exactly one write,
and a second call adds a failure point between the POST and the marker landing.
A capture whose marker vanished because the service worker died mid-`PATCH` is
precisely the silent R11 failure this is meant to prevent — and GlassFrog v5 has
no idempotency key with which to recover.

The cost is that `label` stays empty on clipped tensions. Observation of the
existing queue suggests this is cheap: no tension currently in the practitioner's
unprocessed queue uses `label` at all, so the marker in `body` remains highly
distinctive.

If GlassFrog later accepts `label` on create, this can be revisited without
migrating existing items — the marker's position in `body` is stable, and
matching on it does not depend on which field it occupies.
