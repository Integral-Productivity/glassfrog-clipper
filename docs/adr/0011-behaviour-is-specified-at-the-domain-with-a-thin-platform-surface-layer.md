# 11. Behaviour is specified at the domain, with a thin platform surface layer

Date: 2026-09-01

## Status

Accepted

Paired with [10. Four architectural characteristics get fitness functions](0010-four-architectural-characteristics-get-fitness-functions.md),
which covers the other half of the tier-1 gate content (#69).

Constrains, but does not decide, how the Apple targets in PR #66 are specified.

## Context

The repo needed a Cucumber suite behind the `BDD / Scenarios` required check.
Between #69 being filed and being worked, the scope changed underneath it: PR #66
brings a Safari extension, a SwiftUI container app, and share-sheet capture into
this same repository. It is a multi-platform extension repo now, not a
Chrome-only one.

That makes the layering question expensive to get wrong. Feature files written in
Chrome's vocabulary — popup, keystroke, service worker — force a second platform
either to restate every scenario in its own words or to go unspecified. Unwinding
that later means rewriting the `.feature` files, which is the direction nobody
does.

The repo's existing structure argues for the domain. `src/compose.ts` is pure.
`CaptureWriter` is a narrow port. `submit()` in `src/background.ts` is the single
entry point where the configured/unconfigured branch lives, and its signature
carries no browser vocabulary at all. The seam a platform-agnostic suite needs
already exists; it was built for testability and turns out to be the same seam.

## Decision

Two layers.

**The domain layer** (`features/*.feature`) states behaviour in the vocabulary of
`CONCEPTS.md` — capture, work type, provenance marker, capture role, pending
capture, in-flight marker. No file names a browser, a popup, a keystroke, or a
share sheet. Its steps drive `submit()`.

**The surface layer** (`features/surface/*.feature`) states behaviour that is
genuinely shaped by one platform's contract. Its steps drive `quickCapture()`,
the function that reads the active tab. Today there is one file, `chrome.feature`.

The split is mechanical rather than a matter of taste: **if a step can be written
against `submit()`, it belongs in the domain layer.** Needing `quickCapture()` —
needing the platform to hand you a page — is what puts it in the surface layer.

## What the surface layer does and does not prove

Recorded here because a green run invites the wrong reading, and the wrong
reading is expensive.

The suite runs offline in Node, against `test/support/chrome.ts` — a fake this
repo wrote. That is the reusable's stated contract ("self-contained, no org or
network access"), not an accident of implementation. So the surface layer
**cannot observe Chrome's actual behaviour** and must never be cited as evidence
that the extension works in a browser.

The worked example is in this repo already. `src/glassfrog.ts` binds `fetch` to
`globalThis` because the SDK calls it with the client as receiver; browsers throw
"Illegal invocation" and Node's undici does not care. It fails **only** in the
one environment the extension actually runs in. Nothing in `chrome.feature` could
have caught it, and nothing in `chrome.feature` ever will.

What the surface layer catches is the extension's own *encoded assumptions about
the platform* drifting. A refactor that starts awaiting the network before
reading the selection reads perfectly well and breaks capture on every
cross-origin navigation, because `activeTab` is revoked. That scenario is in the
layer, and it was verified to go red when the ordering is inverted.

Real Chrome is caught by `docs/verifying-in-chrome.md`, by hand. That division is
the decision, not a gap in it.

## Options considered

**A. Domain layer only.** Cleanest, and truest to BDD's premise that a scenario
states behaviour rather than mechanism. Rejected as under-specifying: the
platform contracts this extension depends on — `activeTab` revocation timing,
injection refusal, an unreadable tab — are behavioural commitments the product
makes, and leaving them only in unit tests puts them where a reader looking for
"what does this guarantee" will not find them.

**B. Chrome-only.** Fastest today. Rejected on the cost of unwinding, which falls
entirely on the platform that arrives second.

**C. Two layers.** Adopted, on the reasoning that platform surfaces change in
weird ways the domain cannot express — with the boundary above written down,
since the reason given for the layer is not quite the protection it provides.

## Consequences

Twenty scenarios: sixteen domain, four surface. Each layer was mutation-tested
before this ADR was written — inverting the provenance marker's position, letting
the configured role override a named one, and moving the selection read after a
network await each turn the suite red.

**Safari gets a slot, not a driver.** `features/surface/` is where
`safari.feature` goes, and the domain layer needs no restatement for it. Writing
that file and its Swift driver belongs to PR #66's session, which owns `apple/`;
this session deliberately did not touch it. Tracked as #85.

**A domain scenario that starts needing a browser is a signal, not a nuisance.**
It means either the behaviour is genuinely platform-shaped and the scenario is in
the wrong file, or `submit()` has grown a platform dependency it should not have.
Both are worth stopping for.

**Step definitions load with no transpiler.** Node strips TypeScript types
natively from 22.18, which `.nvmrc` already pins as the floor for `node --test`
to discover `.ts` files at all. devops-excellence runs cucumber under
`--import tsx` because it predates that; adding `tsx` here would be a second
devDependency doing what the runtime already does, on a repo whose Distribution
track is about being cheap to audit. The cost is that the suite does not run at
all below 22.18 rather than running smaller — which is the failure direction to
prefer, and why the workflow pins the version rather than floating it.
