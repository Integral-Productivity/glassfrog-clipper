import Foundation

/// The protocol between the Safari web extension and its containing app.
///
/// Safari gives an extension its own `chrome.storage.local` inside the
/// extension's sandbox, which the app and the Share Extension cannot read. So
/// the same practitioner configuring "the clipper" once would otherwise have to
/// configure it twice — and STRATEGY.md's whole position is that the tool does
/// not put decisions between sensing and filing.
///
/// The sync is deliberately **one-way at configuration time**, not a
/// read-through on the capture path. A capture that had to wake the containing
/// app to learn its own role id would pay a process launch on the one path the
/// strategy protects, and would fail entirely when the app is unavailable. So:
///
///   - `configure` — the extension pushes configuration to the app when the
///     practitioner saves it. The app and the Share Extension read from the
///     shared store afterwards.
///   - `requestConfiguration` — the extension asks once, when it finds itself
///     unconfigured, so configuration entered in the app flows the other way.
///   - `notice` — a notice the extension could not deliver itself, because
///     Safari implements no `chrome.notifications`. See `src/notify.ts`.
///
/// Both directions carry the API key, which is why this is the extension
/// talking to *its own* containing app over Safari's native-messaging channel
/// and never to anything else.
public enum NativeMessage {

    public enum Kind: String {
        case notice
        case configure
        case requestConfiguration = "request-configuration"
    }

    public struct Notice: Sendable, Equatable {
        public let id: String
        public let title: String
        public let body: String
    }

    /// What the extension sent, or nil when it is not something we handle.
    ///
    /// Unrecognised input is ignored rather than treated as an error: the
    /// handler is a trust boundary, and the useful response to a message shape
    /// we do not know is to do nothing with it.
    public static func parse(_ raw: Any?) -> Parsed? {
        guard let payload = raw as? [String: Any],
              let kindString = payload["kind"] as? String,
              let kind = Kind(rawValue: kindString) else { return nil }

        switch kind {
        case .notice:
            guard let title = payload["title"] as? String,
                  let message = payload["message"] as? String else { return nil }
            return .notice(Notice(id: payload["id"] as? String ?? UUID().uuidString, title: title, body: message))

        case .configure:
            var configuration = Configuration()
            configuration.apiKey = payload["apiKey"] as? String
            configuration.captureRoleId = payload["captureRoleId"] as? String
            configuration.defaultStatus = DefaultStatus(rawValue: payload["defaultStatus"] as? String ?? "") ?? .current
            if let roles = payload["roles"] as? [[String: Any]] {
                configuration.roles = roles.compactMap { role in
                    guard let id = role["id"] as? String else { return nil }
                    return RoleSummary(id: id, name: role["name"] as? String ?? id)
                }
            }
            return .configure(configuration)

        case .requestConfiguration:
            return .requestConfiguration
        }
    }

    public enum Parsed: Sendable, Equatable {
        case notice(Notice)
        case configure(Configuration)
        case requestConfiguration
    }

    /// The reply shape the extension reads back.
    ///
    /// `delivered` is load-bearing: `src/notify.ts` treats a reachable app that
    /// did *not* deliver as a failure and falls through to storage, so the
    /// practitioner still learns about it. Answering `true` unconditionally
    /// would turn a denied notification permission into a silently dropped
    /// notice, which is the failure the chain exists to prevent.
    public static func reply(delivered: Bool, configuration: Configuration? = nil) -> [String: Any] {
        var payload: [String: Any] = ["delivered": delivered]
        guard let configuration else { return payload }

        payload["configuration"] = [
            "apiKey": configuration.apiKey ?? "",
            "captureRoleId": configuration.captureRoleId ?? "",
            "defaultStatus": configuration.defaultStatus.rawValue,
            "roles": configuration.roles.map { ["id": $0.id, "name": $0.name] },
        ]
        return payload
    }
}
