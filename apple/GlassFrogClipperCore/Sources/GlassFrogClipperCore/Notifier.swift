import Foundation
import UserNotifications

/// Raises the system notifications the Safari extension cannot raise itself.
///
/// This is the second link in `src/notify.ts`'s chain. Safari implements no
/// `chrome.notifications`, so a notice about a capture that failed in the
/// background has nowhere to go inside the extension. It is handed to the
/// containing app instead, and the app has the whole of `UserNotifications`.
///
/// The honesty of the reply is the point. `deliver` returns false whenever the
/// notice did not actually reach the practitioner — permission denied, or the
/// request rejected — and the extension then falls through to storing it. An
/// optimistic `true` would convert a denied permission into a silently dropped
/// failure notice, which is exactly the case the chain was built for.
/// `@unchecked Sendable` because `UNUserNotificationCenter` is a thread-safe
/// singleton that predates the `Sendable` annotations. The only stored property
/// is that centre, so the unchecked part is precisely that annotation gap.
public struct Notifier: @unchecked Sendable {

    private let center: UNUserNotificationCenter

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    /// Asks once, at a moment the practitioner has context for it.
    ///
    /// Called from the app rather than from the extension handler: a permission
    /// prompt appearing because a background capture failed would be the second
    /// surprise in a row, and the practitioner has no way to connect it to what
    /// they did.
    @discardableResult
    public func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }

    public func isAuthorized() async -> Bool {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        default: return false
        }
    }

    @discardableResult
    public func deliver(title: String, body: String, id: String) async -> Bool {
        guard await isAuthorized() else { return false }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body

        // nil trigger: deliver now. The notice is already late — it describes
        // something that has finished happening.
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        do {
            try await center.add(request)
            return true
        } catch {
            return false
        }
    }
}
