//
//  SharedItem.swift
//  GlassFrogClipperCore
//
//  Reading a capture out of whatever the share sheet handed over.
//
//  Kept apart from the view controller because it is the one part of the Share
//  Extension that is pure, and the part most likely to be wrong: what arrives
//  differs by source app. Safari sends a URL and a title; Notes sends plain
//  text; Mail may send both plus an attributed-string selection. A capture that
//  loses the URL because it came from an app that also sent text is the failure
//  this exists to prevent.
//
//  It lives in the core package rather than in `Shared (Share)/` so that
//  `swift test` can reach it at all. See docs/adr/0011 and
//  ShareSheetSurfaceTests.swift, which states this behaviour and carries the
//  boundary note about what a green run there does and does not prove.
//
//  Reachable is not the same as enforced, and the line falls in an exact place
//  (#98). Presence and wiring ARE mechanism: `test/surface-layer.test.ts` runs
//  inside the required `verify` check and fails if this specification is
//  deleted or gutted, if it is dropped from the SwiftPM test target, or if
//  nothing under `.github/workflows/` still runs `swift test`. Passing is
//  still convention: the `Swift core` job is path-filtered and is not required
//  (`verify` is the only one, ADR 0012), so a red run here reports on a pull
//  request touching `apple/` and cannot block a merge. #133 owns that half.
//
//  Moving the file here also put it under the package's Swift 6
//  strict-concurrency checking, which the Xcode targets do not apply — they
//  build at SWIFT_VERSION 5.0. `load` carries what that turned up, and
//  `pageContext` carries a second finding from the same source: moving
//  `ShareCaptureModel` in after it (#94) made the isolation of the share's own
//  items checkable for the first time.
//

import Foundation
import UniformTypeIdentifiers

public enum SharedItem {

    /// Reads every attachment and assembles one page context.
    ///
    /// Deliberately reads *all* attachments rather than stopping at the first
    /// that yields something. Share sheets routinely attach a URL and a text
    /// selection to the same item, and taking whichever arrives first throws
    /// away half of what the practitioner meant to capture.
    ///
    /// `@MainActor` because the share's items are the main actor's. They arrive
    /// from `extensionContext.inputItems` on the main thread and are held there
    /// for the sheet's lifetime by `ShareCaptureView`, so reading them off it
    /// is a send the compiler rejects — which is how this was found, when
    /// `ShareCaptureModel` moved into this package and its `@MainActor load`
    /// started handing `items` to a nonisolated reader. Annotating rather than
    /// suppressing, because the isolation claim is true: nothing else reads an
    /// `NSItemProvider` here, and the awaits below suspend rather than block.
    @MainActor
    public static func pageContext(from items: [NSExtensionItem]) async -> PageContext? {
        var url: String?
        var selection: String?
        // The item's own title is what a source app puts in `attributedTitle` —
        // typically the page title. Preferred over a URL-derived guess.
        var title: String?

        for item in items {
            // Trimmed before it is accepted, because the guard below treats a
            // title as reason enough to file. A whitespace-only title would
            // otherwise satisfy it and produce an item whose body is the
            // provenance marker and nothing else — the outcome
            // `nothingToCapture` exists to prevent. Everything else on this
            // path already trims: `CaptureFiler.pageContext` treats a blank
            // selection as absent, and `Configuration` treats a blank key as
            // missing rather than letting it reach an opaque 401.
            if title == nil { title = trimmed(item.attributedTitle?.string) }
            if title == nil { title = trimmed(item.attributedContentText?.string) }

            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    url = await load(provider, as: UTType.url.identifier, decode: url(from:)).value
                }
                if selection == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    selection = await load(provider, as: UTType.plainText.identifier, decode: text(from:)).value
                }
            }
        }

        // A share carrying only text is still a capture. STRATEGY.md's position
        // is that filing with no evidence beats losing the thought, and the API
        // agrees — every body field is optional (ADR 0003).
        guard url != nil || selection != nil || title != nil else { return nil }

        return CaptureFiler.pageContext(
            url: url ?? "",
            title: title ?? url ?? "",
            // Text that merely repeats the URL is not a selection, and filing it
            // twice makes the item harder to read in triage for no gain.
            selection: selection == url ? nil : selection
        )
    }

    /// How long one attachment may take before the capture gives up on it.
    ///
    /// `loadItem`'s completion handler is invoked by whatever load handler the
    /// *source app* registered, so a buggy or hostile one can simply never call
    /// back. Without a deadline the share sheet sits on its spinner for as long
    /// as the practitioner is willing to look at it.
    static let loadDeadline: Duration = .seconds(10)

    /// What one attachment yielded.
    ///
    /// Three outcomes, not two. `empty` and `failed` both produce no value, but
    /// they are not the same event, and collapsing them is what made the old
    /// discarded-error path impossible to reason about.
    enum Loaded: Equatable, Sendable {
        /// The attachment decoded to something this capture can use.
        case value(String)
        /// The attachment was readable and carried nothing usable.
        case empty
        /// The load reported an error, or did not answer inside `loadDeadline`.
        case failed

        var value: String? {
            if case let .value(decoded) = self { return decoded }
            return nil
        }
    }

    /// Loads one attachment, decodes it, and bounds how long that may take.
    ///
    /// Decoding happens *inside* the completion handler because `loadItem` hands
    /// back `Any?`, which is not `Sendable`: resuming the continuation with the
    /// raw value sends task-isolated state across an isolation boundary, and
    /// Swift 6 rejects it outright. What crosses is a `Loaded`.
    ///
    /// A task group cannot bound this. `withTaskGroup` waits for every child
    /// before it returns, and cancelling a task parked on a callback that never
    /// arrives does not make it finish — so the group would hang exactly where
    /// the continuation does. The deadline therefore races the *resume* itself:
    /// whichever of the two arrives first wins, and `ResumeOnce` guarantees the
    /// loser is dropped rather than tripping the checked continuation's
    /// double-resume trap.
    ///
    /// A `failed` outcome degrades this attachment to no value rather than
    /// failing the capture. That is deliberate: the practitioner is standing in
    /// another app with a modal sheet open, and filing what did arrive beats
    /// refusing the capture over one attachment. It is recorded here because
    /// silent degradation should be a decision someone made, not a gap.
    @MainActor
    static func load(
        _ provider: NSItemProvider,
        as identifier: String,
        decode: @escaping @Sendable (Any?) -> String?,
        deadline: Duration = loadDeadline
    ) async -> Loaded {
        let once = ResumeOnce()
        return await withCheckedContinuation { continuation in
            let deadline = Task {
                try? await Task.sleep(for: deadline)
                if once.claim() { continuation.resume(returning: .failed) }
            }

            provider.loadItem(forTypeIdentifier: identifier, options: nil) { value, error in
                deadline.cancel()
                guard once.claim() else { return }
                // The error is read rather than discarded. It changes no field
                // today — a failed load and an unusable one both yield no value
                // — but it is the difference between "the source app said no"
                // and "there was nothing there", and only one of those is worth
                // a practitioner's attention later.
                if error != nil { continuation.resume(returning: .failed); return }
                continuation.resume(returning: decode(value).map(Loaded.value) ?? .empty)
            }
        }
    }

    /// Lets exactly one of two racing paths resume a continuation.
    ///
    /// `CheckedContinuation` traps on a second resume, so the deadline and the
    /// completion handler must not both fire. Whichever claims first wins.
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

    /// A string with no content of its own is absent, not empty.
    static func trimmed(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    /// The page address, out of whatever shape the attachment arrived in.
    ///
    /// What `loadItem` hands back is not implied by the type identifier asked
    /// for; it follows from what the source app registered. Measured on macOS
    /// 27.0 (build 26A5416b): a URL *object* registered under `public.url`
    /// arrives as `Data` whichever initialiser registered it
    /// (`NSItemProvider(item:typeIdentifier:)`, `(object:)` and `(contentsOf:)`
    /// all serialise), while a `String` registered under the same identifier
    /// arrives as a `String`. The object-only reader this replaced handled
    /// neither, and so dropped the address from both, which is the exact loss
    /// this file exists to prevent.
    ///
    /// The `URL` branch is kept even though nothing observed here reaches it:
    /// the shape is Apple's to change, and one measurement on one OS is not a
    /// contract. An `NSURL` needs no branch of its own — `as? URL` bridges it.
    ///
    /// The text shapes must still parse as an address with a scheme. The
    /// object-only reader enforced that implicitly by casting, and widening the
    /// decode must not quietly drop the check: `url` is the field GlassFrog
    /// renders a project as linked from, so arbitrary bytes must not reach it.
    static func url(from value: Any?) -> String? {
        if let url = value as? URL { return url.absoluteString }
        guard let decoded = text(from: value),
              let parsed = URL(string: decoded),
              parsed.scheme != nil else { return nil }
        return parsed.absoluteString
    }

    /// The text, out of whatever shape the attachment arrived in.
    ///
    /// Same reasoning as `url(from:)`. Bytes that are not valid UTF-8 decode
    /// to nothing rather than to a string of replacement characters: a capture
    /// whose evidence is mojibake is worse in triage than one with no selection.
    static func text(from value: Any?) -> String? {
        if let string = value as? String { return string }
        if let data = value as? Data { return String(data: data, encoding: .utf8) }
        return nil
    }
}
