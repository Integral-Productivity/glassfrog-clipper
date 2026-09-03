//
//  ShareCaptureView.swift
//  Shared (Share)
//
//  The share sheet's capture form.
//
//  STRATEGY.md calls the structured path "the same capture with more revealed",
//  and that is what this is — the popup's fields, in a sheet. What it must not
//  become is a second product: no history, no queue, no browsing. The share
//  sheet is a capture surface and nothing else.
//

import SwiftUI

public struct ShareCaptureView: View {
    // Constructed here rather than injected. A default argument is evaluated in
    // the *caller's* isolation, so a main-actor-isolated model passed that way
    // will not compile under strict concurrency however the initialiser is
    // annotated. The model itself is unit-tested directly; this view is the
    // hosting shim around it.
    @State private var model = ShareCaptureModel()
    private let items: [NSExtensionItem]
    private let onFinish: () -> Void
    private let onCancel: () -> Void

    public init(
        items: [NSExtensionItem],
        onFinish: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.items = items
        self.onFinish = onFinish
        self.onCancel = onCancel
    }

    public var body: some View {
        content
            .frame(minWidth: 340, minHeight: 300)
            .task { await model.load(items: items) }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VStack(spacing: 16) {
                ProgressView("Reading what you shared…")
                // A source app's load handler can simply never call back. The
                // read is bounded (`SharedItem.loadDeadline`), but a spinner
                // with no way out is still the wrong thing to hand someone who
                // is standing in another app mid-task.
                Button("Cancel", action: onCancel)
            }
            .padding()

        case .notConfigured:
            // R21: say what to do next. A share sheet that reports only
            // "not configured" leaves the practitioner nowhere to go, and they
            // are standing in another app.
            message(
                title: "GlassFrog Clipper isn't set up yet",
                body: "Open GlassFrog Clipper and add your API key and capture role, then share this again.",
                systemImage: "gear"
            )

        case .nothingToCapture:
            message(
                title: "Nothing to capture here",
                body: "This share didn't include a link or any text.",
                systemImage: "questionmark.circle"
            )

        case .ready, .filing:
            form

        case .filed:
            message(title: "Filed to GlassFrog", body: model.pageTitle, systemImage: "checkmark.circle")
                .task {
                    // Long enough to read, short enough not to be in the way.
                    // The practitioner is mid-task in another app; the whole
                    // point is handing them back to it.
                    try? await Task.sleep(for: .milliseconds(700))
                    onFinish()
                }

        case let .failed(message, reconfigure):
            VStack(spacing: 16) {
                self.message(
                    title: reconfigure ? "Capture needs attention" : "Capture not filed",
                    body: message,
                    systemImage: "exclamationmark.triangle"
                )
                // No retry button on the reconfigure path. Retrying a rejected
                // key or an unusable role cannot succeed, and offering it
                // invites the practitioner to spend time proving that.
                if !reconfigure {
                    Button("Try again") { Task { await model.file() } }
                        .buttonStyle(.borderedProminent)
                }
                Button("Close", action: onCancel)
            }
            .padding()
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
                Text("Clip to GlassFrog").font(.headline)
                Spacer()
                Button("File") { Task { await model.file() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.phase == .filing)
            }
            .padding()

            Divider()

            Form {
                Section {
                    // Text, never rendered markup: the title comes from a page
                    // the practitioner was reading and is not ours to trust (R7).
                    Text(model.pageTitle).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                }

                Section("Your note") {
                    TextField("What did you notice?", text: $model.note, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Picker("File as", selection: $model.workType) {
                        Text("Tension").tag(WorkType.tension)
                        Text("Action").tag(WorkType.action)
                        Text("Project").tag(WorkType.project)
                    }

                    if !model.roles.isEmpty {
                        Picker("Role", selection: $model.roleId) {
                            ForEach(model.roles) { role in
                                Text(role.name).tag(role.id)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)

            if model.phase == .filing {
                ProgressView().padding()
            }
        }
    }

    private func message(title: String, body: String, systemImage: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(body)
        }
    }
}
