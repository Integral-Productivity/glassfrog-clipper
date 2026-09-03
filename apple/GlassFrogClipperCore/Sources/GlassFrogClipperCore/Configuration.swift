import Foundation

/// The configuration the capture path needs before it can file anything.
///
/// Mirrors `getConfigurationState()` in `src/storage.ts`: reported as *which*
/// pieces are missing rather than as a boolean, because a valid key with no role
/// chosen yet is a real, distinct state — the app's save is two-phase for the
/// same reason the options page's is.
public struct Configuration: Sendable, Equatable {
    public var apiKey: String?
    public var captureRoleId: String?
    public var roles: [RoleSummary]
    public var defaultStatus: DefaultStatus

    public init(
        apiKey: String? = nil,
        captureRoleId: String? = nil,
        roles: [RoleSummary] = [],
        defaultStatus: DefaultStatus = .current
    ) {
        self.apiKey = apiKey
        self.captureRoleId = captureRoleId
        self.roles = roles
        self.defaultStatus = defaultStatus
    }

    public enum Gap: String, Sendable, Equatable {
        case apiKey
        case captureRole
    }

    /// A key present but blank counts as absent — an empty string would sail
    /// past and fail later as an opaque 401.
    public var gaps: [Gap] {
        var missing: [Gap] = []
        if (apiKey ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append(.apiKey) }
        if (captureRoleId ?? "").isEmpty { missing.append(.captureRole) }
        return missing
    }

    public var isConfigured: Bool { gaps.isEmpty }
}

/// Reading the configuration, without saying where it is read from.
///
/// The narrowest thing the capture path actually needs. `ConfigurationStore`
/// is the only implementation that ships; the protocol exists so the phase
/// machine can be driven without a Keychain, which is one of exactly two
/// things on that path that leave the process. See
/// `ShareCapturePhaseTests.swift` for why that boundary is drawn there and
/// nowhere further in.
public protocol ConfigurationReading: Sendable {
    func load() -> Configuration
}

/// Reads and writes the configuration shared by the app, the Safari extension
/// handler and the Share Extension.
///
/// Two stores, on purpose. The role id, the cached role list and the default
/// status are ordinary preferences and live in the App Group's `UserDefaults`,
/// where every process that can mount the container reads the same values. The
/// API key does not: it goes to the Keychain, which is the only part of this
/// that is a credential.
///
/// This is *not* the same store the web extension uses. Safari gives an
/// extension its own `chrome.storage.local` inside its sandbox, unreachable from
/// the app. `ConfigurationBridge` is what keeps the two in step; see its notes
/// for why the sync is one-way at configuration time rather than a read-through
/// on the capture path.
/// `@unchecked Sendable` because `UserDefaults` is documented as thread-safe
/// but is not annotated as `Sendable`. The two stored properties are otherwise
/// immutable value types, so the only unchecked part is that annotation gap.
public struct ConfigurationStore: ConfigurationReading, @unchecked Sendable {

    public static let defaultAppGroup = "group.com.integralproductivity.GlassFrogClipper"

    private enum Key {
        static let captureRoleId = "glassfrog.captureRoleId"
        static let roles = "glassfrog.roles"
        static let defaultStatus = "glassfrog.defaultStatus"
        static let apiKeyAccount = "glassfrog.apiKey"
    }

    private let defaults: UserDefaults
    private let keychain: Keychain

    /// Falls back to `.standard` when the App Group is unavailable — an
    /// unsigned build, or one whose entitlement has not been added yet. The app
    /// then still works standalone; only sharing with the extensions is lost,
    /// which is visible in the app rather than silent.
    public init(appGroup: String = defaultAppGroup, keychain: Keychain = Keychain()) {
        self.defaults = UserDefaults(suiteName: appGroup) ?? .standard
        self.keychain = keychain
    }

    public var hasSharedContainer: Bool {
        defaults != .standard
    }

    public func load() -> Configuration {
        Configuration(
            apiKey: keychain.read(Key.apiKeyAccount),
            captureRoleId: defaults.string(forKey: Key.captureRoleId),
            roles: decodeRoles(),
            defaultStatus: DefaultStatus(rawValue: defaults.string(forKey: Key.defaultStatus) ?? "") ?? .current
        )
    }

    public func save(_ configuration: Configuration) throws {
        if let apiKey = configuration.apiKey, !apiKey.isEmpty {
            try keychain.write(apiKey, account: Key.apiKeyAccount)
        }
        defaults.set(configuration.captureRoleId, forKey: Key.captureRoleId)
        defaults.set(configuration.defaultStatus.rawValue, forKey: Key.defaultStatus)
        if let encoded = try? JSONEncoder().encode(configuration.roles) {
            defaults.set(encoded, forKey: Key.roles)
        }
    }

    public func clearApiKey() {
        keychain.delete(Key.apiKeyAccount)
    }

    private func decodeRoles() -> [RoleSummary] {
        guard let data = defaults.data(forKey: Key.roles) else { return [] }
        return (try? JSONDecoder().decode([RoleSummary].self, from: data)) ?? []
    }
}
