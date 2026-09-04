# Behaviour is specified at the domain, with a thin platform surface layer

Date: 2026-09-01

## Status

Accepted. Amended 2026-09-02 to resolve the Safari deferral it created (#85) —
see the first entry under Consequences. Amended again 2026-09-02 (#94) to say
where presentation state goes, which neither layer covers.

Paired with [Four architectural characteristics get fitness functions](0010-four-architectural-characteristics-get-fitness-functions.md),
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

**Safari's surface layer is Swift, not a second `.feature`** *(amended
2026-09-02, resolving #85; this paragraph previously read "Safari gets a slot,
not a driver" and deferred the question)*.

Applying this ADR's own mechanical test to the share sheet answered most of it.
Every share-sheet behaviour a step could write against `submit()` — a decided
work type honoured, a named role used as given, the note leading the evidence —
is already stated in the domain layer.

The share sheet is also not a third capture path, which was the open question in
#85. `CONCEPTS.md` already settles what separates the two: *what the
practitioner is asked for, not which surface renders it*. `ShareCaptureModel`
offers role, work type and note before filing, so the share sheet is **structured
capture on a different surface**. No new vocabulary, and no domain restatement.

What is left is genuinely platform-shaped and genuinely one function:
`SharedItem.pageContext(from:)`, assembling one `PageContext` out of whatever
`NSExtensionItem`s a source app handed over. It is the share sheet's analogue of
`quickCapture()` — the thing that reads the page.

A `.feature` file for one function would cost a Gherkin runner on the Swift side
(Cucumberish is the only one, and it is unmaintained) or a Node driver shelling
into Swift, plus a second required check — to produce a green light this ADR
already says cannot prove Safari works. It would also mean a second fake of the
same platform, which `features/support/world.ts` warns against by name. So the
surface layer is stated where it can actually be executed:
`ShareSheetSurfaceTests.swift` in the core package, in the same register as
`chrome.feature`, carrying its own copy of the boundary note rather than a
reference to it. `features/surface/` stays Chrome-only.

**The two-layer split is unchanged; only the notation varies by platform.** The
rule generalises: a platform's surface layer goes wherever its behaviour can be
executed against that platform's own code. Gherkin is how the Node surface is
written, not a requirement the split imposes.

**Specifying it required moving `SharedItem.swift` into `GlassFrogClipperCore`,
and the move paid for itself.** The Xcode targets carry no
`packageProductDependencies` — they compile the core's sources directly, by
path — so the move is a path change with no import churn, and `swift test` gains
the file. It also put the file under the package's Swift 6 strict concurrency,
which the Xcode targets were not applying. That surfaced two defects live since
#66: a data race resuming a continuation with the non-`Sendable` `Any?` that
`loadItem` returns, and a reader that decoded only the *object* representation of
an attachment — so any source app serialising its `public.url` representation had
its address dropped, which is the precise loss that file exists to prevent. Both
are fixed here, and the second is now specified.

Mutation-tested like the two original layers. Eight mutations each turn the
suite red: stopping at the first attachment that yields something, letting a
later item overwrite an earlier title or address, filing an echoed address as a
selection, reading only the object representation, dropping the scheme check,
filing a share that carried nothing, and decoding the address slot as ordinary
text. A deliberate no-op edit was run alongside them and correctly stayed green,
so the suite is not simply red to everything.

**The last of those eight is the one worth recording, because the obvious fix
for it does not work.** `loadItem(forTypeIdentifier: "public.url")` never hands
back a URL object: measured on macOS 27.0 (build 26A5416b),
`NSItemProvider(item:typeIdentifier:)`, `(object:)` and `(contentsOf:)` all
serialise it to `Data`. So a fixture built to vend an object — the natural way
to tell the two decoders apart — vends `Data` and passes whichever decoder is
wired up.

The container is a red herring either way. A `String` registered under
`public.url` *does* arrive as a `String`, and `url(from:)` and `text(from:)`
both read both shapes — so no container tells them apart on a well-formed link.
What separates them is the scheme check, and it only bites when the bytes are
not an address. The scenario that pins the address slot is therefore one whose
`public.url` attachment carries bytes that are *not* an address. That scenario
kills the mutation, and it states the real consequence: `url` is the field
GlassFrog renders a project as linked from, so arbitrary bytes must not reach it.

**Presentation state is a third thing, and it is specified beside the surface
layer rather than given a layer of its own** *(added 2026-09-02, #94)*.

The two layers say what gets filed and how a share is read. Neither says what
the practitioner is *told*. `ShareCaptureModel`'s seven phases decide that, and
five of its transitions are decided nowhere else: `notConfigured` is checked
before the share is read, a share that carries nothing is refused rather than
filed empty, a configuration lost while the sheet is open routes to the
reconfigure surface rather than to a generic failure, R18's `reconfigure` flag
reaches the button that offers a retry, and the configured role seeds a picker
it must never overwrite.

Applying this ADR's mechanical test to those returns neither answer. A step
cannot state them against `submit()` — they are not about what is filed — and
they are not shaped by the platform's contract either; a share sheet hands over
`NSExtensionItem`s, not phases. So the test is extended rather than stretched:
**behaviour that is neither filed nor read from the platform is stated where it
can be executed against the code that decides it.** For the share sheet that is
`ShareCapturePhaseTests.swift`, next to the surface layer and carrying its own
copy of the boundary note.

The rest of the phase machine is deliberately *not* restated there, because it
is already covered. `Compose` treats an absent work type and `.tension`
identically and trims a note itself, so the model's `nil` conversions produce
no observable difference — pinning them again would test the same decision in
two places and make one of them the wrong one to change.

Mutation-tested like the layers above. Seven mutations each turn the suite red:
swapping the two guards in `load`, filing an empty share as ready, replacing a
picked role with the configured one, dropping a chosen work type, never
entering the in-flight phase, dropping R18's `reconfigure` flag, and turning a
lost configuration into a generic failure. A deliberate no-op edit was run
alongside them and correctly stayed green.

**Moving the model paid for itself the same way `SharedItem` did.** Under the
package's Swift 6 strict concurrency — which the Xcode targets do not apply —
`load(items:)` was handing the main-actor-isolated `[NSExtensionItem]` to a
nonisolated `SharedItem.pageContext`, while `ShareCaptureView` still held the
same objects on the main actor. `pageContext` and `SharedItem.load` are
`@MainActor` now. That is one more defect live since #66 that only the move
could see, and it is the second time this has happened, which is the argument
for moving the next one too.

**Both surface layers are gated by mechanism up to a line, and by convention
past it** *(amended 2026-09-02, resolving #98; this paragraph previously read
"what the Swift half is gated by is convention, not mechanism", and framed the
gap as Safari-only)*.

The framing it replaces was wrong in a way worth recording, because it is the
kind of wrong that survives review. It said the Chrome half was enforced and the
Swift half was not. Measured on 2026-09-02: `npm run bdd` runs in
`bdd-and-fitness.yml` as `BDD / Scenarios`, which is unfiltered and therefore
*requirable*, but was not then among what `main` required — `verify` was the
only one (ADR 0012). Deleting
`features/surface/chrome.feature` and running the required suite passed, 354 of
354. The gap was symmetric; Safari was simply the half that got looked at.
*(Superseded 2026-09-03, resolving #91: `main` now requires `BDD / Scenarios`
and `Software Fitness / Self-compliance` alongside `verify`. The 2026-09-02
measurement stands as what was true that day; the divergence it describes is
closed.)*

`test/surface-layer.test.ts` closes the presence half of it for both, inside
`verify`, on every pull request. It fails if either specification is deleted or
gutted below a floor, if `ShareSheetSurfaceTests.swift` is dropped from the
SwiftPM test target that compiles it, or if nothing under `.github/workflows/`
or `scripts/` still invokes `swift test` against the package or `npm run bdd`.
That last one was in neither half's account of itself: delete `apple.yml` today
and the Swift suite stops running entirely, with nothing to notice.

Read the line precisely, because `SharedItem.swift`'s header once overclaimed in
exactly this direction. **Presence and wiring are mechanism. Passing is
convention for Safari, and mechanism for Chrome** *(amended 2026-09-03,
resolving #91; this paragraph previously said neither half's red suite could
block a merge)*. A red `Swift core` reports on a pull request touching `apple/`
and cannot block a merge; closing that needs a check `main` actually requires —
an aggregator, since ADR 0012 explains that requiring the path-filtered
`Swift core` would pin every non-Apple pull request at "waiting for status to be
reported" — which is [#133](../../issues/133). The Chrome half is closed:
`BDD / Scenarios` became a required context on `main` under #194, so a red
Chrome run now blocks the merge.

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
