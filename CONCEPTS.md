# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Relationships

A capture is made by one of the two capture paths, is filed against a capture role, and carries a provenance marker. Before configuration exists it waits as a pending capture; while a write is outstanding it is guarded by an in-flight marker. Both of those are states a capture passes through, not separate things.

## Capture

### Capture

What the practitioner sensed, packaged for filing: the page they were on, optionally some selected text, an optional note, an optional work type, and an optional role.

The optionality is the product, not laxity. A capture with neither work type nor role set is valid and must still file — that is what lets the quick capture path ask for nothing. Anything that makes a field mandatory has changed the product, not the schema.

### Work type

Which of the three shapes GlassFrog can receive a capture becomes: a tension, an action, or a project.

The set is closed on purpose. GlassFrog is a Holacracy system and these are the shapes it has; inventing a fourth would make the extension a general note tool rather than a Holacracy one.

### Provenance marker

A fixed string every filed item carries so items created by this extension can be told apart from items created by hand in GlassFrog.

GlassFrog offers no field for this — tags cannot be set at create — so the marker is text, and it leads its field rather than trailing it, because truncating a long capture must never be able to remove it. The exact string is a contract: changing it orphans every item filed before the change.

## Capture paths

### Quick capture

The path that files the current page with no prompt and no decisions — a keystroke in, a filed item out.

### Structured capture

The path that surfaces the same capture with role, work type, and note editable before it files.

*Avoid: popup path.* The distinction that matters is what the practitioner is asked for, not which surface renders it.

The share sheet is therefore structured capture too, not a third path — it asks for exactly these three. Deciding that was the substance of #85; see `docs/adr/0011`.

## Capture lifecycle

### Pending capture

A capture held because the extension was not configured when it was made, waiting for configuration to be saved so it can file.

*Avoid: held capture.*

At most one is ever held. A later capture replaces it and the replacement is shown to the practitioner rather than swapped in silently, because believing two things were captured and finding one is worse than being told. It expires rather than waiting forever, which is what keeps it from becoming the backlog this product deliberately does not have.

### In-flight marker

A record written before a write goes out and cleared once it lands, so a capture whose result was never observed can be recognized later.

A marker found at startup means the write may or may not have succeeded. It is surfaced for the practitioner to resolve and never re-sent automatically — GlassFrog has no idempotency key, so an automatic retry can silently duplicate.

## Specification

### Domain layer

The statement of what a capture does, written in this glossary's vocabulary and naming no platform.

A scenario belongs here when it can be stated without the platform handing you a page. That test is mechanical rather than a matter of taste, and it is the whole reason a second platform costs nothing to specify: the domain layer is not restated per platform. A domain scenario that starts needing a browser is a signal — either the behaviour is genuinely platform-shaped and is in the wrong place, or the capture path has grown a platform dependency it should not have.

### Surface layer

The statement of behaviour that one platform's contract genuinely shapes — what this extension assumes when it asks that platform for the page it is looking at.

What it proves is narrower than a green run suggests, and the gap is the point. It runs offline against a fake this project wrote, so it can only show that the extension's *encoded assumptions* about the platform still hold in the code. It cannot observe the platform, and must never be read as evidence that capture works on a device; that is established by hand. What it does catch is those assumptions drifting silently, which is a failure no reader would spot and no unit test would fail on.

Each platform's surface layer is written wherever it can be executed against that platform's own code, so the notation differs between them. That is a consequence of the split, not a second decision.

## Configuration and failure

### Capture role

The role every capture is filed against unless the practitioner names a different one.

Every GlassFrog write is scoped to a role, so there is no such thing as filing without one. Attribution is therefore systematically wrong for any quick capture the practitioner does not correct — accepted deliberately, because it is wrong in a constant, knowable way that triage fixes, rather than the invisible drift a most-recently-used role would produce.

### Unusable role

A failure meaning the configured capture role cannot be written to at all, as distinct from a failure that might succeed on a retry.

The distinction is the whole point of classifying failures: it decides whether the practitioner should wait or go reconfigure. Retrying an unusable role never succeeds.

## Flagged ambiguities

- "held capture" and "pending capture" were both used for the capture waiting on configuration — settled on *pending capture*.
- "popup path" and "structured capture" were both used for the path with editable fields — settled on *structured capture*, since the point is what is asked for, not what renders it.
