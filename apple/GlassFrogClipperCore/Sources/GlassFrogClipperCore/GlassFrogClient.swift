import Foundation

/// The GlassFrog v5 write path, for the targets that cannot use the TypeScript SDK.
///
/// The Chrome and Safari extensions go through `@integral-productivity/glassfrog`
/// (ADR 0002, composition over invention). The Share Extension cannot: it is a
/// Swift process with no JavaScript runtime, and it is on the capture path, where
/// standing up one to reuse a client would be latency the strategy explicitly
/// refuses to spend.
///
/// What is re-derived here is deliberately the smallest possible surface — three
/// role-scoped creates and nothing else. No pagination, no read path, no error
/// taxonomy of its own. ADR 0003 is the reason all three are role-scoped:
///
///     POST /roles/{role_id}/tensions
///     POST /roles/{role_id}/actions
///     POST /roles/{role_id}/projects
///
/// `role_id` is a path parameter, not an optional body field. Filing with no
/// text is fine; filing with no role is impossible.
public struct GlassFrogClient: Sendable {

    public static let defaultBaseURL = URL(string: "https://api.glassfrog.com/api/v5")!

    private let apiKey: String
    private let baseURL: URL
    private let session: URLSession

    /// `baseURL` is injectable for the same reason it is in the TypeScript
    /// adapter: it is the only way to verify what actually goes on the wire —
    /// the request path, the header name, the absence of `label`.
    public init(apiKey: String, baseURL: URL = defaultBaseURL, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.session = session
    }

    public struct CreatedItem: Sendable, Equatable {
        public let id: String?
    }

    /// Files one composed capture against one role.
    ///
    /// There is exactly one request per capture. KTD7's at-most-once turns on
    /// that: v5 has no idempotency key, so a second call — to PATCH a label, or
    /// to retry — is a window in which a worker death duplicates a tension or
    /// loses the provenance marker.
    public func file(_ composed: Composed, roleId: String, status: DefaultStatus) async throws -> CreatedItem {
        switch composed {
        case let .tension(body):
            // No `status` and no `label`. v5 derives unprocessed/processed from
            // associations and rejects `label` on create — both verified against
            // the live API. See ADR 0004.
            return try await post(path: "roles/\(roleId)/tensions", body: ["tension": ["body": body]])
        case let .action(description, note):
            return try await post(
                path: "roles/\(roleId)/actions",
                body: ["action_item": ["description": description, "note": note, "status": status.rawValue]]
            )
        case let .project(description, note, link):
            var project: [String: Any] = [
                "description": description, "note": note, "status": status.rawValue,
            ]
            // Omitted rather than sent empty — GlassFrog renders `link` as the
            // project's canonical source, and a blank one reads as broken.
            if let link { project["link"] = link }
            return try await post(path: "roles/\(roleId)/projects", body: ["project": project])
        }
    }

    /// Proves the key and supplies the role picker in one place (KTD8).
    ///
    /// Role ids are opaque 32-hex values a practitioner cannot obtain from the
    /// GlassFrog UI, so without this there is no picker and no way to configure
    /// a capture role at all.
    ///
    /// Two reads, because one is not reliable — the same lesson the TypeScript
    /// adapter learned against the live API. `GET /me?include=roles` is the
    /// single call the design calls for, but an empty embed cannot be trusted to
    /// mean "this account fills no roles"; it may only mean we did not read any.
    /// `GET /me/roles` is the authority when that happens.
    public func fetchRoles() async throws -> [RoleSummary] {
        let embedded = Self.roleSummaries(in: try await get(path: "me", query: [URLQueryItem(name: "include", value: "roles")]))
        if !embedded.isEmpty { return embedded }
        return Self.roleSummaries(in: try await get(path: "me/roles", query: [URLQueryItem(name: "per_page", value: "100")]))
    }

    /// Accepts the enveloped and bare shapes, and both a top-level `roles` array
    /// and a bare array — the API envelopes single resources, and a list
    /// endpoint returns its own shape.
    static func roleSummaries(in data: Data) -> [RoleSummary] {
        guard let root = try? JSONSerialization.jsonObject(with: data) else { return [] }

        var candidates: [[String: Any]] = []
        if let array = root as? [[String: Any]] {
            candidates = array
        } else if let object = root as? [String: Any] {
            let body = object["data"] as? [String: Any] ?? object
            if let roles = body["roles"] as? [[String: Any]] {
                candidates = roles
            } else if let array = object["data"] as? [[String: Any]] {
                candidates = array
            }
        }

        return candidates.compactMap { role in
            guard let id = role["id"] as? String else { return nil }
            // A role's name is nullable in the v5 schema. An unnamed role would
            // otherwise render as a blank option indistinguishable from another,
            // and there is nothing else to go on — the id is opaque hex.
            let name = (role["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let display = (name?.isEmpty ?? true)
                ? "Untitled role (\(id.replacingOccurrences(of: "role_", with: "").prefix(8)))"
                : name!
            return RoleSummary(id: id, name: display)
        }
    }

    private func get(path: String, query: [URLQueryItem]) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.setValue(apiKey, forHTTPHeaderField: "X-Auth-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw FailureClassifier.classify(transport: error, apiKey: apiKey)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw FailureClassifier.classify(
                status: (response as? HTTPURLResponse)?.statusCode ?? 0,
                detail: String(data: data, encoding: .utf8) ?? "",
                apiKey: apiKey
            )
        }
        return data
    }

    private func post(path: String, body: [String: Any]) async throws -> CreatedItem {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        // v5 has no OAuth; the key travels as X-Auth-Token (ADR 0002).
        request.setValue(apiKey, forHTTPHeaderField: "X-Auth-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        // A share-sheet capture that hangs is worse than one that fails: the
        // practitioner is standing in another app waiting to get back to what
        // they were doing.
        request.timeoutInterval = 15

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw FailureClassifier.classify(transport: error, apiKey: apiKey)
        }

        guard let http = response as? HTTPURLResponse else {
            throw FailureClassifier.classify(status: 0, apiKey: apiKey)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw FailureClassifier.classify(
                status: http.statusCode,
                detail: String(data: data, encoding: .utf8) ?? "",
                apiKey: apiKey
            )
        }

        return CreatedItem(id: Self.identifier(in: data))
    }

    /// v5 envelopes single resources in `data`. Both shapes are accepted, so
    /// this keeps working across the envelope change the SDK's own ADR notes.
    static func identifier(in data: Data) -> String? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let body = root["data"] as? [String: Any] ?? root
        if let id = body["id"] as? String { return id }
        for value in body.values {
            if let nested = value as? [String: Any], let id = nested["id"] as? String { return id }
        }
        return nil
    }
}
