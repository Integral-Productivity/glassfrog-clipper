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
//  Reachable is not the same as enforced, and the difference is worth knowing:
//  the `Swift core` job that runs these tests is path-filtered and is not a
//  required check (`verify` is the only one), so it reports on a pull request
//  that touches `apple/` but cannot block a merge. Treat a red run here as a
//  stop signal by convention, not by mechanism.
//
//  Moving the file here also put it under the package's Swift 6
//  strict-concurrency checking, which the Xcode targets do not apply — they
//  build at SWIFT_VERSION 5.0. `load` carries what that turned up.
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
    public static func pageContext(from items: [NSExtensionItem]) async -> PageContext? {
        var url: String?
        var selection: String?
        // The item's own title is what a source app puts in `attributedTitle` —
        // typically the page title. Preferred over a URL-derived guess.
        var title: String?

        for item in items {
            if title == nil, let attributed = item.attributedTitle?.string, !attributed.isEmpty {
                title = attributed
            }
            if title == nil, let contentText = item.attributedContentText?.string, !contentText.isEmpty {
                title = contentText
            }

            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    url = await load(provider, as: UTType.url.identifier, decode: url(from:))
                }
                if selection == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    selection = await load(provider, as: UTType.plainText.identifier, decode: text(from:))
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

    /// Loads one attachment and decodes it in the same breath.
    ///
    /// Decoding happens *inside* the completion handler because `loadItem` hands
    /// back `Any?`, which is not `Sendable`: resuming the continuation with the
    /// raw value sends task-isolated state across an isolation boundary, and
    /// Swift 6 rejects it outright. What crosses is a `String?`.
    private static func load(
        _ provider: NSItemProvider,
        as identifier: String,
        decode: @escaping @Sendable (Any?) -> String?
    ) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: identifier, options: nil) { value, _ in
                continuation.resume(returning: decode(value))
            }
        }
    }

    /// The page address, out of whatever shape the attachment arrived in.
    ///
    /// What `loadItem` hands back is not implied by the type identifier asked
    /// for. Measured on macOS 26: every way of registering a `public.url`
    /// representation — `NSItemProvider(item:typeIdentifier:)`, `(object:)` and
    /// `(contentsOf:)` alike — serialises, and the value arrives as `Data`. The
    /// object-only reader this replaced therefore dropped the address from
    /// every one of them, which is the exact loss this file exists to prevent.
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
