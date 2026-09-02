import Foundation

/// Failure classification, ported from `src/errors.ts`.
///
/// KTD9 splits failures four ways rather than two, because R18 requires the
/// practitioner learn that an *unusable role* needs reconfiguring rather than a
/// retry — the distinction that decides whether waiting will ever help. A
/// share-sheet capture that says only "it failed" sends someone back to the
/// share sheet to fail again.
///
/// R12 governs everything that leaves here: no surfaced or logged string may
/// carry the API key or the headers bearing it.
public enum FailureKind: String, Sendable, Equatable {
    /// A role id the API will not accept, or a key it rejects. Retrying cannot help.
    case unusableRole
    /// 429 — the request was understood and deferred.
    case rateLimited
    /// The request never reached GlassFrog.
    case network
    /// 422 — the request was understood and refused.
    case invalidPayload
    /// Anything unclassified; preserved and surfaced rather than guessed at.
    case unknown
}

public struct CaptureFailure: Error, Sendable, Equatable {
    public let kind: FailureKind
    /// Safe to show a practitioner: redacted, and never carrying request headers.
    public let message: String
    /// True when R18's reconfigure path applies rather than preserve-and-retry.
    public let reconfigure: Bool
    /// Whether the write may have reached GlassFrog despite the failure.
    ///
    /// False for anything that names its own rejection — every 4xx, and the
    /// client-side validation that never reached the network. True only where
    /// the outcome is genuinely unknown: a request that may have been received
    /// before the connection died, or a 5xx that may have followed a completed
    /// write. v5 has no idempotency key, so this is what decides whether
    /// offering a retry risks a duplicate.
    public let mayHaveFiled: Bool

    public init(kind: FailureKind, message: String, reconfigure: Bool, mayHaveFiled: Bool) {
        self.kind = kind
        self.message = message
        self.reconfigure = reconfigure
        self.mayHaveFiled = mayHaveFiled
    }
}

public enum FailureClassifier {

    /// Named rather than written as bare booleans at each call site: the two
    /// values read identically in a diff and mean opposite things about whether
    /// a retry can duplicate an item.
    private static let notFiled = false
    private static let mayHaveFiled = true

    /// Removes the API key from a string before it can be shown or logged.
    ///
    /// The same second layer `redact()` provides in TypeScript. It costs one
    /// pass over a short string, and it means a future change that echoes a
    /// request into an error message cannot become a key disclosure without
    /// someone noticing. The length floor avoids a short or empty key turning
    /// this into a find-and-replace over ordinary words.
    public static func redact(_ text: String, apiKey: String?) -> String {
        guard let apiKey, apiKey.count >= 8 else { return text }
        return text.replacingOccurrences(of: apiKey, with: "[redacted]")
    }

    /// Classifies an HTTP status. Mirrors the switch in `classifyFailure`.
    public static func classify(status: Int, detail: String = "", apiKey: String? = nil) -> CaptureFailure {
        let safe = redact(detail, apiKey: apiKey)

        switch status {
        case 401:
            return CaptureFailure(
                kind: .unusableRole,
                message: "GlassFrog rejected the API key. Open GlassFrog Clipper to update it.",
                reconfigure: true,
                mayHaveFiled: notFiled
            )
        case 403, 404:
            return CaptureFailure(
                kind: .unusableRole,
                message: "GlassFrog would not file to that role. Open GlassFrog Clipper to choose another.",
                reconfigure: true,
                mayHaveFiled: notFiled
            )
        case 429:
            return CaptureFailure(
                kind: .rateLimited,
                message: "GlassFrog is rate limiting requests. Your capture is saved — try again shortly.",
                reconfigure: false,
                mayHaveFiled: notFiled
            )
        case 422:
            return CaptureFailure(
                kind: .invalidPayload,
                message: "GlassFrog refused the request: \(safe)",
                reconfigure: false,
                mayHaveFiled: notFiled
            )
        default:
            // Unclassified, which includes 5xx: a server error can follow a write
            // that already succeeded, so the outcome is unknown rather than negative.
            return CaptureFailure(
                kind: .unknown, message: "Filing failed: \(safe)",
                reconfigure: false, mayHaveFiled: mayHaveFiled
            )
        }
    }

    /// Classifies a transport error — one where no status ever arrived.
    public static func classify(transport error: Error, apiKey: String? = nil) -> CaptureFailure {
        let urlError = error as? URLError
        if urlError != nil {
            return CaptureFailure(
                kind: .network,
                message: "Could not reach GlassFrog. Your capture is saved — try again when you are back online.",
                reconfigure: false,
                // Covers both a connection that never opened and a request whose
                // response was lost, and nothing here can tell those apart.
                mayHaveFiled: mayHaveFiled
            )
        }
        return CaptureFailure(
            kind: .unknown,
            message: "Filing failed: \(redact(error.localizedDescription, apiKey: apiKey))",
            reconfigure: false,
            mayHaveFiled: mayHaveFiled
        )
    }
}
