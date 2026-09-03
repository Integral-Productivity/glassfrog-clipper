---
title: A task group cannot bound a continuation parked on a callback — race the resume, not the task
date: 2026-09-02
category: best-practices
module: share-extension-loading
problem_type: design_pattern
component: service_layer
severity: high
applies_when:
  - An async wrapper suspends on a platform completion handler that another process is responsible for invoking
  - A timeout is wanted around work whose completion is not under this process's control
  - withCheckedContinuation is used and two paths could each resume it
  - Reaching for withTaskGroup or withThrowingTaskGroup to impose a deadline on a child task
  - Swift 6 strict concurrency rejects sending a callback's payload across an isolation boundary
symptoms:
  - The share sheet sits on its spinner indefinitely and the only exit is dismissing the extension at the OS level
  - A cancelled task does not finish, because cancellation is cooperative and the task is parked on a callback
  - withTaskGroup returns only after every child returns, so the group hangs exactly where the continuation does
  - A checked continuation traps the process on a second resume when a deadline and a completion handler both fire
  - A load that failed and a load that carried nothing are indistinguishable, so the degradation is invisible
root_cause: concurrency
resolution_type: code_fix
related_components: [testing_framework]
tags:
  - swift-concurrency
  - structured-concurrency
  - withcheckedcontinuation
  - task-cancellation
  - nsitemprovider
  - share-extension
  - deadline
  - swift-6
---

# A task group cannot bound a continuation parked on a callback — race the resume, not the task

## Context

`SharedItem.load(_:as:decode:deadline:)` reads one share-sheet attachment and gives up on it if it takes too long (`apple/GlassFrogClipperCore/Sources/GlassFrogClipperCore/SharedItem.swift:131-156`). The work it is bounding is not its own. `NSItemProvider.loadItem(forTypeIdentifier:options:)` invokes a completion handler that the *source app* registered, so whether that handler ever calls back is somebody else's decision:

> `loadItem`'s completion handler is invoked by whatever load handler the *source app* registered, so a buggy or hostile one can simply never call back. Without a deadline the share sheet sits on its spinner for as long as the practitioner is willing to look at it.
> — `SharedItem.swift:86-89`

That is the failure #96 was filed to fix, and it is not hypothetical in the way most timeout code is. The practitioner is standing in another app with a modal sheet over it. There is no cancel button of ours to press; dismissing the sheet at the OS level is the only exit.

The obvious Swift shape for "do this, but give up after N seconds" is a task group: add the work as one child, add `Task.sleep` as another, take whichever finishes first, cancel the rest. Structured concurrency is the idiom, and every part of it reads correctly. It does not work here, and the way it fails is worse than a wrong answer — it produces exactly the hang it was added to prevent.

The file already says so, in two sentences:

> A task group cannot bound this. `withTaskGroup` waits for every child before it returns, and cancelling a task parked on a callback that never arrives does not make it finish — so the group would hang exactly where the continuation does.
> — `SharedItem.swift:118-121`

**What that comment states, this document measures.** Issue #119 records this as settled, without qualification: "It does not work, and the reason generalises past Swift." Reconstructing the original session shows the mechanism was reasoned out correctly and up front, and that an implementation was written and rejected — but no recorded run of the task-group version hanging. The directly observed hang in that session belonged to a `DispatchSemaphore` probe, which is a different failure with a different cause. So the original session got the reasoning right without the measurement. Below is the measurement.

### The A/B experiment

A single binary, two arms, same fake provider, same 200 ms deadline. The provider is a copy of the one the test suite uses, body-identical to it — an `NSItemProvider` whose registered load handler deliberately never calls its completion (`apple/GlassFrogClipperCore/Tests/GlassFrogClipperCoreTests/ShareSheetSurfaceTests.swift:82-89`). Arm one races it inside `withTaskGroup`; arm two races it with the lock-guarded one-shot claim the shipped code uses. `main` blocks on a semaphore capped at 10 s, so a hang reports itself rather than wedging the run.

Apple Swift 6.3.3 (swiftlang-6.3.3.1.3), macOS 27.0 build 26A5416b, arm64.

```
$ probe taskgroup
1) started, mode=taskgroup
2) withTaskGroup racing the load against Task.sleep, deadline 200ms
   task group: first child returned; calling cancelAll()
   task group: cancelAll() returned; now leaving the group scope
4) main released (10s cap)

$ probe resumeonce
1) started, mode=resumeonce
2) ResumeOnce racing the resume, deadline 200ms
   RETURNED nil
3) done
4) main released (10s cap)
```

The task-group arm never prints `RETURNED` and never prints `3) done`. It is released only by the 10 s cap in `main`.

The finding is sharper than "the task group hangs", and the sharpening is the useful part:

| Step | Task group | ResumeOnce |
|---|---|---|
| Deadline child finishes at 200 ms | yes | yes (the `Task.sleep` throws on cancel) |
| First result available to the caller | yes, at 200 ms | yes, at 200 ms |
| `cancelAll()` returns promptly | **yes** | n/a |
| Cancellation unparks the stalled child | **no** | n/a — nothing is parked to unpark |
| Scope exit returns | **never** | returns immediately |

`cancelAll()` is not where it hangs. `cancelAll()` returns, and the probe prints a line proving it. The hang is at the *implicit await on scope exit*: `withTaskGroup` does not return until every child has finished, and the child parked inside `loadItem`'s completion handler never finishes. Swift's cancellation is cooperative — cancelling a task sets a flag that the task must reach a cancellation point to observe. A task suspended inside a C-style callback has no such point. Nobody reads the flag.

## Guidance

**When you need a deadline on work whose completion you do not control, bound the observation rather than the work.** You cannot make a foreign callback finish. You can decide to stop listening to it.

Concretely, in this file: the deadline races the *resume of the continuation*, not the load.

```swift
let once = ResumeOnce()
return await withCheckedContinuation { continuation in
    let deadline = Task {
        try? await Task.sleep(for: deadline)
        if once.claim() { continuation.resume(returning: .failed) }
    }

    provider.loadItem(forTypeIdentifier: identifier, options: nil) { value, error in
        deadline.cancel()
        guard once.claim() else { return }
        …
    }
}
```
— `SharedItem.swift:137-155`

Whichever of the two arrives first resumes the caller. The loser is dropped. The stalled `loadItem` handler is still out there, still parked, and that is fine — nothing awaits it, so nothing is held by it.

### Why the deadline task *can* be cancelled and the load cannot

This is the crux, and it turns on one word meaning two different things.

`deadline.cancel()` in the completion handler works. `Task.sleep(for:)` is a cancellation point: it throws `CancellationError` when its task is cancelled, which is why the call is written `try? await Task.sleep(...)` and why the `if once.claim()` line below it is never reached on the fast path. The task ends.

`loadItem`'s completion handler is not a cancellation point and cannot be made into one. It is a callback owned by another process's registered handler, reached through a `CheckedContinuation`. Cancelling the Swift task that happens to be suspended on that continuation changes a flag on the task; it does not reach into `NSItemProvider`, does not abort the IPC, and does not resume the continuation. The task stays suspended.

So "cancel" succeeds in one situation and is a no-op in the other, with identical syntax at both call sites. The task group's guarantee — *no child outlives the scope* — is what converts that no-op into a hang. The guarantee is the hazard. In a shape that gives up structure, the parked task is a leak; in a task group it is a deadlock, and a deadlock is worse.

### The double-resume trap makes the race fatal, not merely wasteful

`CheckedContinuation` **traps the process** on a second resume. Not a warning, not a returned error — the app is gone. So a race between a deadline and a callback is only safe if exactly one side can win, and "the deadline already fired, so the callback surely won't" is not a guarantee; it is the interleaving you did not test.

`ResumeOnce` makes the claim atomic:

```swift
private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if claimed { return false }
        claimed = true
        return true
    }
}
```
— `SharedItem.swift:162-173`

`deadline.cancel()` is an optimisation, not the correctness mechanism. Correctness is the lock. The cancel merely stops a doomed task from sleeping out its remaining time.

### Swift 6 strict concurrency is what shaped the rest of the design

`loadItem` hands back `Any?`. `Any?` is not `Sendable`. Resuming the continuation with the raw value sends task-isolated state across an isolation boundary, and Swift 6 rejects it outright — so the decode happens *inside* the completion handler and what crosses the boundary is a `Loaded`, which is `Sendable` (`SharedItem.swift:97-116`, `:153`).

The reason this constraint only appeared now is worth recording, because it is a general trap. The file previously lived in the Xcode targets, which build at `SWIFT_VERSION = 5.0`; moving it into the `GlassFrogClipperCore` package — `// swift-tools-version: 6.0`, `apple/GlassFrogClipperCore/Package.swift:1` — turned strict concurrency checking on for the first time. The header note records it (`SharedItem.swift:25-27`). The code did not become less correct by moving; the checking became honest. A defect that is invisible under one language mode and fatal under another is a defect the whole time.

That split is still open, and it bounds what this fix protects. `SWIFT_VERSION = 5.0` is set on every target in `apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj`, so Swift added outside `GlassFrogClipperCore` gets Swift 5 semantics and the same defect class can re-enter with nothing failing. The fix landed in the package; the hole did not close. Tracked as **#161**.

### Three outcomes, not two

```swift
enum Loaded: Equatable, Sendable {
    case value(String)   // …decoded to something this capture can use
    case empty           // …readable, and carried nothing usable
    case failed          // …errored, or did not answer inside `loadDeadline`
}                        // (+ a `var value: String?` accessor, elided)
```
— `SharedItem.swift:97-109`

`empty` and `failed` both yield no value, and collapsing them is tempting for exactly that reason. It is also what made the old discarded-error path impossible to reason about: "the source app said no" and "there was nothing there" arrived at the reader as the same silence, so the only available design was to swallow both. Once they are distinct events, degrading a `failed` attachment to no value becomes a decision someone made rather than a gap — which is what the comment at `:126-130` records, and what the timeout branch needs in order to be a legible outcome rather than an anomaly.

### The deadline is injectable, which is the only reason any of this is tested

`deadline: Duration = loadDeadline` (`SharedItem.swift:135`) defaults to ten seconds in production (`:90`) and is overridden per call in the tests. A 50 ms deadline is why "an attachment that never answers gives up instead of hanging" returns in well under a second instead of ten (`ShareSheetSurfaceTests.swift:369-381`). Had the deadline been a constant read from inside the function, the behaviour would be untestable in practice and therefore untested — the timeout path is the one nobody exercises by hand.

Three tests sit under one heading at `ShareSheetSurfaceTests.swift:366`. Two of them pin this behaviour; the third is mis-named, which is worth knowing before trusting the coverage:

- `aSilentAttachmentIsBounded` (`:371`) — the silent provider yields `.failed` at a 50 ms deadline.
- `failureIsNotAbsence` (`:385`) — `failingProvider()` (`:91-97`) yields `.failed`, malformed bytes yield `.empty`, a good link yields `.value`. All three distinctions asserted in one place.
- `aStalledAttachmentStillFilesTheRest` (`:419`) — **does not do what its name says, and is the reason to check citations by reading them.** Its only attachment is `textProvider` (`:42-44`), which answers immediately; `silentProvider()` has exactly one call site in the file and it is `:373`, above. What the test pins is that a share with no URL attachment still files its title and selection — worth asserting, but `load` is never called for the URL slot, so the deadline path is untouched. It would pass unchanged with the deadline machinery deleted. Its own comment makes the same claim its name does, so the error is in the test, not in the reading of it. Filed as **#167**.

`swift test` from `apple/GlassFrogClipperCore/` on the current tree: **52 tests in 10 suites, all passing**, in under a tenth of a second. What a green run there proves is bounded, and the bound is stated deliberately in the file header (`ShareSheetSurfaceTests.swift:8-22`), in `docs/adr/0011-behaviour-is-specified-at-the-domain-with-a-thin-platform-surface-layer.md`, and in `CONCEPTS.md`'s `Surface layer` entry: these are `NSItemProvider`s this project constructs, so a green run shows the extension's *encoded assumptions* about the platform still hold in the code. It cannot show that capture works on a device. For the timeout specifically that boundary is narrower than usual in a useful way — `silentProvider()` fakes a stalled source app, but the parking, the cooperative-cancellation semantics, and the continuation are all real platform machinery, which is what the probe above measures directly.

### A blocking primitive is worse, not better

The reflex when structured concurrency will not bound something is to drop to a blocking primitive — wait on a `DispatchSemaphore` with a timeout. Attributed to the original session's probe rather than to the measurement above: this deadlocks. `loadItem` needs its runloop to make progress, and a thread blocked in `semaphore.wait()` has taken that thread. The waiter is waiting for work that cannot run because the waiter is waiting. It is the same class of mistake as the task group — holding something hostage to a completion you do not control — with the added property that it takes a thread down with it.

## Why This Matters

The task group's failure mode is the dangerous kind: it is not wrong, it is *the thing it was added to prevent*. A deadline that hangs is worse than no deadline, because it looks handled. The code reads as bounded, the reviewer sees a `Task.sleep` and a `cancelAll()` and moves on, and the practitioner still gets a share sheet stuck on a spinner with no exit but killing it at the OS level. That is the exact user-visible symptom #96 was filed for, delivered by the fix.

It is also close to unfalsifiable by ordinary testing. The bad shape passes any test written against a provider that answers, which is every provider anyone constructs by reflex. It fails only against a provider that never answers — which the suite now has, and which existed because someone thought to ask what a hostile source app could do. The gap between "this compiles, reads well, and passes" and "this hangs" is one fixture.

And the mistake is attractive rather than careless. `withTaskGroup` is the idiomatic Swift answer to racing two pieces of work; reaching for it is what good practice looks like. The guarantee that makes it good — no child outlives the scope, no orphan tasks, no leaks — is precisely the guarantee that hangs you when one child cannot be made to finish. Guarantees are constraints. A guarantee you cannot satisfy is a deadlock, and structured concurrency has no way to tell you at compile time which of your children are foreign.

The generalisation is what earns this its keep. This is not an `NSItemProvider` fact. It is the shape of every boundary where your deadline is enforced on your side and the work is done on someone else's: a callback API wrapped in a promise, a native handle waited on from a managed runtime, a `fetch` racing an `AbortController` the server never honours, any `Promise.race` where the losing promise keeps a socket or a subscription alive. In every one of them the same substitution applies — stop trying to stop the work; stop waiting for it instead.

## When to Apply

Reach for the race-the-resume shape when **all** of these hold:

- The work is completed by a callback registered by code you do not own — another process, another vendor's SDK, a C API, a platform framework whose handler comes from a source app.
- There is no cancellation channel that the callback's owner honours. A cancellation *token* they ignore is the same as none.
- A caller is suspended waiting for the result, and something user-visible is blocked while it waits.

Signals that a structured wrapper is about to fail you:

- **You are about to wrap a completion handler in a continuation and then bound it.** The continuation is the boundary. Any structure you put outside it inherits the callback's liveness, not your deadline's.
- **The word "cancel" appears at two call sites with different meanings.** One is a cancellation point that throws; the other sets a flag nobody reads. They look identical. Check each one individually: *what code observes this cancellation, and does it exist?*
- **You cannot name the cancellation point.** If you cannot point at the specific `await` that will throw, cancellation does nothing.
- **A structured-concurrency guarantee is doing load-bearing work in your design.** "The group won't return until children finish" is a feature right up to the moment one child cannot finish.
- **You are reaching for a blocking primitive because the async one won't bound it.** That is the same problem one layer down, plus a thread.

And when you do build the race:

- **Guard the resume with an atomic one-shot claim.** `CheckedContinuation` traps on double resume; a comment reasoning that both sides cannot fire is not a guard. A lock is.
- **Make the deadline injectable.** A hardcoded ten seconds is an untested branch, and the timeout branch is the one nobody exercises by hand.
- **Distinguish "failed" from "empty".** Merging them is what makes the degraded path unreasonable about later.
- **Write the fixture that never answers.** It is six lines (`ShareSheetSurfaceTests.swift:82-89`) and it is the only test that can distinguish the working shape from the hanging one.

Do not apply this where the work *is* yours and cancellable. Structured concurrency is correct for cooperating tasks, and a task group racing two `async` functions you wrote is the right tool. The distinction is ownership of the completion, not the shape of the API.

## Related

- [Fit a test fixture to the platform's behaviour, not to the fake that stands in for it](test-fixture-fitted-to-fake-not-platform-behaviour.md) — same file, same pull requests, different subject: a fixture that failed to constrain which decoder read the page address. Its measurement table of what each `NSItemProvider` construction actually vends is the reference for that platform shape; it is not repeated here.
- `docs/adr/0011-behaviour-is-specified-at-the-domain-with-a-thin-platform-surface-layer.md` and `CONCEPTS.md`'s `Surface layer` entry — what a green `swift test` in the surface layer does and does not prove, and why the boundary note is restated in each file rather than referenced.
- `SharedItem.swift:111-130` — the doc comment on `load`, which states the task-group point in three sentences. This document is not a replacement for it. What it adds is the measurement behind the claim, the precision that `cancelAll()` returns promptly and the hang is at scope exit, the generalisation past this one call site, and the record of what else was tried and rejected — a `DispatchSemaphore` that deadlocks for a related but distinct reason. A reader of the comment learns not to use a task group here; a reader of this document knows why, at every boundary of this shape.
- **#161** — the open half of the Swift 6 story above: everything outside `GlassFrogClipperCore` still builds at `SWIFT_VERSION = 5.0`, so the defect class this work fixed can re-enter unchecked.
- **#133** — the `Swift core` job that runs these tests is still not a required check on `main` (`gh api …/rules/branches/main` returns exactly one context, `verify`), so a red Swift run cannot block a merge. `SharedItem.swift:19-23` says so in its own header. #98 covered the narrower case of the surface layer being *deleted* and was closed by #152, which put a guard inside `verify` rather than adding a required check — so the deletion is now caught and the suite *failing* still is not. Everything this document describes is pinned by tests that report but do not gate.
- Issues and pull requests: #119 (this document), #96 (the deadline, closed by this work), #97, #100 (where it landed), #99, #85.
