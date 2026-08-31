//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  The bridge between the Safari web extension and its containing app.
//
//  Safari implements no `chrome.notifications`, and gives the extension a
//  `chrome.storage.local` the app cannot read. This handler closes both gaps:
//  it raises the notices the extension cannot raise itself, and it keeps the
//  configuration the Share Extension needs in step with the one the
//  practitioner entered in the extension's options page.
//
//  See `src/notify.ts` for the delivery chain this is the second link in, and
//  `NativeMessage.swift` for why the configuration sync is one-way at
//  configuration time rather than a read-through on the capture path.
//

import SafariServices
import os.log

private let log = Logger(subsystem: "com.integralproductivity.GlassFrogClipper", category: "bridge")

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let raw = request?.userInfo?[SFExtensionMessageKey]

        guard let parsed = NativeMessage.parse(raw) else {
            // An unrecognised shape is ignored rather than treated as an error.
            // Deliberately not logging the payload: a `configure` message we
            // failed to parse still carries the API key, and R12 forbids it
            // reaching a log.
            log.debug("ignored an unrecognised native message")
            complete(context, with: NativeMessage.reply(delivered: false))
            return
        }

        switch parsed {
        case let .notice(notice):
            // Detached because `beginRequest` is synchronous and the extension
            // context must not be completed before the notification is actually
            // scheduled — the extension is waiting on `delivered` to decide
            // whether to fall through to storage.
            Task {
                let delivered = await Notifier().deliver(title: notice.title, body: notice.body, id: notice.id)
                complete(context, with: NativeMessage.reply(delivered: delivered))
            }

        case let .configure(configuration):
            // The practitioner saved configuration in the extension's options
            // page. Mirroring it here is what lets a share-sheet capture file
            // without configuring the same thing twice.
            var delivered = true
            do {
                try ConfigurationStore().save(configuration)
            } catch {
                // Almost certainly the Keychain: an unsigned build, or a missing
                // access group. Reported rather than swallowed, so the extension
                // can tell the practitioner the app did not take it.
                log.error("could not persist configuration from the extension: \(error.localizedDescription, privacy: .public)")
                delivered = false
            }
            complete(context, with: NativeMessage.reply(delivered: delivered))

        case .requestConfiguration:
            // The other direction: configuration entered in the app flows back
            // to an extension that has none. Asked once, when the extension
            // finds itself unconfigured — never on the capture path.
            let configuration = ConfigurationStore().load()
            complete(
                context,
                with: NativeMessage.reply(delivered: configuration.isConfigured, configuration: configuration)
            )
        }
    }

    private func complete(_ context: NSExtensionContext, with payload: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
