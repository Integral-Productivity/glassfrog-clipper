# Only the URL userinfo is stripped from a capture

Date: 2026-09-04

## Status

Accepted, and retroactive: this records a decision made while fixing
[#8](../../issues/8) on 2026-09-02 and implemented then. It is written down now
because until today the reasoning lived only in a code comment, a paragraph of
[PRIVACY.md](../../PRIVACY.md), and an amendment note on R7 in a plan file —
three places, none of which is where someone asks *why*.

Constrains R7. Guarded by
[ADR 0010](0010-four-architectural-characteristics-get-fitness-functions.md)'s
`capture-credential-strip` check ([#137](../../issues/137)).
Resolves [#138](../../issues/138).

## Context

A captured URL can carry a secret in three places: the `userinfo` component
(`https://user:token@host/path`), the query string, and the fragment. All three
reach GlassFrog verbatim unless something removes them, and what reaches
GlassFrog is visible to whoever the practitioner's organisation settings make it
visible to.

The obvious response — strip anything that looks like a secret — collides with
what this project is. [STRATEGY.md](../../STRATEGY.md)'s **resist test** says to
resist a change when it puts a decision between sensing and filing. A capture
path that must classify each query parameter has put a decision there, and it is
a decision made by a heuristic rather than by the practitioner.

The cost of getting it wrong is asymmetric and quiet. A parameter wrongly judged
secret is deleted from the evidence the practitioner clipped the page *for*, and
nothing announces it: the item files, looks normal, and is missing the part that
mattered. A parameter wrongly judged safe is carried — which is the status quo,
and which PRIVACY.md can describe honestly.

## Decision

**The URL `userinfo` component is stripped. Every other URL-borne secret is
carried as-is.**

The asymmetry is the whole point, and it is not a judgement about which secrets
matter more:

- **`userinfo` is *definitionally* a credential.** RFC 3986 gives it exactly one
  meaning, so removing it costs no decision at all — there is nothing to
  classify, and no case where the practitioner wanted it kept. It stays on the
  right side of the resist test because it is not a heuristic.
- **A query parameter is not.** `?token=` may be a session token or a search for
  the word "token". Deciding needs a guess, the guess sits between sensing and
  filing, and a wrong one destroys evidence silently.

**The strip recurses into nested schemes** — `view-source:`, `blob:` and
`filesystem:` — which parse with an empty `username` and `password` while still
carrying the credential in their path text. Recursion rather than a lexical
`//…@` match: a pattern loose enough to catch those also matches a query string
like `?next=//user:pass@host`, and rewriting *that* would destroy evidence in a
URL that never held a credential.

**It is implemented twice on purpose.** `stripUrlCredentials` exists in
`src/compose.ts` and again as `Compose.stripUrlCredentials` in the Swift core,
because the two capture surfaces do not share a capture path —
`SharedItem.pageContext(from:)` builds its own `PageContext` rather than going
through `pageContextFromTab`. The duplication is the price of that split, and it
is deliberate rather than drift.

## The guarantee is held by a check, not by convention

This is the part worth stating precisely, because the first version of R7 got it
wrong in exactly this way. The strip originally landed in `src/compose.ts` only;
every share from an iOS or macOS app filed the credential, and `swift test`
stayed green. A reviewer caught it. Nothing in the repository would have.

So as of #137 the invariant is mechanical: `fitness/checks/capture-credential-strip.ts`
fails when any producer of a `PageContext`, in either language, does not route
its `url` through the strip. It runs in `Software Fitness / Self-compliance`,
which `main` requires.

**One asymmetry remains, and this ADR does not paper over it.** TypeScript
strips *again at egress*, in `fileCapture` (`src/capture.ts:125`), so a capture
held in the pending slot by an older build cannot file a credential. Swift has
no equivalent: `CaptureFiler.file(_:)` goes straight from `Compose.compose` to
the client. That is not a live defect — both Swift producers strip at
construction, and the check now enforces it — but the second layer exists on one
surface only. Tracked as [#217](../../issues/217).

## Options considered

**A. Strip userinfo only.** Adopted.

**B. Strip userinfo, plus query parameters matching a secret-shaped list**
(`token`, `key`, `session`, `sig`, …). Rejected: it is precisely the heuristic
the resist test forbids, and the list is unmaintainable — every service names
its parameters differently, so the list is always both too broad and too narrow.

**C. Strip the whole query string.** Rejected as destroying most of what makes a
captured URL useful. A URL without its query is frequently not the page.

**D. Strip nothing, and document it.** Rejected. `userinfo` needs no judgement
to remove, so carrying it buys none of the honesty the other options trade for
and costs the practitioner a credential.

## Consequences

**A token in a query string or fragment reaches GlassFrog.** PRIVACY.md says so
in the practitioner's own words rather than leaving it to be inferred, and now
links here for the reasoning. This is the consequence the project accepts, and
it is accepted because the alternative is a capture path that silently edits
evidence.

The duplication between TypeScript and Swift is permanent while the two surfaces
have separate capture paths. It is guarded rather than trusted, which is the
only version of that arrangement that survives a refactor.

`test/fixtures/compose-cases.json` cannot see `stripUrlCredentials` — the parity
fixture drives `compose()`, not the strip — so TS and Swift can still drift on
this specific function without the fixture noticing. That is
[#139](../../issues/139), and it is a real gap in the parity story rather than a
theoretical one.
