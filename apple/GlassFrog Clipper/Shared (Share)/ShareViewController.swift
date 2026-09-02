//
//  ShareViewController.swift
//  Shared (Share)
//
//  The share-sheet entry point, on both platforms.
//
//  STRATEGY.md sequenced a "mobile share-sheet companion" under the Capture
//  surface track. This is it — and on iPhone and iPad it is the *primary*
//  capture path, not a secondary one: there is no keyboard shortcut to press,
//  and Safari is only one of the apps a practitioner senses something in.
//

import SwiftUI

#if os(iOS)
import UIKit
typealias ShareHostController = UIViewController
#elseif os(macOS)
import Cocoa
typealias ShareHostController = NSViewController
#endif

class ShareViewController: ShareHostController {

    override func viewDidLoad() {
        super.viewDidLoad()

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let root = ShareCaptureView(
            items: items,
            onFinish: { [weak self] in self?.finish() },
            onCancel: { [weak self] in self?.cancel() }
        )

#if os(iOS)
        let hosting = UIHostingController(rootView: root)
        addChild(hosting)
        hosting.view.frame = view.bounds
        hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)
#elseif os(macOS)
        let hosting = NSHostingView(rootView: root)
        hosting.frame = view.bounds
        hosting.autoresizingMask = [.width, .height]
        view.addSubview(hosting)
        preferredContentSize = NSSize(width: 420, height: 460)
#endif
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    /// Cancelling reports `userCancelledError`, which is what the host app
    /// expects. Completing normally would tell it the share succeeded.
    private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
}
