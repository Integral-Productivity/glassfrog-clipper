//
//  ViewController.swift
//  Shared (App)
//
//  Hosts `SettingsView` inside the storyboard scene the Safari extension
//  converter generated.
//
//  The converter's own view controller loaded a bundled HTML page that says
//  whether the extension is enabled. That is a page about the extension, and
//  what this app actually needs is a place to configure capture — for the Share
//  Extension especially, which has no options page of its own and cannot read
//  the one in Safari.
//
//  The storyboard scene is kept rather than replaced because replacing it means
//  editing target membership and Info.plist scene wiring in the pbxproj by
//  hand, which is state nobody reviews. Hosting is a two-line change with the
//  same result.
//

import SwiftUI
import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
typealias PlatformViewController = NSViewController
#endif

class ViewController: PlatformViewController {

    /// Kept solely so the storyboard's outlet connection still resolves.
    ///
    /// Removing the property without also editing the scene makes the nib
    /// loader throw `setValue:forUndefinedKey:` at launch — a crash on first
    /// run, from a change that looks like tidying up. The view is removed from
    /// the hierarchy below instead.
    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.removeFromSuperview()
        webView = nil
        embedSettings()
    }

    private func embedSettings() {
#if os(iOS)
        let hosting = UIHostingController(rootView: SettingsView())
        addChild(hosting)
        hosting.view.frame = view.bounds
        hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)
#elseif os(macOS)
        let hosting = NSHostingView(rootView: SettingsView())
        hosting.frame = view.bounds
        hosting.autoresizingMask = [.width, .height]
        view.addSubview(hosting)
#endif
    }
}
