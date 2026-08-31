import Foundation
import Testing

@testable import GlassFrogClipperCore

/// The Swift half of a two-language contract.
///
/// `compose()` exists in TypeScript for the Chrome and Safari extensions, and
/// here for the Share Extension, which files natively. ADR 0004 makes the
/// provenance marker the basis of the triage-survival metric, so a share-sheet
/// capture whose headline differs by one character is invisible to that metric
/// while looking entirely normal in GlassFrog.
///
/// Both suites assert against the same committed golden file rather than against
/// each other, so neither implementation can move without a visible diff in it.
struct ComposeParityTests {

    /// The fixture is read from the repository rather than bundled as a package
    /// resource. A bundled copy would be a second copy, which is precisely the
    /// drift this contract exists to prevent.
    static let fixtureURL: URL = {
        // …/apple/GlassFrogClipperCore/Tests/GlassFrogClipperCoreTests/<file>
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("test/fixtures/compose-cases.json")
    }()

    struct Fixture: Decodable {
        struct Case: Decodable {
            let name: String
            let capture: Capture
            let expected: Expected
        }
        /// Mirrors the discriminated union the TypeScript side emits.
        ///
        /// `link` is absent for tensions and actions, and absent for a project
        /// with no URL — the omit-rather-than-blank rule. Decoding it as an
        /// optional means "absent" and "present but empty" stay distinguishable,
        /// which is the whole point of that rule.
        struct Expected: Decodable {
            let kind: String
            let body: String?
            let description: String?
            let note: String?
            let link: String?
        }
        let cases: [Case]
    }

    static func load() throws -> Fixture {
        let data = try Data(contentsOf: fixtureURL)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    @Test("the Swift compose reproduces every case the TypeScript compose produced")
    func matchesGoldenFile() throws {
        let fixture = try Self.load()
        #expect(fixture.cases.count >= 12, "the fixture should not be able to shrink unnoticed")

        for testCase in fixture.cases {
            let actual = Compose.compose(testCase.capture)

            switch actual {
            case let .tension(body):
                #expect(testCase.expected.kind == "tension", "\(testCase.name): wrong shape")
                #expect(body == testCase.expected.body, "\(testCase.name): body diverged")
            case let .action(description, note):
                #expect(testCase.expected.kind == "action", "\(testCase.name): wrong shape")
                #expect(description == testCase.expected.description, "\(testCase.name): description diverged")
                #expect(note == testCase.expected.note, "\(testCase.name): note diverged")
            case let .project(description, note, link):
                #expect(testCase.expected.kind == "project", "\(testCase.name): wrong shape")
                #expect(description == testCase.expected.description, "\(testCase.name): description diverged")
                #expect(note == testCase.expected.note, "\(testCase.name): note diverged")
                #expect(link == testCase.expected.link, "\(testCase.name): link diverged")
            }
        }
    }

    @Test("R11 holds over the whole corpus: the marker leads its field, always")
    func markerAlwaysLeads() throws {
        for testCase in try Self.load().cases {
            let field = Compose.compose(testCase.capture).markedField
            #expect(field.hasPrefix(Compose.provenanceMarker), "\(testCase.name): marker must lead its field")
        }
    }

    @Test("the marker is byte-identical to the TypeScript constant")
    func markerMatchesTypeScript() throws {
        // Read from source rather than restated, so a change on either side is a
        // failing test rather than a silently orphaned corpus of filed items.
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        let source = try String(contentsOf: url.appendingPathComponent("src/compose.ts"), encoding: .utf8)

        #expect(
            source.contains("export const PROVENANCE_MARKER = '\(Compose.provenanceMarker)'"),
            "the Swift marker no longer matches src/compose.ts — every previously filed item is orphaned"
        )
    }

    @Test("truncation counts Unicode scalars, not grapheme clusters")
    func truncationCountsScalars() {
        // The specific way a Swift port goes wrong. `String.prefix(limit)` would
        // count 47 here where JavaScript's Array.from counts 200.
        let family = String(repeating: "👩‍👩‍👧‍👦", count: 120)
        let truncated = Compose.truncate(family, limit: 200)

        #expect(truncated.unicodeScalars.count == 200)
        #expect(truncated.count != 200, "if these were equal the test would not be exercising the difference")
        #expect(truncated.hasSuffix("…"))
    }

    @Test("a title long enough to crowd out the marker still leaves it whole")
    func markerSurvivesAnyTitle() {
        let page = PageContext(
            url: "https://example.org",
            title: String(repeating: "x", count: 5_000),
            capturedAt: "2026-08-31T16:00:00.000Z"
        )
        let head = Compose.headline(page)

        #expect(head.hasPrefix(Compose.provenanceMarker))
        #expect(head.unicodeScalars.count <= Compose.headlineLimit)
    }
}
