import Foundation

/// The API key's home on Apple platforms.
///
/// ADR 0002 decided the key is held locally rather than brokered, because
/// GlassFrog v5 has no OAuth and there is no upstream token exchange to lean on.
/// That decision carries over unchanged; what changes is *where* local means.
/// The Chrome extension has only `chrome.storage.local`. Here there is a
/// Keychain, and a credential belongs in it rather than in `UserDefaults`
/// alongside the role id — a shared App Group container is readable by anything
/// that can mount it, and a plist is not a place to keep a long-lived key.
public struct Keychain: Sendable {

    public enum KeychainError: Error, Equatable {
        case unexpectedStatus(OSStatus)
    }

    private let service: String
    /// Set when the app and its extensions share a keychain access group.
    ///
    /// Nil is a working configuration, not a broken one: the item is then
    /// private to whichever process wrote it, which is correct for a build with
    /// no team identifier yet. The Share Extension needs the group to read a key
    /// the app saved, so `apple/README.md` names it as a signing prerequisite
    /// rather than leaving it to be discovered at runtime.
    private let accessGroup: String?

    public init(service: String = "com.integralproductivity.GlassFrogClipper", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    public func read(_ account: String) -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func write(_ value: String, account: String) throws {
        let query = baseQuery(account)
        let data = Data(value.utf8)

        // Update-then-add rather than delete-then-add: a delete that succeeds
        // followed by an add that fails would leave the practitioner logged out
        // by a save that was only meant to change the key.
        let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw KeychainError.unexpectedStatus(updated) }

        var insert = query
        insert[kSecValueData as String] = data
        // The Share Extension runs while the device may still be locked after a
        // reboot. `AfterFirstUnlock` is the weakest accessibility that still
        // lets a share-sheet capture file in that window; `WhenUnlocked` would
        // make it fail in a way the practitioner cannot act on.
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let added = SecItemAdd(insert as CFDictionary, nil)
        guard added == errSecSuccess else { throw KeychainError.unexpectedStatus(added) }
    }

    public func delete(_ account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }
}
