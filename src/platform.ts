/**
 * What the surrounding browser can actually do.
 *
 * Chrome and Safari both expose the `chrome.*` web-extension namespace, and
 * almost every line of this extension runs unchanged on both. The differences
 * that matter are not API *shape* differences — they are capability *gaps*:
 *
 *   - Safari implements no `chrome.notifications` at all. KTD2 routes every
 *     failure and lifecycle notice through it, so on Safari that surface is
 *     simply absent rather than different.
 *   - Safari on iOS and iPadOS has no keyboard-shortcut concept for
 *     extensions, so `chrome.commands` reports nothing and R22's unbound-
 *     shortcut check would fire on every single startup — training the
 *     practitioner to ignore the one notice that means a capture path is dead.
 *   - Safari can reach its containing app through `sendNativeMessage`, which
 *     Chrome has no equivalent need for.
 *
 * Everything here is therefore **capability detection, not platform
 * detection**. `browserKind()` exists for the two cases where the distinction
 * is genuinely about the platform rather than about a method's presence, and
 * nothing on the capture path is allowed to branch on it. A capability that
 * ships to Safari later then starts working on its own, with no code change
 * and no stale `=== 'safari'` left behind to find.
 */

export type BrowserKind = 'chrome' | 'safari' | 'unknown';

/**
 * Safari serves extension resources from `safari-web-extension://`, Chrome from
 * `chrome-extension://`. This is available synchronously in every context the
 * extension has — including the service worker, where `navigator.userAgent` is
 * present but describes the browser engine rather than the extension host.
 */
export function browserKind(): BrowserKind {
  try {
    const url = chrome.runtime.getURL('');
    if (url.startsWith('safari-web-extension://')) return 'safari';
    if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return 'chrome';
  } catch {
    // getURL throws outside an extension context (a bare unit test, say).
  }
  return 'unknown';
}

/** True where KTD2's notification surface exists. False on Safari. */
export function hasNotifications(): boolean {
  return typeof chrome?.notifications?.create === 'function';
}

/**
 * True where R22's check can say something true.
 *
 * `chrome.commands` may exist while reporting an empty list on a platform that
 * has no shortcuts at all, which is indistinguishable from "your shortcut was
 * stolen by another extension" — the exact thing R22 exists to report. The
 * manifest-declared commands are checked against a platform that could bind
 * them, or not at all.
 */
export function hasCommands(): boolean {
  return typeof chrome?.commands?.getAll === 'function' && browserKind() !== 'safari';
}

/** True where the containing app can be reached. Safari only, in practice. */
export function hasNativeMessaging(): boolean {
  return typeof chrome?.runtime?.sendNativeMessage === 'function';
}

/**
 * Safari ignores the application identifier and routes to the extension's own
 * containing app, but the parameter is not optional. The bundle identifier is
 * the conventional value and is what the handler in the app sees echoed back.
 */
export const NATIVE_APPLICATION_ID = 'com.integralproductivity.GlassFrogClipper';

/**
 * Sends one message to the containing app, returning `undefined` rather than
 * throwing when there is no app to reach.
 *
 * Deliberately swallowing: every caller is on a *notification* path, and a
 * failure to notify must never become a second failure on top of the one being
 * reported. The bridge is one link in a chain (see notify.ts) and reporting
 * "did not deliver" is what lets the next link try.
 */
export async function sendNative<T = unknown>(message: object): Promise<T | undefined> {
  if (!hasNativeMessaging()) return undefined;
  try {
    return (await chrome.runtime.sendNativeMessage(NATIVE_APPLICATION_ID, message)) as T;
  } catch {
    // No containing app, app removed, or handler errored. All the same to us.
    return undefined;
  }
}
