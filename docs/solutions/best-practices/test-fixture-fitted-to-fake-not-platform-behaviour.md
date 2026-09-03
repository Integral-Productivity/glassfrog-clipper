---
title: Fit a test fixture to the platform's behaviour, not to the fake that stands in for it
date: 2026-09-02
category: best-practices
module: share-extension-tests
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - A fixture is built in-process against a platform API whose real inputs arrive from another process
  - Two collaborators (decoders, parsers, formatters) read from the same wire shape
  - Production code was widened after probing the fake that the tests also use
  - Several independent review agents agree about a platform's runtime behaviour
tags: [mutation-testing, test-fixtures, nsitemprovider, share-extension, swift, agent-convergence, surface-layer]
---

# Fit a test fixture to the platform's behaviour, not to the fake that stands in for it

## Context

PR #99 added the Safari surface layer, `ShareSheetSurfaceTests.swift`. Its fixtures are `NSItemProvider`s the test file builds in-process; nothing in `swift test` reaches a real source app.

`SharedItem.pageContext(from:)` reads two slots out of one share: a `public.url` attachment through `url(from:)`, and a `public.plain-text` attachment through `text(from:)`.

The suite was green. It did not constrain which decoder read the page address. Swapping `decode: url(from:)` for `decode: text(from:)` at the address call site left every scenario passing. Mutation testing found it; reading the tests did not. ADR 0011's amended Consequences records it.

The failure mode is general. A fixture built in-process against a platform API is built against your *beliefs* about that API. When those beliefs are wrong, the fixture is fitted to the fake's own artifact, and the assertion it carries is satisfied by anything.

## Guidance

**Probe the platform before you shape production code around it, and probe it again before you trust the fixture.**

The order that produced this hole was: probe the fake, widen the production decoder to match what the probe returned, write scenarios against the same fake. Every step agreed with every other step, because every step consulted the same source. Nothing in that loop touches the platform.

Two things break the loop.

### 1. Mutate the call site, not just the branch

Coverage says the line ran. It does not say the line's identity is pinned. Swap the collaborator at each call site and re-run.

```swift
// The mutation. It stayed green across the whole suite.
url = await load(provider, as: UTType.url.identifier, decode: text(from:)).value
//                                                    ^^^^^^^^^^^^^^^^^^ was url(from:)
```

It survived because **both decoders read both shapes an attachment can arrive in**. `url(from:)` reads a `URL`, a `String`, or `Data`; `text(from:)` reads a `String` or `Data`. For an ordinary link the two return the same string. Shape never separates them.

### 2. When a mutation survives, do not reach for the structural fixture

The obvious fix is a fixture vending a distinguishable *type* — an `NSURL` object, which only `url(from:)` would read. That fixture does not exist. Every convenience initialiser that registers a URL object under `public.url` serialises it, and the value arrives as `Data`. A test built on it passes whichever decoder is wired up. ADR 0011 records that exactly such a test was written, measured, and rejected rather than shipped green.

What separates the two decoders is not a type. It is a rule:

```swift
static func url(from value: Any?) -> String? {
    if let url = value as? URL { return url.absoluteString }
    guard let decoded = text(from: value),
          let parsed = URL(string: decoded),
          parsed.scheme != nil else { return nil }   // <- the only real difference
    return parsed.absoluteString
}
```

So the fixture that kills the mutation is a `public.url` attachment carrying bytes that are **not** an address.

**Prefer semantic discrimination over structural discrimination.** Ask what the two collaborators genuinely decide *differently*, then build the input that makes that decision visible. A fixture that differs only in the type it carries is testing the fake's serialisation policy, not your code.

**Write the scenario so it states a consequence.** The scenario that pins this slot is not "the URL decoder is called for the URL slot". It is "a link attachment that is not an address does not become one" — because `url` is the field GlassFrog renders a project as linked from. A test that kills a mutation *and* reads as a product commitment survives refactoring. One that only kills the mutation gets deleted as noise.

**Agreement among review agents is not evidence.** During the review that produced this, three independent agents each asserted the scenario tests exercised only the object shape. All three were wrong in the same direction; none had run the code. One runtime probe — six `loadItem` calls, under a minute — settled it. Correlated guessing looks exactly like consensus. When agents agree about a platform's runtime behaviour, run the platform.

## Why This Matters

A green-but-meaningless suite is worse than no suite. No suite is honest about what is unverified; a green one spends the reviewer's attention and returns false assurance, strongest exactly where the fixture is most confidently wrong.

The cost here was specific. Had a later refactor swapped the call sites — the exact drift the surface layer exists to catch — arbitrary bytes from any source app would have reached the field GlassFrog renders a project as linked from, and the whole suite would have stayed green. The surface layer's stated job is catching encoded assumptions about the platform drifting silently. It could not catch a drift in the one line that encodes the assumption.

Coverage percentage cannot detect this. Both decoders were covered, both call sites ran, every assertion passed. Coverage measures whether a line executed; it says nothing about whether any assertion depends on what that line did. Mutation testing measures exactly that.

The economics favour it. Eight mutations against this suite took minutes and found one hole. A no-op edit was run alongside them and correctly stayed green — the control that makes a mutation result mean anything.

## When to Apply

Run mutation testing on any call site where two collaborators have overlapping input domains. Signals that raise the odds:

- **Fixtures are constructed in-process against a platform API whose real inputs come from another process.** `NSItemProvider`, `NSExtensionItem`, clipboard and drag payloads, IPC envelopes, webhook bodies, browser-extension message shapes. You are testing your model of the boundary, and the model is what is under suspicion.
- **Production code was reshaped after probing the fake.** The sharpest signal. When the probe that motivated a widening and the fixture that verifies it are the same construction, the test cannot fail — it is one belief asserted twice.
- **Two decoders, parsers, or formatters read from the same wire shape.** Anything that reads `Data` can be confused with anything else that reads `Data`.
- **A slot's value is chosen by a collaborator passed in at the call site** — a `decode:` argument, a strategy object, a handler map. The slot's identity lives in one token, and nothing type-checks that token against its slot.
- **The platform's return type is not implied by the identifier you asked for.** `loadItem(forTypeIdentifier:)` returns whatever class the source app registered.

Do not skip the exercise because a suite looks thorough. This one has twenty-one scenarios and a boundary note explaining what a green run does and does not prove. It still had the hole.

## Examples

### What each provider construction actually vends

Measured on macOS 27.0 (build 26A5416b) with a `loadItem` probe.

| Construction | Asked for | Class delivered | `as? String`? |
|---|---|---|---|
| `NSItemProvider(item: NSURL, typeIdentifier: "public.url")` | `public.url` | `NSConcreteData` | no |
| `NSItemProvider(object: NSURL)` | `public.url` | `NSConcreteData` | no |
| `NSItemProvider(contentsOf: fileURL)` | `public.url` | `NSConcreteData` | no |
| `NSItemProvider(item: NSString, typeIdentifier: "public.url")` | `public.url` | `__NSCFString` | yes |
| `NSItemProvider(item: NSString, typeIdentifier: "public.plain-text")` | `public.plain-text` | `NSTaggedPointerString` | yes |
| `NSItemProvider(object: NSString)` | `public.utf8-plain-text` | `_NSInlineData` | no |

Two facts fall out, and the second is the one that matters.

First, `loadItem(forTypeIdentifier: "public.url")` never hands back a `URL` or `NSURL` from any of the three convenience initialisers, so the `URL` branch in the decoder is unreachable through the share-sheet path from any `NSItemProvider` this test file can build. It is reachable only by calling the decoder directly with a literal value, which is what the unit-level assertions do.

Second — and this is what the first draft of this reasoning got wrong — **the container is a red herring either way.** What serialises is decided by the *class* handed to the initialiser, not by the type identifier: an `NSURL` serialises, an `NSString` does not. But since both decoders read both `Data` and `String`, no container tells them apart on a well-formed link. Only the scheme check does.

### Before: the fixture that proves nothing

```swift
private static func urlProvider(_ string: String) -> NSItemProvider {
    NSItemProvider(item: NSURL(string: string)!, typeIdentifier: UTType.url.identifier)
}
```

Written to vend a URL object; vends `NSConcreteData`. Every scenario built on it asserts on a page address that either decoder would have produced. The structural fix — `NSItemProvider(object:)` or `(contentsOf:)` — vends `NSConcreteData` too. There is no structural fix.

### After: the fixture that pins the slot

```swift
/// A `public.url` attachment whose payload is not an address.
private static func malformedUrlProvider(_ text: String) -> NSItemProvider {
    NSItemProvider(item: NSString(string: text), typeIdentifier: UTType.url.identifier)
}

@Test("a link attachment that is not an address does not become one")
func urlSlotIsDecodedAsAnAddress() async {
    guard let page = await SharedItem.pageContext(from: [
        Self.item(attachments: [
            Self.malformedUrlProvider("not an address"),
            Self.textProvider("the selection"),
        ])
    ]) else {
        Issue.record("expected a capture"); return
    }

    #expect(page.url.isEmpty)
    #expect(page.selection == "the selection")
}
```

With `url(from:)` wired to the address slot, `"not an address"` fails the scheme check, `url` stays empty, and the capture is still filed on the selection. Swap in `text(from:)` and `"not an address"` lands in `page.url`, so the assertion fails. The mutation is dead.

### The generalised move

1. Pick a call site where a collaborator is passed in.
2. Substitute the other plausible collaborator. Re-run.
3. Green means the suite does not constrain that call site.
4. Ask what the two collaborators genuinely *disagree* about — not what types they accept.
5. Build the fixture from that disagreement, and phrase the assertion as the consequence a practitioner would notice.
6. Run a no-op edit through the same loop as a control. A suite that goes red for everything proves nothing either.
