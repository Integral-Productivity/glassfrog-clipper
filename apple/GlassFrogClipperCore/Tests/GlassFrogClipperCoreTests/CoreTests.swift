import Foundation
import Testing

@testable import GlassFrogClipperCore

/// The Swift core's own behaviour, as distinct from its parity with TypeScript.
struct ConfigurationTests {

    @Test("configuration reports which pieces are missing, not merely that it is incomplete")
    func gapsAreEnumerated() {
        // R21's requirement, restated natively: the Share Extension has to tell
        // the practitioner what to do next, and "not configured" does not.
        #expect(Configuration().gaps == [.apiKey, .captureRole])
        #expect(Configuration(apiKey: "k").gaps == [.captureRole])
        #expect(Configuration(apiKey: "k", captureRoleId: "role_1").gaps == [])
        #expect(Configuration(apiKey: "k", captureRoleId: "role_1").isConfigured)
    }

    @Test("a blank key counts as absent rather than sailing past into an opaque 401")
    func blankKeyIsAbsent() {
        #expect(Configuration(apiKey: "   ", captureRoleId: "role_1").gaps == [.apiKey])
        #expect(Configuration(apiKey: "", captureRoleId: "role_1").gaps == [.apiKey])
    }
}

struct FailureTests {

    @Test("401 is a reconfigure, not a retry")
    func rejectedKeyAsksForReconfiguration() {
        // R18: retrying a rejected key is time the practitioner will not get
        // back, and the share sheet makes it very cheap to retry pointlessly.
        let failure = FailureClassifier.classify(status: 401)
        #expect(failure.kind == .unusableRole)
        #expect(failure.reconfigure)
    }

    @Test("403 and 404 point at the role rather than the key")
    func rejectedRoleNamesTheRole() {
        for status in [403, 404] {
            let failure = FailureClassifier.classify(status: status)
            #expect(failure.kind == .unusableRole)
            #expect(failure.reconfigure)
            #expect(failure.message.contains("role"))
        }
    }

    @Test("a deferred request is preserved rather than reconfigured")
    func rateLimitPreserves() {
        let failure = FailureClassifier.classify(status: 429)
        #expect(failure.kind == .rateLimited)
        #expect(!failure.reconfigure)
    }

    @Test("R12: the API key never survives into a surfaced message")
    func keyIsRedacted() {
        let key = "gf_live_0123456789abcdef"
        // The realistic shape of the leak: an API echoing the request back in
        // its own error body, which then becomes the detail we show.
        let failure = FailureClassifier.classify(
            status: 422,
            detail: "rejected request with X-Auth-Token: \(key)",
            apiKey: key
        )
        #expect(!failure.message.contains(key))
        #expect(failure.message.contains("[redacted]"))
    }

    @Test("a short key does not turn redaction into a find-and-replace over ordinary words")
    func shortKeysAreNotRedacted() {
        #expect(FailureClassifier.redact("a note about the api", apiKey: "a") == "a note about the api")
    }

    @Test("a transport failure says the capture is saved rather than blaming the role")
    func transportFailureIsNetwork() {
        let failure = FailureClassifier.classify(transport: URLError(.notConnectedToInternet))
        #expect(failure.kind == .network)
        #expect(!failure.reconfigure)
    }
}

struct NativeMessageTests {

    @Test("a notice round-trips from the extension")
    func parsesNotice() {
        let parsed = NativeMessage.parse([
            "kind": "notice", "id": "clipper/failure/unusable-role",
            "title": "Capture needs attention", "message": "GlassFrog would not file to that role.",
        ])
        #expect(parsed == .notice(.init(
            id: "clipper/failure/unusable-role",
            title: "Capture needs attention",
            body: "GlassFrog would not file to that role."
        )))
    }

    @Test("configuration round-trips with its roles")
    func parsesConfiguration() {
        let parsed = NativeMessage.parse([
            "kind": "configure",
            "apiKey": "gf_live_key",
            "captureRoleId": "role_abc",
            "defaultStatus": "someday",
            "roles": [["id": "role_abc", "name": "Product Owner"]],
        ])
        guard case let .configure(configuration) = parsed else {
            Issue.record("expected a configure message"); return
        }
        #expect(configuration.apiKey == "gf_live_key")
        #expect(configuration.captureRoleId == "role_abc")
        #expect(configuration.defaultStatus == .someday)
        #expect(configuration.roles == [RoleSummary(id: "role_abc", name: "Product Owner")])
    }

    @Test("an unnamed role keeps its id rather than becoming blank")
    func unnamedRoleKeepsItsId() {
        // Role names are nullable in the v5 schema, and an id is opaque hex —
        // a blank option is one the practitioner cannot tell from another.
        guard case let .configure(configuration) = NativeMessage.parse([
            "kind": "configure", "roles": [["id": "role_abc"]],
        ]) else { Issue.record("expected a configure message"); return }
        #expect(configuration.roles.first?.name == "role_abc")
    }

    @Test("anything unrecognised is ignored rather than misread")
    func unknownShapesAreIgnored() {
        // The handler is a trust boundary. Guessing at a shape we do not know
        // is how a malformed message becomes a wrong action.
        #expect(NativeMessage.parse(nil) == nil)
        #expect(NativeMessage.parse("a string") == nil)
        #expect(NativeMessage.parse(["kind": "drop-tables"]) == nil)
        #expect(NativeMessage.parse(["kind": "notice"]) == nil, "a notice with no text is not a notice")
    }

    @Test("the reply omits configuration unless one was asked for")
    func replyIsMinimal() {
        // The reply carries the API key when it carries configuration at all,
        // so it must not be included on the notice path, which runs far more
        // often and needs none of it.
        let plain = NativeMessage.reply(delivered: true)
        #expect(plain["configuration"] == nil)
        #expect(plain["delivered"] as? Bool == true)
    }
}

struct GlassFrogClientTests {

    @Test("an item id is read whether or not the response is enveloped")
    func identifierSurvivesBothShapes() {
        // v5 envelopes single resources in `data`; the SDK's own ADR records an
        // envelope change. Both shapes are accepted so this keeps working.
        #expect(GlassFrogClient.identifier(in: Data(#"{"data":{"id":"ten_1"}}"#.utf8)) == "ten_1")
        #expect(GlassFrogClient.identifier(in: Data(#"{"id":"ten_2"}"#.utf8)) == "ten_2")
        #expect(GlassFrogClient.identifier(in: Data(#"{"tension":{"id":"ten_3"}}"#.utf8)) == "ten_3")
        #expect(GlassFrogClient.identifier(in: Data("not json".utf8)) == nil)
    }
}

struct CaptureFilerTests {

    @Test("the timestamp format matches JavaScript's toISOString")
    func timestampMatchesJavaScript() {
        // Both surfaces write into the same field. A capture whose timestamp
        // format depends on which one filed it is a needless difference for
        // anyone reading them side by side later.
        let stamped = CaptureFiler.timestamp(Date(timeIntervalSince1970: 1_788_969_600))
        #expect(stamped == "2026-09-09T16:00:00.000Z")
    }

    @Test("page fields are bounded at capture time, not only at compose time")
    func pageFieldsAreBounded() {
        // An untruncated multi-megabyte selection would otherwise travel whole
        // through the share sheet's memory-constrained extension process.
        let page = CaptureFiler.pageContext(
            url: "https://example.org/" + String(repeating: "p", count: 10_000),
            title: String(repeating: "t", count: 10_000),
            selection: String(repeating: "s", count: 10_000)
        )
        #expect(page.url.unicodeScalars.count == Compose.evidenceFieldLimit)
        #expect(page.title.unicodeScalars.count == Compose.evidenceFieldLimit)
        #expect(page.selection?.unicodeScalars.count == Compose.evidenceFieldLimit)
    }

    @Test("a blank selection is absent rather than empty")
    func blankSelectionIsAbsent() {
        #expect(CaptureFiler.pageContext(url: "https://example.org", title: "t", selection: "   ").selection == nil)
        #expect(CaptureFiler.pageContext(url: "https://example.org", title: "t").selection == nil)
    }
}

struct RoleReadingTests {

    @Test("roles are read from the envelope, the bare body, and a bare list alike")
    func rolesSurviveEveryShape() {
        // The shape that broke the first real install: the API envelopes single
        // resources in `data`, and reading `roles` off the un-unwrapped body
        // yields nothing even for an account filling dozens of roles.
        let enveloped = Data(#"{"data":{"roles":[{"id":"role_a","name":"Lead Link"}]}}"#.utf8)
        let bare = Data(#"{"roles":[{"id":"role_a","name":"Lead Link"}]}"#.utf8)
        let list = Data(#"{"data":[{"id":"role_a","name":"Lead Link"}]}"#.utf8)
        let array = Data(#"[{"id":"role_a","name":"Lead Link"}]"#.utf8)

        for (label, data) in [("enveloped", enveloped), ("bare", bare), ("list", list), ("array", array)] {
            #expect(
                GlassFrogClient.roleSummaries(in: data) == [RoleSummary(id: "role_a", name: "Lead Link")],
                "\(label) shape did not yield the role"
            )
        }
    }

    @Test("an unnamed role stays distinguishable from another unnamed role")
    func unnamedRolesRemainDistinct() {
        // Nullable in the v5 schema. Two blank options are indistinguishable,
        // and the id is opaque hex, so there is nothing else to go on.
        let data = Data(#"[{"id":"role_abcdef0123"},{"id":"role_99887766","name":"  "}]"#.utf8)
        let roles = GlassFrogClient.roleSummaries(in: data)
        #expect(roles.map(\.name) == ["Untitled role (abcdef01)", "Untitled role (99887766)"])
    }

    @Test("a role with no id is skipped rather than invented")
    func rolesWithoutIdsAreSkipped() {
        // A role id is the path parameter every create needs (ADR 0003). One
        // without an id cannot be filed against, so offering it in the picker
        // would be offering a guaranteed failure.
        #expect(GlassFrogClient.roleSummaries(in: Data(#"[{"name":"No id"}]"#.utf8)).isEmpty)
        #expect(GlassFrogClient.roleSummaries(in: Data("not json".utf8)).isEmpty)
    }
}

struct AmbiguousOutcomeTests {

    @Test("a failure that names its own rejection is definitely not filed")
    func namedRejectionsAreDefinite() {
        // v5 has no idempotency key, so this flag is what decides whether
        // offering a retry risks a duplicate item on the capture role.
        for status in [401, 403, 404, 422, 429] {
            #expect(!FailureClassifier.classify(status: status).mayHaveFiled, "\(status) names its own rejection")
        }
    }

    @Test("an unclassified failure leaves the outcome open")
    func unclassifiedFailuresAreAmbiguous() {
        // Includes 5xx: a server error can follow a write that already
        // succeeded, so the outcome is unknown rather than negative.
        #expect(FailureClassifier.classify(status: 500).mayHaveFiled)
        #expect(FailureClassifier.classify(status: 502).mayHaveFiled)
    }

    @Test("a lost connection leaves the outcome open")
    func transportFailuresAreAmbiguous() {
        // A connection that never opened and a request whose response was lost
        // are indistinguishable here, and only one of them is safe to retry.
        #expect(FailureClassifier.classify(transport: URLError(.networkConnectionLost)).mayHaveFiled)
    }
}

struct ProjectLinkTests {

    @Test("a project carries its url in link as well as in the note")
    func projectCarriesLink() {
        let page = PageContext(url: "https://example.org/a", title: "A", capturedAt: "2026-08-31T16:00:00.000Z")
        guard case let .project(_, note, link) = Compose.compose(Capture(page: page, workType: .project)) else {
            Issue.record("expected a project"); return
        }
        // Both, deliberately: the note is the readable evidence block and is
        // subject to truncation, `link` is the canonical field and must not be.
        #expect(link == "https://example.org/a")
        #expect(note.contains("https://example.org/a"))
    }

    @Test("a project with no url omits link rather than sending it blank")
    func blankLinkIsOmitted() {
        let page = PageContext(url: "   ", title: "A", capturedAt: "2026-08-31T16:00:00.000Z")
        guard case let .project(_, _, link) = Compose.compose(Capture(page: page, workType: .project)) else {
            Issue.record("expected a project"); return
        }
        // `link: ""` would read in GlassFrog as a link that exists and is broken.
        #expect(link == nil)
    }

    @Test("the link is never truncated, however long the url")
    func linkIsNeverTruncated() {
        let long = "https://example.org/" + String(repeating: "q", count: 5_000)
        let page = PageContext(url: long, title: "A", capturedAt: "2026-08-31T16:00:00.000Z")
        guard case let .project(_, note, link) = Compose.compose(Capture(page: page, workType: .project)) else {
            Issue.record("expected a project"); return
        }
        #expect(link == long, "R7's cap applies to the readable evidence, not to the canonical field")
        #expect(note.count < long.count, "the note copy is still truncated")
    }
}
