import Foundation

/// The three shapes GlassFrog can receive.
///
/// A direct port of `src/types.ts`. Deliberately closed for the same reason it
/// is closed there — STRATEGY.md's Holacracy-native boundary means there is
/// never a fourth.
public enum WorkType: String, Codable, Sendable, CaseIterable {
    case tension
    case action
    case project
}

/// What the platform can tell us for free, before the practitioner decides
/// anything.
///
/// On Safari this arrives from the web extension. In the Share Extension it is
/// assembled from the `NSExtensionItem` the share sheet hands over, which is why
/// `selection` is optional here exactly as it is in TypeScript: a share from
/// Reader mode carries no selection, and that is an ordinary capture rather than
/// a degraded one.
public struct PageContext: Codable, Sendable, Equatable {
    public var url: String
    public var title: String
    public var selection: String?
    public var capturedAt: String

    public init(url: String, title: String, selection: String? = nil, capturedAt: String) {
        self.url = url
        self.title = title
        self.selection = selection
        self.capturedAt = capturedAt
    }
}

/// A capture in flight.
///
/// `workType` and `roleId` are optional by design — that optionality *is* the
/// strategy ("never block, never discard"). A capture with both unset is valid
/// and must still file.
public struct Capture: Codable, Sendable, Equatable {
    public var page: PageContext
    public var note: String?
    public var workType: WorkType?
    public var roleId: String?

    public init(page: PageContext, note: String? = nil, workType: WorkType? = nil, roleId: String? = nil) {
        self.page = page
        self.note = note
        self.workType = workType
        self.roleId = roleId
    }
}

/// KD3 restricts the configurable default for actions and projects to these two.
///
/// Tensions take no status at all: v5 derives unprocessed/processed from
/// associations and accepts only `archived` from a client.
public enum DefaultStatus: String, Codable, Sendable, CaseIterable {
    case current
    case someday
}

/// The subset of a GlassFrog role the app keeps, so the Share Extension can
/// offer a picker without a network round trip on the capture path.
public struct RoleSummary: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}
