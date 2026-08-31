//
//  SharedItem.swift
//  Shared (Share)
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
                    url = (await load(provider, as: UTType.url.identifier) as? URL)?.absoluteString
                }
                if selection == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    selection = await load(provider, as: UTType.plainText.identifier) as? String
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

    private static func load(_ provider: NSItemProvider, as identifier: String) async -> Any? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: identifier, options: nil) { value, _ in
                continuation.resume(returning: value)
            }
        }
    }
}
