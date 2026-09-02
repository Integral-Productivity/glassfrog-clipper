//
//  SettingsView.swift
//  Shared (App)
//
//  The app's whole reason to exist.
//
//  STRATEGY.md forbids grooming, browsing and meeting-processing UI in the
//  extension — "later happens in GlassFrog" — and that boundary applies here
//  just as hard. This app configures capture and reports whether capture can
//  work. It shows no captured items and offers nothing to do with them, because
//  the moment it does it has started replacing GlassFrog rather than capturing
//  into it.
//

import SwiftUI

#if os(macOS)
import SafariServices
#endif

struct SettingsView: View {
    @State private var model = SettingsModel()

    var body: some View {
        Form {
            keySection
            roleSection
            deliverySection
            safariSection
        }
        .formStyle(.grouped)
        .frame(minWidth: 420, minHeight: 520)
        .task { await model.load() }
    }

    private var keySection: some View {
        Section {
            // SecureField, not TextField: this is a long-lived credential, and
            // the settings screen is exactly where someone screen-shares.
            SecureField("GlassFrog API key", text: $model.apiKey)
                .textContentType(.password)
#if os(iOS)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
#endif

            Button("Check key and save") {
                Task { await model.save() }
            }
            .disabled(model.status == .checking)

            statusLine
        } header: {
            Text("GlassFrog")
        } footer: {
            // ADR 0002: v5 has no OAuth, so there is a key to fetch by hand and
            // the practitioner needs to know where from.
            Text("GlassFrog v5 has no sign-in for apps. Create a key in GlassFrog under your profile, then paste it here.")
        }
    }

    @ViewBuilder
    private var statusLine: some View {
        switch model.status {
        case .idle:
            EmptyView()
        case .checking:
            Label("Checking that key with GlassFrog…", systemImage: "clock")
                .foregroundStyle(.secondary)
        case .needsRole:
            Label("Key accepted. Choose the role your captures should file against, then save again.",
                  systemImage: "person.crop.circle.badge.questionmark")
        case let .saved(shared):
            Label(
                shared ? "Saved. The share sheet and Safari can both file now."
                       : "Saved to this app only — the share sheet cannot read it.",
                systemImage: shared ? "checkmark.circle" : "exclamationmark.triangle"
            )
            .foregroundStyle(shared ? .green : .orange)
        case let .failed(message):
            Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
        }
    }

    private var roleSection: some View {
        Section {
            if model.roles.isEmpty {
                Text("Save a key to load the roles you can file against.")
                    .foregroundStyle(.secondary)
            } else {
                Picker("Capture role", selection: $model.selectedRoleId) {
                    // A capture that names no role still has to reach the API,
                    // and role_id is a path parameter (ADR 0003). This is what
                    // makes the zero-decision path possible at all.
                    Text("Choose a role…").tag("")
                    ForEach(model.roles) { role in
                        Text(role.name).tag(role.id)
                    }
                }
            }

            Picker("File actions and projects as", selection: $model.defaultStatus) {
                Text("Current").tag(DefaultStatus.current)
                Text("Someday").tag(DefaultStatus.someday)
            }
        } header: {
            Text("Capture")
        } footer: {
            // KD3: the status vocabularies do not overlap, so "capture now,
            // classify later" has a native home for tensions and not for the
            // other two. Which holding state fits is the practitioner's call.
            Text("Tensions file unprocessed, which GlassFrog derives on its own. Actions and projects have no equivalent, so they take the status you choose here.")
        }
    }

    private var deliverySection: some View {
        Section {
            if model.notificationsAuthorized {
                Label("Notifications allowed", systemImage: "checkmark.circle").foregroundStyle(.green)
            } else {
                Button("Allow notifications") {
                    Task { await model.requestNotifications() }
                }
            }
        } header: {
            Text("Telling you when something fails")
        } footer: {
            // The honest version. Safari implements no notifications API, so
            // this app is the only thing that can raise one — and without it a
            // failed background capture is discoverable only by opening the
            // extension.
            Text("Safari extensions cannot raise notifications themselves, so this app raises them instead. Without this, a capture that fails in the background is only visible next time you open the clipper.")
        }
    }

    @ViewBuilder
    private var safariSection: some View {
#if os(macOS)
        Section("Safari") {
            Button("Open Safari extension settings") {
                SFSafariApplication.showPreferencesForExtension(
                    withIdentifier: "com.integralproductivity.GlassFrogClipper.Extension"
                )
            }
        }
#else
        Section {
            Text("Enable GlassFrog Clipper in Settings → Apps → Safari → Extensions.")
                .foregroundStyle(.secondary)
        } header: {
            Text("Safari")
        } footer: {
            // iOS has no equivalent of showPreferencesForExtension, so the
            // route has to be described rather than offered.
            Text("Share to GlassFrog Clipper from any app's share sheet without enabling the Safari extension.")
        }
#endif
    }
}

#Preview {
    SettingsView()
}
