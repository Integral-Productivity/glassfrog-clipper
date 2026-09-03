import Foundation
import Testing
import UniformTypeIdentifiers

@testable import GlassFrogClipperCore

// The share sheet's phase machine.
//
// WHAT THIS PROVES, PRECISELY: that the states this extension puts a
// practitioner in, and the transitions between them, still follow from the
// configuration and the API response that produced them. It runs offline under
// `swift test` against a stubbed `URLSession` and a stubbed configuration read,
// so it cannot observe a share sheet, a Keychain, an App Group container or
// GlassFrog, and must never be read as evidence that capture works on a device.
// Nothing here renders a view either: it asserts on `ShareCaptureModel.phase`,
// and `ShareCaptureView`'s switch over that phase is unexercised.
//
// What catches a real device is a signed build, by hand; apple/README.md says
// what still needs one. What this file catches is a transition drifting
// silently — R18's `reconfigure` flag stopping at `CaptureFiler` and never
// reaching the phase reads perfectly well and puts a "Try again" button in
// front of a rejected API key, which is the one failure retrying can never fix.
//
// This is the presentation half of the share sheet. docs/adr/0011 splits
// behaviour into a domain layer and a platform surface layer, and the phase
// machine is neither: `features/clipping-a-page.feature` states what gets filed
// and `ShareSheetSurfaceTests.swift` states how a share is read, but what the
// practitioner is *told* between those two is decided here and nowhere else.
// That boundary note is restated rather than referenced on purpose — a reader
// arrives at one of these files and must not have to find the other two to
// learn what a green run is worth.
//
// Only two things on this path leave the process: the Keychain read behind
// `ConfigurationStore`, and the HTTP request behind `CaptureFiler`. Those two
// are stubbed and nothing else is. The filer under test is the real
// `CaptureFiler`, the classifier is the real `FailureClassifier`, and the body
// on the wire is the real `Compose` output — so a scenario below that says "a
// rejected key must not offer a retry" is a claim about the composition of
// those, not about a stand-in that was told what to return.

/// What the practitioner is told, and when.
@Suite(.serialized)
@MainActor
struct ShareCapturePhaseTests {

    // MARK: Fixtures

    private static let configured = Configuration(
        apiKey: "gf_test_key_0123456789",
        captureRoleId: "role_configured",
        roles: [RoleSummary(id: "role_configured", name: "Lead Link"), RoleSummary(id: "role_other", name: "Facilitator")]
    )

    /// A configuration read that never touches a Keychain.
    private struct StubConfiguration: ConfigurationReading {
        let configuration: Configuration
        func load() -> Configuration { configuration }
    }

    private static func urlProvider(_ string: String) -> NSItemProvider {
        NSItemProvider(item: NSURL(string: string)!, typeIdentifier: UTType.url.identifier)
    }

    private static func share(title: String? = nil, url: String? = "https://example.test/page") -> [NSExtensionItem] {
        let item = NSExtensionItem()
        if let title { item.attributedTitle = NSAttributedString(string: title) }
        if let url { item.attachments = [urlProvider(url)] }
        return [item]
    }

    /// A model wired to the real `CaptureFiler`, with only the two crossings
    /// out of the process replaced.
    private static func model(
        configuration: Configuration = configured,
        filerSees: Configuration? = nil
    ) -> ShareCaptureModel {
        let store = StubConfiguration(configuration: configuration)
        return ShareCaptureModel(
            store: store,
            filer: CaptureFiler(
                store: StubConfiguration(configuration: filerSees ?? configuration),
                session: StubTransport.session()
            )
        )
    }

    // MARK: Before anything can be captured

    // The order of the two guards is the decision. An unconfigured practitioner
    // who shares something empty needs to hear about the configuration, because
    // that is the one they can act on; telling them the share carried nothing
    // sends them back to try another page and fail the same way.
    @Test("an unconfigured extension says so before it says anything about the share")
    func notConfiguredIsReportedFirst() async {
        let model = Self.model(configuration: Configuration(apiKey: nil, captureRoleId: nil))
        await model.load(items: [])

        #expect(model.phase == .notConfigured)
    }

    // Half-configured is a state of its own (`Configuration.gaps`), and the
    // share sheet cannot file from it: `CaptureFiler` needs both a key and a
    // role. Treating a present-but-unusable configuration as ready would put a
    // form in front of someone whose File button cannot work.
    @Test("a key with no capture role is not configured enough to file")
    func aMissingRoleIsNotConfigured() async {
        let model = Self.model(configuration: Configuration(apiKey: "gf_test_key_0123456789", captureRoleId: nil))
        await model.load(items: Self.share(title: "Policy draft"))

        #expect(model.phase == .notConfigured)
    }

    // An item with no evidence is worse than none: it survives into triage and
    // has to be read before it can be discarded. `SharedItem` returns nil for
    // such a share; turning that nil into a filed tension is the mistake this
    // phase exists to prevent.
    @Test("a share carrying nothing is refused rather than filed empty")
    func nothingToCaptureIsRefused() async {
        let model = Self.model()
        await model.load(items: Self.share(title: nil, url: nil))

        #expect(model.phase == .nothingToCapture)
    }

    @Test("a share carrying a page is ready, titled by what was shared")
    func aReadableShareIsReady() async {
        let model = Self.model()
        await model.load(items: Self.share(title: "Governance meeting notes"))

        #expect(model.phase == .ready)
        #expect(model.pageTitle == "Governance meeting notes")
    }

    // MARK: R5 — the configured role only ever fills a gap

    @Test("the configured role seeds the picker, and the picker offers what was cached")
    func theConfiguredRoleSeedsThePicker() async {
        let model = Self.model()
        await model.load(items: Self.share(title: "Policy draft"))

        #expect(model.roleId == "role_configured")
        #expect(model.roles.map(\.id) == ["role_configured", "role_other"])
    }

    // The half of R5 that is not about speed. Seeding is a default; a role the
    // practitioner picked afterwards is a decision already made, and filing
    // against the configured one instead would discard it silently — the item
    // lands somewhere they will not look.
    @Test("a role picked after loading is the one filed against")
    func aPickedRoleIsNotOverwritten() async {
        StubTransport.willReturn(status: 201, body: #"{"id":"ten_1"}"#)
        let model = Self.model()
        await model.load(items: Self.share(title: "Budget question"))

        model.roleId = "role_other"
        await model.file()

        #expect(model.phase == .filed)
        #expect(StubTransport.lastRequest?.url?.path.hasSuffix("/roles/role_other/tensions") == true)
    }

    // R4 / KD2 in the other direction: a work type the practitioner chose has
    // to reach the wire as that work type. `Compose` cannot recover it — the
    // three shapes are different endpoints, not a field.
    @Test("a chosen work type reaches GlassFrog as that work type")
    func aChosenWorkTypeIsHonoured() async {
        StubTransport.willReturn(status: 201, body: #"{"id":"act_1"}"#)
        let model = Self.model()
        await model.load(items: Self.share(title: "Onboarding has no owner"))

        model.workType = .action
        await model.file()

        #expect(model.phase == .filed)
        #expect(StubTransport.lastRequest?.url?.path.hasSuffix("/roles/role_configured/actions") == true)
    }

    // MARK: Filing

    @Test("a share the API accepts ends filed")
    func aSuccessfulFileEndsFiled() async {
        StubTransport.willReturn(status: 201, body: #"{"data":{"id":"ten_1"}}"#)
        let model = Self.model()
        await model.load(items: Self.share(title: "Retro format"))
        model.note = "this keeps producing the same three items"
        await model.file()

        #expect(model.phase == .filed)
    }

    // The File button is disabled and a spinner shown on `.filing`, so a phase
    // that stays `.ready` across the await lets a second tap file the capture
    // twice — and v5 has no idempotency key to make the duplicate harmless.
    @Test("the sheet is in flight for as long as the request is")
    func filingIsEnteredBeforeTheRequest() async {
        let spy = PhaseSpy()
        let model = ShareCaptureModel(
            store: StubConfiguration(configuration: Self.configured),
            filer: ObservingFiler { spy.record() }
        )
        spy.model = model

        await model.load(items: Self.share(title: "Policy draft"))
        await model.file()

        #expect(spy.seen == .filing)
        #expect(model.phase == .filed)
    }

    // The guard is not decoration. `.notConfigured` and `.nothingToCapture` both
    // leave the model with no page, and the view's Close button is not the only
    // way back — filing from either would compose a capture out of nothing.
    @Test("filing with nothing loaded does nothing at all")
    func filingWithoutAPageIsANoOp() async {
        StubTransport.reset()
        let model = Self.model()
        await model.load(items: Self.share(title: nil, url: nil))
        await model.file()

        #expect(model.phase == .nothingToCapture)
        #expect(StubTransport.requestCount == 0)
    }

    // MARK: R18 — retry, or go and fix something

    // The distinction "it failed" cannot carry, and the one that matters most
    // here: the share sheet makes retrying almost free, and retrying a rejected
    // key is time the practitioner will not get back. `ShareCaptureView` hides
    // the retry button on exactly this flag.
    @Test("a rejected key is reported as needing attention, not as worth retrying")
    func aRejectedKeyAsksForReconfiguration() async {
        StubTransport.willReturn(status: 401, body: "unauthorized")
        let model = Self.model()
        await model.load(items: Self.share(title: "Policy draft"))
        await model.file()

        guard case let .failed(message, reconfigure) = model.phase else {
            Issue.record("expected a failure, got \(model.phase)"); return
        }
        #expect(reconfigure)
        #expect(message.contains("API key"))
    }

    @Test("a role GlassFrog will not accept is reported as needing attention")
    func anUnusableRoleAsksForReconfiguration() async {
        for status in [403, 404] {
            StubTransport.willReturn(status: status, body: "no")
            let model = Self.model()
            await model.load(items: Self.share(title: "Policy draft"))
            await model.file()

            guard case let .failed(_, reconfigure) = model.phase else {
                Issue.record("expected a failure for \(status), got \(model.phase)"); return
            }
            #expect(reconfigure, "\(status) is an unusable role, which a retry cannot fix")
        }
    }

    // The other side of the same flag. Waiting genuinely does help here, so the
    // retry button has to be there — the practitioner is standing in another
    // app and re-sharing costs them the trip back.
    @Test("a rate limit and a dropped connection are both worth retrying")
    func transientFailuresKeepTheRetry() async {
        StubTransport.willReturn(status: 429, body: "slow down")
        let limited = Self.model()
        await limited.load(items: Self.share(title: "Policy draft"))
        await limited.file()
        #expect(limited.phase == .failed(message: rateLimitMessage, reconfigure: false))

        StubTransport.willFail(with: URLError(.notConnectedToInternet))
        let offline = Self.model()
        await offline.load(items: Self.share(title: "Policy draft"))
        await offline.file()
        guard case let .failed(_, reconfigure) = offline.phase else {
            Issue.record("expected a failure, got \(offline.phase)"); return
        }
        #expect(!reconfigure)
    }

    private let rateLimitMessage = "GlassFrog is rate limiting requests. Your capture is saved — try again shortly."

    // R12: nothing that reaches a practitioner or a log may carry the key. A
    // 422's detail is echoed from the response, which is the one place a
    // request's own contents can come back around.
    @Test("a failure message never carries the API key back to the practitioner")
    func failureMessagesAreRedacted() async {
        StubTransport.willReturn(status: 422, body: "rejected token gf_test_key_0123456789")
        let model = Self.model()
        await model.load(items: Self.share(title: "Policy draft"))
        await model.file()

        guard case let .failed(message, _) = model.phase else {
            Issue.record("expected a failure, got \(model.phase)"); return
        }
        #expect(!message.contains("gf_test_key_0123456789"))
        #expect(message.contains("[redacted]"))
    }

    // MARK: Configuration that goes away while the sheet is open

    // R9's hold has no equivalent here — the share sheet is modal and the
    // practitioner is present — so a configuration that disappears between the
    // form loading and the File tap has to route to the surface that tells them
    // what to fix, not to a generic failure with a retry button that cannot
    // work. `CaptureFiler` throws its own error for this rather than a
    // `CaptureFailure`, and the phase machine is where the two are told apart.
    @Test("configuration lost between loading and filing sends the practitioner to fix it")
    func configurationLostMidSheetIsNotAGenericFailure() async {
        StubTransport.reset()
        let model = Self.model(configuration: Self.configured, filerSees: Configuration())
        await model.load(items: Self.share(title: "Policy draft"))
        #expect(model.phase == .ready)

        await model.file()

        #expect(model.phase == .notConfigured)
        #expect(StubTransport.requestCount == 0, "nothing should reach the network without a key")
    }

    // MARK: A failure the practitioner can act on twice

    @Test("a retry after a transient failure files the capture")
    func aRetryAfterAFailureFiles() async {
        StubTransport.willFail(with: URLError(.timedOut))
        let model = Self.model()
        await model.load(items: Self.share(title: "Policy draft"))
        await model.file()
        guard case .failed = model.phase else {
            Issue.record("expected a failure, got \(model.phase)"); return
        }

        StubTransport.willReturn(status: 201, body: #"{"id":"ten_1"}"#)
        await model.file()

        #expect(model.phase == .filed)
    }

    // KNOWN GAP, pinned rather than described: `CaptureFailure` carries a
    // fourth field, `mayHaveFiled`, which says whether the write may have
    // reached GlassFrog despite the failure. The phase machine drops it, so a
    // 500 — whose outcome is genuinely unknown, because a server error can
    // follow a completed write — is indistinguishable from a 429, whose
    // rejection is definite. Both render the same "Try again" button, and v5
    // has no idempotency key to make the resulting duplicate harmless.
    //
    // On Chrome the same flag decides whether the in-flight marker survives so
    // the practitioner is told to go and check (`settleInFlight` in
    // src/pending.ts). The share sheet has no marker — `CaptureFiler` says why
    // — and so has nowhere for this to land yet.
    //
    // This test states what is true today. Changing it is the point of #146.
    @Test("an ambiguous outcome is currently indistinguishable from a definite one")
    func ambiguousOutcomesAreNotYetDistinguished() async {
        StubTransport.willReturn(status: 500, body: "boom")
        let ambiguous = Self.model()
        await ambiguous.load(items: Self.share(title: "Policy draft"))
        await ambiguous.file()

        StubTransport.willReturn(status: 429, body: "slow down")
        let definite = Self.model()
        await definite.load(items: Self.share(title: "Policy draft"))
        await definite.file()

        guard case let .failed(_, ambiguousReconfigure) = ambiguous.phase,
              case let .failed(_, definiteReconfigure) = definite.phase else {
            Issue.record("expected two failures"); return
        }
        // The classifier knows the difference.
        #expect(FailureClassifier.classify(status: 500).mayHaveFiled)
        #expect(!FailureClassifier.classify(status: 429).mayHaveFiled)
        // The phase does not, so the sheet offers the same retry for both.
        #expect(ambiguousReconfigure == definiteReconfigure)
    }
}

// MARK: - Doubles

/// Reads the model's phase from inside the filing request.
///
/// `.filing` is set before the await and replaced after it, so it is only
/// observable while the request is in flight. This is the one place a stand-in
/// filer is the honest tool: what is under test is the model's own sequencing,
/// and a real request would only make the observation point harder to reach.
@MainActor
final class PhaseSpy {
    var model: ShareCaptureModel?
    var seen: ShareCaptureModel.Phase?

    func record() { seen = model?.phase }
}

private struct ObservingFiler: CaptureFiling {
    let observe: @Sendable @MainActor () -> Void

    func file(_ capture: Capture) async throws -> GlassFrogClient.CreatedItem {
        await observe()
        return GlassFrogClient.CreatedItem(id: "ten_1")
    }
}

/// The HTTP request `CaptureFiler` makes, answered without a network.
///
/// A `URLProtocol` rather than a fake client, so everything between the phase
/// machine and the socket is the shipping code: `GlassFrogClient` builds the
/// request, reads the status and unwraps the envelope, and `FailureClassifier`
/// turns a status into the `CaptureFailure` the phase is derived from.
///
/// Its state is static because `URLSessionConfiguration.protocolClasses` takes
/// a type rather than an instance. `ShareCapturePhaseTests` is `.serialized`
/// for that reason.
final class StubTransport: URLProtocol {

    private struct State {
        var status = 201
        var body = "{}"
        var error: URLError?
        var requests: [URLRequest] = []
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var state = State()

    private static func withState<T>(_ change: (inout State) -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return change(&state)
    }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubTransport.self]
        return URLSession(configuration: configuration)
    }

    static func reset() {
        withState { $0 = State() }
    }

    static func willReturn(status: Int, body: String) {
        withState { $0 = State(status: status, body: body) }
    }

    static func willFail(with error: URLError) {
        withState { $0 = State(error: error) }
    }

    static var lastRequest: URLRequest? {
        withState { $0.requests.last }
    }

    static var requestCount: Int {
        withState { $0.requests.count }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let recorded = request
        let outcome = StubTransport.withState { state -> (Int, String, URLError?) in
            state.requests.append(recorded)
            return (state.status, state.body, state.error)
        }

        if let error = outcome.2 {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: outcome.0,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(outcome.1.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
