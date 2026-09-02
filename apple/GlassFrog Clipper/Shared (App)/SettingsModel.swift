//
//  SettingsModel.swift
//  Shared (App)
//
//  The configuration decision, separated from the view that renders it — the
//  same split `src/config.ts` makes for the same reason. Validating a key
//  touches the network; deciding what to tell the practitioner afterwards does
//  not, and R21's three failure paths should be reasonable about without one.
//

import Foundation
import Observation

@MainActor
@Observable
final class SettingsModel {

    /// R21 restated: an attempt that cannot complete says so plainly rather
    /// than leaving the practitioner on an empty form.
    enum Status: Equatable {
        case idle
        case checking
        case needsRole
        case saved(sharedWithExtensions: Bool)
        case failed(String)
    }

    var apiKey: String = ""
    var selectedRoleId: String = ""
    var defaultStatus: DefaultStatus = .current
    var roles: [RoleSummary] = []
    var status: Status = .idle
    var notificationsAuthorized = false
    /// False on a build with no App Group entitlement. Surfaced rather than
    /// swallowed: the app still works standalone, but the Share Extension
    /// cannot read anything saved here, and that is worth saying out loud.
    var sharesWithExtensions = true

    private let store: ConfigurationStore
    private let notifier: Notifier

    init(store: ConfigurationStore = ConfigurationStore(), notifier: Notifier = Notifier()) {
        self.store = store
        self.notifier = notifier
    }

    func load() async {
        let configuration = store.load()
        apiKey = configuration.apiKey ?? ""
        selectedRoleId = configuration.captureRoleId ?? ""
        defaultStatus = configuration.defaultStatus
        roles = configuration.roles
        sharesWithExtensions = store.hasSharedContainer
        notificationsAuthorized = await notifier.isAuthorized()
    }

    /// Asked here rather than from the extension handler.
    ///
    /// A permission prompt that appears because a background capture failed is
    /// the second surprise in a row, and the practitioner has no way to connect
    /// it to anything they did.
    func requestNotifications() async {
        notificationsAuthorized = await notifier.requestAuthorization()
    }

    /// Validates the key and populates the picker in one call (KTD8), then
    /// saves — two-phase, because a valid key with no role chosen yet is a real
    /// state and nothing should file from it.
    func save() async {
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            status = .failed("Enter your GlassFrog API key to continue.")
            return
        }

        status = .checking

        let fetched: [RoleSummary]
        do {
            fetched = try await GlassFrogClient(apiKey: key).fetchRoles()
        } catch let failure as CaptureFailure {
            // Deliberately not `failure.message`: the classifier writes for the
            // capture path ("your capture is saved"), and there is no capture
            // here. Interpolating it produces a doubled, false sentence.
            status = .failed(
                failure.reconfigure
                    ? "That key wasn't accepted by GlassFrog. Check it and try again."
                    : "Could not reach GlassFrog just now. Check your connection and try again."
            )
            return
        } catch {
            status = .failed("Could not reach GlassFrog just now. Check your connection and try again.")
            return
        }

        guard !fetched.isEmpty else {
            // Describes what was observed rather than asserting a fact about
            // the practitioner's org. Telling someone to go ask their Lead Link
            // for a role they already hold sends them somewhere useless.
            status = .failed(
                "That key works, but GlassFrog returned no roles to file against. "
                + "If you do fill roles, the key may belong to a different account."
            )
            return
        }

        roles = fetched
        if selectedRoleId.isEmpty || !fetched.contains(where: { $0.id == selectedRoleId }) {
            status = .needsRole
            return
        }

        do {
            try store.save(
                Configuration(
                    apiKey: key,
                    captureRoleId: selectedRoleId,
                    roles: fetched,
                    defaultStatus: defaultStatus
                )
            )
            status = .saved(sharedWithExtensions: store.hasSharedContainer)
        } catch {
            // Almost always the Keychain: an unsigned build, or a missing
            // access group. Saying which is more use than "save failed".
            status = .failed("Could not save the API key to the Keychain. Check the app's signing and try again.")
        }
    }
}
