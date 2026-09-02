import Foundation
import Testing
import UniformTypeIdentifiers

@testable import GlassFrogClipperCore

// The Safari/share-sheet surface layer.
//
// WHAT THIS PROVES, PRECISELY: that the assumptions this extension encodes
// about the share sheet's contract still hold in the code. It runs offline
// under `swift test` against `NSItemProvider`s this file constructs, so it
// cannot observe how any real source app fills a share, and must never be read
// as evidence that capture works on a device. `SafariWebExtensionHandler`
// exists because Safari implements no `chrome.notifications` and hands the
// extension a `chrome.storage.local` the app cannot read — platform facts
// nothing here could have discovered.
//
// What catches a real device is a signed build, by hand; apple/README.md says
// what still needs one. What this file catches is those encoded assumptions
// drifting silently — a refactor that stops at the first attachment yielding
// something reads perfectly well and loses the URL on every share from Mail.
//
// This is the Safari half of docs/adr/0011's surface layer. It is Swift rather
// than a `features/surface/safari.feature`, and 0011's Consequences records
// why: everything the share sheet does that a step could state against
// `submit()` is already in the domain layer, and what is left is one pure
// function.
//
// The Chrome half is features/surface/chrome.feature, whose boundary note this
// one restates rather than references — a reader arrives at one or the other
// and must not have to find the pair to learn what a green run is worth.

/// Reading a capture out of whatever the share sheet handed over.
struct ShareSheetSurfaceTests {

    // MARK: Fixtures

    private static func urlProvider(_ string: String) -> NSItemProvider {
        NSItemProvider(item: NSURL(string: string)!, typeIdentifier: UTType.url.identifier)
    }

    private static func textProvider(_ string: String) -> NSItemProvider {
        NSItemProvider(item: NSString(string: string), typeIdentifier: UTType.plainText.identifier)
    }

    /// A `public.url` attachment whose payload is not an address.
    ///
    /// The shape that makes the URL slot's decoder identity observable. Every
    /// representation of `public.url` reaches `loadItem` as `Data` — measured:
    /// `NSItemProvider(item:typeIdentifier:)`, `(object:)` and `(contentsOf:)`
    /// all serialise — so `url(from:)` and `text(from:)` read an ordinary link
    /// identically, and swapping one for the other at the call site is
    /// invisible. What separates them is the scheme check, which only bites
    /// when the bytes are not an address.
    private static func malformedUrlProvider(_ text: String) -> NSItemProvider {
        NSItemProvider(item: NSString(string: text), typeIdentifier: UTType.url.identifier)
    }

    /// One share, shaped the way a source app hands it over.
    private static func item(
        title: String? = nil,
        contentText: String? = nil,
        attachments: [NSItemProvider] = []
    ) -> NSExtensionItem {
        let item = NSExtensionItem()
        if let title { item.attributedTitle = NSAttributedString(string: title) }
        if let contentText { item.attributedContentText = NSAttributedString(string: contentText) }
        item.attachments = attachments
        return item
    }

    // MARK: The shape an attachment arrives in

    // The share sheet's least obvious contract, and the one most likely to be
    // got wrong: `loadItem` returns whatever class the *source app* registered,
    // not a class implied by the type identifier asked for. Apple's own
    // convenience initialisers vend `Data` for `public.url`, so a reader that
    // handles only the object case loses the address from every source that
    // serialises — silently, and on exactly the shares worth keeping.
    @Test("a page address is read whichever representation the source app registered")
    func urlIsReadFromEveryShape() {
        let expected = "https://example.test/page"

        #expect(SharedItem.url(from: URL(string: expected)) == expected)
        #expect(SharedItem.url(from: NSURL(string: expected)) == expected)
        #expect(SharedItem.url(from: expected) == expected)
        #expect(SharedItem.url(from: Data(expected.utf8)) == expected)
    }

    @Test("selected text is read whichever representation the source app registered")
    func textIsReadFromEveryShape() {
        let expected = "circle leads may not hold the role they assign"

        #expect(SharedItem.text(from: expected) == expected)
        #expect(SharedItem.text(from: NSString(string: expected)) == expected)
        #expect(SharedItem.text(from: Data(expected.utf8)) == expected)
    }

    // A capture whose evidence is a row of replacement characters is worse in
    // triage than one with no selection at all: it survives, and has to be read
    // before it can be discarded.
    @Test("bytes that are not text decode to nothing rather than to mojibake")
    func undecodableBytesYieldNothing() {
        let notUTF8 = Data([0xFF, 0xFE, 0xFD])

        #expect(SharedItem.text(from: notUTF8) == nil)
        #expect(SharedItem.url(from: notUTF8) == nil)
        #expect(SharedItem.text(from: nil) == nil)
        #expect(SharedItem.url(from: NSObject()) == nil)
    }

    // MARK: Scenarios

    @Test("a share from Safari files the page it was on")
    func safariShareCarriesUrlAndTitle() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(
                title: "Governance meeting notes",
                attachments: [Self.urlProvider("https://example.test/notes")]
            )
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.url == "https://example.test/notes")
        #expect(page.title == "Governance meeting notes")
        #expect(page.selection == nil)
    }

    // The scenario `pageContext(from:)`'s own doc comment exists for. Mail
    // attaches a URL *and* the selected text to the same item; stopping at the
    // first attachment that yields something throws away half of what the
    // practitioner meant to capture, and does it silently.
    @Test("a share carrying both a link and a selection keeps both")
    func everyAttachmentIsRead() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(
                title: "Policy draft",
                attachments: [
                    Self.urlProvider("https://example.test/policy"),
                    Self.textProvider("circle leads may not hold the role they assign"),
                ]
            )
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.url == "https://example.test/policy")
        #expect(page.selection == "circle leads may not hold the role they assign")
    }

    // Attachment order is not the source app's promise to keep, so the read
    // must not depend on it.
    @Test("both survive whichever order the source app attached them in")
    func attachmentOrderDoesNotMatter() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(attachments: [
                Self.textProvider("the selection"),
                Self.urlProvider("https://example.test/policy"),
            ])
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.url == "https://example.test/policy")
        #expect(page.selection == "the selection")
    }

    // STRATEGY.md's position is that filing with no evidence beats losing the
    // thought, and ADR 0003 agrees — every body field is optional. A share from
    // Notes carries no URL at all, and that is an ordinary capture rather than
    // a degraded one.
    @Test("a share carrying only text is still a capture")
    func textOnlyShareStillCaptures() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(attachments: [Self.textProvider("Weekly review keeps slipping")])
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.selection == "Weekly review keeps slipping")
        #expect(page.url.isEmpty)
    }

    // Filing the URL twice makes the item harder to read in triage, for nothing.
    @Test("text that merely repeats the link is not a selection")
    func echoedUrlIsNotASelection() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(attachments: [
                Self.urlProvider("https://example.test/policy"),
                Self.textProvider("https://example.test/policy"),
            ])
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.url == "https://example.test/policy")
        #expect(page.selection == nil)
    }

    // An item with no evidence is worse than none: it survives into triage and
    // has to be read before it can be discarded. `ShareCaptureModel` turns this
    // nil into the `nothingToCapture` phase rather than filing an empty tension.
    @Test("a share carrying nothing yields no capture at all")
    func emptyShareYieldsNothing() async {
        #expect(await SharedItem.pageContext(from: []) == nil)
        #expect(await SharedItem.pageContext(from: [Self.item()]) == nil)
    }

    // The source app's own title beats anything derived from the URL, because
    // it is what the practitioner was looking at when they shared.
    @Test("the source app's title is preferred, then its content text, then the link")
    func titleFallsBackInOrder() async {
        let link = Self.urlProvider("https://example.test/page")

        guard let both = await SharedItem.pageContext(from: [
            Self.item(title: "The title", contentText: "The content text", attachments: [link])
        ]) else {
            Issue.record("expected a capture"); return
        }
        #expect(both.title == "The title")

        guard let contentOnly = await SharedItem.pageContext(from: [
            Self.item(contentText: "The content text", attachments: [link])
        ]) else {
            Issue.record("expected a capture"); return
        }
        #expect(contentOnly.title == "The content text")

        guard let neither = await SharedItem.pageContext(from: [
            Self.item(attachments: [link])
        ]) else {
            Issue.record("expected a capture"); return
        }
        #expect(neither.title == "https://example.test/page")
    }

    // The surface must not become a way around a guarantee the domain makes.
    // `CaptureFiler.pageContext` is where bounding lives and CoreTests proves it
    // there; what this pins is that the share path still goes through it.
    @Test("an enormous shared selection is bounded before it becomes a capture")
    func shareIsBoundedLikeAnyOtherCapture() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(attachments: [
                Self.urlProvider("https://example.test/page"),
                Self.textProvider(String(repeating: "s", count: 100_000)),
            ])
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.selection?.unicodeScalars.count == Compose.evidenceFieldLimit)
    }

    // The URL slot is decoded as an address, not as arbitrary text. `url` is
    // the field GlassFrog renders a project as linked from, so a source app
    // that registers something else under `public.url` must not have it land
    // there. A share is still filed on whatever else arrived.
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

    // The share sheet hands over an array, and a multi-select share fills it.
    // Reading only the first item loses whichever half arrived second.
    @Test("a share split across several items is read as one capture")
    func fieldsCombineAcrossExtensionItems() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(title: "Policy draft"),
            Self.item(attachments: [Self.urlProvider("https://example.test/policy")]),
            Self.item(attachments: [Self.textProvider("the selection")]),
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.title == "Policy draft")
        #expect(page.url == "https://example.test/policy")
        #expect(page.selection == "the selection")
    }

    // The first item to supply a field wins, so a later item cannot quietly
    // replace what the practitioner was actually looking at.
    @Test("the first item to carry a field is the one that is kept")
    func earlierItemsWin() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(title: "The page they shared", attachments: [Self.urlProvider("https://example.test/first")]),
            Self.item(title: "A later item", attachments: [Self.urlProvider("https://example.test/second")]),
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.title == "The page they shared")
        #expect(page.url == "https://example.test/first")
    }

    // The guard has three ways to pass, and every other scenario satisfies it
    // with a URL. A share from an app that sends only a title is a capture too.
    @Test("a share carrying only a title is still a capture")
    func titleOnlyShareStillCaptures() async {
        guard let page = await SharedItem.pageContext(from: [
            Self.item(title: "Untitled Note")
        ]) else {
            Issue.record("expected a capture"); return
        }

        #expect(page.title == "Untitled Note")
        #expect(page.url.isEmpty)
        #expect(page.selection == nil)
    }

    // `url` is the field GlassFrog renders a project as linked from, so the
    // widened decode must not let arbitrary bytes reach it. The object-only
    // reader enforced this implicitly by casting.
    @Test("bytes that are not an address are not accepted as one")
    func nonAddressBytesAreNotAnAddress() async {
        #expect(SharedItem.url(from: "not an address") == nil)
        #expect(SharedItem.url(from: Data("not an address".utf8)) == nil)
        #expect(SharedItem.url(from: "/relative/path") == nil)

        // Still read, because they are addresses.
        #expect(SharedItem.url(from: "https://example.test/page") == "https://example.test/page")
        #expect(SharedItem.url(from: Data("https://example.test/page".utf8)) == "https://example.test/page")
    }
}
