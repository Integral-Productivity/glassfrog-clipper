//
//  ShareCaptureModel.swift
//  GlassFrogClipperCore
//
//  What the share sheet's capture form is doing, separated from how it looks.
//
//  It lives in the core package rather than in `Shared (Share)/` so that
//  `swift test` can reach it at all. `ShareCaptureView` does not follow it:
//  the view imports SwiftUI, and `Package.swift` states the invariant that
//  nothing here imports UIKit, AppKit or SafariServices. This file needs
//  Foundation and Observation, and `NSExtensionItem` is Foundation's — the
//  share sheet that produced one is not required to read it, which is exactly
//  why the model can be specified under `swift test` and the view cannot.
//
//  See ShareCapturePhaseTests.swift, which states the phase machine below and
//  carries the boundary note about what a green run there does and does not
//  prove. Reachable is not the same as enforced, and the line falls where
//  SharedItem.swift's header says it does: passing is convention, because the
//  `Swift core` job is path-filtered and is not required (`verify` is the only
//  one, ADR 0012). The presence guard in `test/surface-layer.test.ts` covers
//  the *surface* layer, not this file, so nothing mechanical notices if this
//  specification is deleted — #169 is open on whether it should.
//
//  Moving the file here also put it under the package's Swift 6
//  strict-concurrency checking, which the Xcode targets do not apply — they
//  build at SWIFT_VERSION 5.0. That turned up one defect live since #66:
//  `load` handed the main-actor-isolated `[NSExtensionItem]` to a nonisolated
//  reader, so `SharedItem.pageContext` walked objects the main actor still
//  held. `pageContext` and `SharedItem.load` are `@MainActor` now; the share's
//  items arrive from the OS on the main thread and are read there.
//

import Foundation
import Observation

@MainActor
@Observable
public final class ShareCaptureModel {

    public enum Phase: Equatable {
        case loading
        case ready
        case filing
        case filed
        /// `reconfigure` decides whether the practitioner is told to retry or to
        /// go and fix something — R18's distinction, which "it failed" cannot
        /// carry and which matters more here than anywhere: the share sheet
        /// makes retrying almost free, and retrying a rejected key is time they
        /// will not get back.
        case failed(message: String, reconfigure: Bool)
        case notConfigured
        case nothingToCapture
    }

    public var phase: Phase = .loading
    public var note: String = ""
    public var workType: WorkType = .tension
    public var roleId: String = ""
    public var roles: [RoleSummary] = []
    public private(set) var pageTitle: String = ""

    private var page: PageContext?
    private let store: any ConfigurationReading
    private let filer: any CaptureFiling

    /// Both dependencies are protocols rather than the concrete types, for one
    /// reason: `ConfigurationStore` reads the Keychain and `CaptureFiler` files
    /// through `URLSession`, and those two are the whole of what this path does
    /// outside the process. Naming them as protocols is what lets
    /// `ShareCapturePhaseTests` run every state below offline without the
    /// composition between them being faked as well.
    public init(store: any ConfigurationReading = ConfigurationStore(), filer: any CaptureFiling = CaptureFiler()) {
        self.store = store
        self.filer = filer
    }

    public func load(items: [NSExtensionItem]) async {
        let configuration = store.load()
        roles = configuration.roles
        // R5: a configured role only ever fills a gap. Nothing here can
        // overwrite a role the practitioner picks afterwards.
        roleId = configuration.captureRoleId ?? ""

        guard configuration.isConfigured else {
            phase = .notConfigured
            return
        }

        guard let context = await SharedItem.pageContext(from: items) else {
            // Better than filing a tension carrying nothing: an item with no
            // evidence is worse than none, because it survives into triage and
            // has to be read before it can be discarded.
            phase = .nothingToCapture
            return
        }

        page = context
        pageTitle = context.title.isEmpty ? context.url : context.title
        phase = .ready
    }

    public func file() async {
        guard let page else { return }
        phase = .filing

        let capture = Capture(
            page: page,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note,
            // An unset work type is a tension (R4 / KD2), so `.tension` is sent
            // as nil rather than as a choice — the composed output is the same
            // either way, and this keeps one meaning for "the practitioner did
            // not decide".
            workType: workType == .tension ? nil : workType,
            roleId: roleId.isEmpty ? nil : roleId
        )

        do {
            _ = try await filer.file(capture)
            phase = .filed
        } catch let failure as CaptureFailure {
            phase = .failed(message: failure.message, reconfigure: failure.reconfigure)
        } catch CaptureFiler.FilingError.notConfigured {
            phase = .notConfigured
        } catch {
            phase = .failed(message: "Filing failed: \(error.localizedDescription)", reconfigure: false)
        }
    }
}
