// swift-tools-version: 6.0
import PackageDescription

/// The capture logic the Apple targets share.
///
/// A local package rather than a folder of files added to five Xcode targets,
/// for two reasons. The first is mechanical: the container app, the Safari
/// extension handler and the Share Extension all need this code on both iOS and
/// macOS, and target membership managed by hand in a pbxproj is exactly the kind
/// of state nobody reviews. The second matters more — `swift test` runs this
/// without Xcode, which is what lets the cross-language compose contract be a
/// CI gate rather than something someone remembers to check.
///
/// No UIKit, AppKit or SafariServices, so the same code serves an app, an app
/// extension and a test process unchanged. That is the invariant; it is not a
/// claim that Foundation is the only import, because it is not — `Notifier`
/// needs UserNotifications and `SharedItem` needs UniformTypeIdentifiers.
/// `SharedItem` reads `NSExtensionItem`s and so needs the type identifiers, but
/// not the share sheet that produced them — which is exactly why it can be
/// specified under `swift test`.
///
/// The compose golden file is deliberately *not* declared as a package resource.
/// It lives with the TypeScript suite that generates it, and the test reads it
/// from there via `#filePath` — a bundled copy would be a second copy, which is
/// the exact drift the contract exists to prevent.
let package = Package(
    name: "GlassFrogClipperCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "GlassFrogClipperCore", targets: ["GlassFrogClipperCore"])
    ],
    targets: [
        .target(name: "GlassFrogClipperCore"),
        .testTarget(name: "GlassFrogClipperCoreTests", dependencies: ["GlassFrogClipperCore"])
    ]
)
