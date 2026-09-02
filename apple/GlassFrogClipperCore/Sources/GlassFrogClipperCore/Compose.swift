import Foundation

/// Turns a capture into the text fields GlassFrog will store.
///
/// A deliberate, line-for-line port of `src/compose.ts`. It exists twice because
/// the Share Extension never runs the web extension — it is handed a URL by the
/// share sheet and files natively — so the composition has to happen in Swift
/// too.
///
/// Two implementations of one function is a liability, and the reason it is
/// accepted here rather than routed around is that the alternative is worse: the
/// Share Extension would otherwise have to wake the web extension to compose for
/// it, which is a second failure point on the capture path for no gain. The
/// liability is contained by `test/fixtures/compose-cases.json`, a golden file
/// both languages assert against. Neither can drift without a visible diff.
///
/// **If you change anything in this file, regenerate that fixture from the
/// TypeScript side and make both suites pass.** ADR 0004 makes the marker the
/// basis of the triage-survival metric, and an item filed with a marker one
/// character adrift is invisible to that metric while looking perfectly ordinary
/// in GlassFrog.
public enum Compose {

    /// Stable by contract. Changing it orphans every item filed before the
    /// change. Must equal `PROVENANCE_MARKER` in `src/compose.ts`.
    public static let provenanceMarker = "[glassfrog-clipper]"

    /// R7's cap, applied to each page-derived evidence field on its own.
    public static let evidenceFieldLimit = 4000

    /// GlassFrog's own cap on a tension `label`, adopted uniformly so an
    /// action's `description` cannot become a wall of text either.
    public static let headlineLimit = 200

    private static let ellipsis = "…"

    /// Exactly what JavaScript's `String.prototype.trim` removes.
    ///
    /// Not `.whitespacesAndNewlines`, which differs at both ends: it includes
    /// U+0085 (NEL), which JavaScript does not trim, and omits U+FEFF, which
    /// JavaScript does. Either difference produces a body that survives every
    /// ASCII test and diverges from the TypeScript output on real-world text
    /// pasted out of a word processor.
    private static let jsWhitespace: CharacterSet = {
        var set = CharacterSet.whitespaces          // Unicode Zs, plus TAB
        set.formUnion(CharacterSet(charactersIn: "\u{000A}\u{000B}\u{000C}\u{000D}"))
        set.insert(charactersIn: "\u{FEFF}")        // trimmed by JS, not by Foundation
        set.remove(charactersIn: "\u{0085}")        // trimmed by Foundation, not by JS
        return set
    }()

    private static func trimmed(_ text: String) -> String {
        text.trimmingCharacters(in: jsWhitespace)
    }

    /// Truncation counted in Unicode scalars, matching `Array.from(text)`.
    ///
    /// This is the single most likely place for the two implementations to
    /// diverge, and the divergence is silent. Swift's `String` is a collection
    /// of *grapheme clusters*, so the obvious `text.prefix(limit)` counts
    /// user-perceived characters. For the fixture's family-emoji title that is
    /// 47 where JavaScript counts 200 — a wildly different headline, from code
    /// that reads correctly and passes every ASCII case.
    public static func truncate(_ text: String, limit: Int = evidenceFieldLimit) -> String {
        let scalars = Array(text.unicodeScalars)
        guard scalars.count > limit else { return text }
        let kept = scalars.prefix(max(0, limit - 1))
        var view = String.UnicodeScalarView()
        view.append(contentsOf: kept)
        return String(view) + ellipsis
    }

    /// Marker first, then as much of the title as fits inside `headlineLimit`.
    ///
    /// The marker leads and is never truncated, so R11 holds no matter how long
    /// the title is.
    public static func headline(_ page: PageContext) -> String {
        let budget = headlineLimit - provenanceMarker.unicodeScalars.count - 1
        let title = trimmed(truncate(trimmed(page.title), limit: budget))
        return title.isEmpty ? provenanceMarker : "\(provenanceMarker) \(title)"
    }

    /// The practitioner's own words come before the evidence the machine
    /// gathered — whoever reads this in triage is looking for the thought, not
    /// the URL.
    static func detail(_ capture: Capture) -> String {
        var parts: [String] = []

        let note = trimmed(capture.note ?? "")
        if !note.isEmpty { parts.append(note) }

        var evidence: [String] = []
        let url = trimmed(truncate(capture.page.url))
        if !url.isEmpty { evidence.append(url) }

        let selection = trimmed(capture.page.selection ?? "")
        if !selection.isEmpty { evidence.append(truncate(selection)) }

        if !evidence.isEmpty { parts.append(evidence.joined(separator: "\n\n")) }

        return parts.joined(separator: "\n\n")
    }

    /// What GlassFrog is actually sent.
    ///
    /// R4 / KD2: an unset work type is a tension, and no `status` is composed
    /// for one.
    public static func compose(_ capture: Capture) -> Composed {
        let head = headline(capture.page)
        let body = detail(capture)

        switch capture.workType {
        case .action:
            return .action(description: head, note: body)
        case .project:
            // The URL goes to `link` AND stays in the note. The note is the
            // human-readable evidence block and is subject to R7's truncation;
            // `link` is the single canonical field GlassFrog renders the project
            // as linked from, and truncation must never reach it. Both,
            // deliberately.
            //
            // An empty URL is omitted rather than sent blank: `link: ""` would
            // read as a link that exists and is broken.
            let url = capture.page.url.trimmingCharacters(in: jsWhitespace)
            return .project(description: head, note: body, link: url.isEmpty ? nil : capture.page.url)
        case .tension, .none:
            // No `label`. The generated OpenAPI types list it on TensionInput,
            // but the API rejects it on create — see ADR 0004. The marker rides
            // at the head of the body instead, so there is exactly one write per
            // capture and no window in which the marker can go missing.
            return .tension(body: [head, body].filter { !$0.isEmpty }.joined(separator: "\n\n"))
        }
    }
}

/// The composed result, mirroring the `Composed` union in `src/compose.ts`.
public enum Composed: Equatable, Sendable {
    case tension(body: String)
    case action(description: String, note: String)
    /// Only a project carries `link`. `ActionInput` has no such field and
    /// neither does a tension, so there is nothing to invent an equivalent for
    /// on those two paths.
    case project(description: String, note: String, link: String?)

    /// The field the provenance marker leads, whichever shape this is. R11 is
    /// stated over this rather than over each case, so a new case cannot quietly
    /// escape the check.
    public var markedField: String {
        switch self {
        case let .tension(body): return body
        case let .action(description, _): return description
        case let .project(description, _, _): return description
        }
    }
}
