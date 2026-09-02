//
//  ShareCaptureModel.swift
//  Shared (Share)
//
//  What the share sheet's capture form is doing, separated from how it looks.
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
    private let store: ConfigurationStore
    private let filer: CaptureFiler

    public init(store: ConfigurationStore = ConfigurationStore(), filer: CaptureFiler = CaptureFiler()) {
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
