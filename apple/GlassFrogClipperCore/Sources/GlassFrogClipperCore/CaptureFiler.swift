import Foundation

/// Files one capture natively, for the Share Extension.
///
/// The Swift counterpart of `fileCapture()` in `src/capture.ts`, minus the
/// in-flight marker. That omission is deliberate rather than an oversight:
/// KTD7's marker exists because Chrome can kill a service worker mid-request and
/// leave a capture in an unknown state. A Share Extension is not killed that way
/// — it is alive for as long as its own request, and the practitioner is looking
/// at it. There is no window to recover from, so there is nothing to record.
public struct CaptureFiler: Sendable {

    public enum FilingError: Error, Equatable {
        case notConfigured([Configuration.Gap])
    }

    private let store: ConfigurationStore

    public init(store: ConfigurationStore = ConfigurationStore()) {
        self.store = store
    }

    /// R3 / R5: a role the practitioner named is used as given and is never
    /// replaced by the configured one; a capture that names none falls back to
    /// the configured capture role.
    public func file(_ capture: Capture, session: URLSession = .shared) async throws -> GlassFrogClient.CreatedItem {
        let configuration = store.load()
        guard configuration.isConfigured, let apiKey = configuration.apiKey else {
            // R9's hold has no equivalent here. The share sheet is modal and the
            // practitioner is present, so telling them now is strictly better
            // than parking the capture for a configuration step they would have
            // to discover on their own.
            throw FilingError.notConfigured(configuration.gaps)
        }

        guard let roleId = capture.roleId ?? configuration.captureRoleId else {
            throw FilingError.notConfigured([.captureRole])
        }

        let client = GlassFrogClient(apiKey: apiKey, session: session)
        return try await client.file(Compose.compose(capture), roleId: roleId, status: configuration.defaultStatus)
    }

    /// Builds the page context the share sheet can supply.
    ///
    /// `capturedAt` is ISO-8601 with milliseconds, matching JavaScript's
    /// `toISOString()` — the two producers write into the same field, and a
    /// capture whose timestamp format depends on which surface filed it is a
    /// needless difference for anyone reading them later.
    public static func pageContext(url: String, title: String, selection: String? = nil) -> PageContext {
        let trimmedSelection = selection?.trimmingCharacters(in: .whitespacesAndNewlines)
        return PageContext(
            // R7: the credential strip runs here for the same reason it runs in
            // `pageContextFromTab` on the extension side — this is where a share
            // becomes a PageContext, and it must happen before truncation.
            url: Compose.truncate(Compose.stripUrlCredentials(url)),
            title: Compose.truncate(title),
            selection: (trimmedSelection?.isEmpty ?? true) ? nil : Compose.truncate(trimmedSelection!),
            capturedAt: timestamp()
        )
    }

    /// `ISO8601FormatStyle` rather than `ISO8601DateFormatter`: the formatter is
    /// a non-Sendable class, and holding one in a static would be a mutable
    /// global shared across the app and two extensions.
    public static func timestamp(_ date: Date = Date()) -> String {
        date.formatted(
            .iso8601
                .year().month().day()
                .dateTimeSeparator(.standard)
                .time(includingFractionalSeconds: true)
                .timeZone(separator: .omitted)
        )
    }
}
