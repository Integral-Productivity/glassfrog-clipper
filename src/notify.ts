/**
 * How the practitioner learns what happened.
 *
 * Implements KTD2: success confirms on the action badge, failure raises a
 * notification. The badge costs no permission and cannot steal focus, which is
 * what R14 requires — but a badge cannot say *which* of four failures occurred,
 * and R18 needs the practitioner to learn that an unusable role wants
 * reconfiguring rather than a retry. That asymmetry is why the `notifications`
 * permission, and its install warning, is worth paying for.
 */
import type { CaptureFailure } from './messages.ts';
import { hasCommands, hasNotifications, sendNative } from './platform.ts';
import { type Notice, clearNotice, readNotice, writeNotice } from './storage.ts';

const SUCCESS_BADGE = '✓';
const SUCCESS_COLOUR = '#2ea064';
const HELD_BADGE = '…';
const HELD_COLOUR = '#b7791f';

/**
 * Cleared on an alarm rather than a setTimeout: the service worker may well be
 * dead before a timer fires, which would strand the badge until the next
 * capture. Chrome clamps alarms to 30 seconds, so that is the floor.
 */
export const BADGE_CLEAR_ALARM = 'clipper/clear-badge';
export const BADGE_CLEAR_DELAY_MINUTES = 0.5;

/** The quick-capture command, as named in the manifest. R22 checks it bound. */
export const QUICK_CAPTURE_COMMAND = 'quick-capture';

export async function confirmSuccess(): Promise<void> {
  await setBadge(SUCCESS_BADGE, SUCCESS_COLOUR);
}

/** R9: the capture is held, not filed and not lost — a distinct badge says so. */
export async function confirmHeld(): Promise<void> {
  await setBadge(HELD_BADGE, HELD_COLOUR);
}

async function setBadge(text: string, colour: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: colour });
  await chrome.action.setBadgeText({ text });
  await chrome.alarms.create(BADGE_CLEAR_ALARM, { delayInMinutes: BADGE_CLEAR_DELAY_MINUTES });
}

export async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' });
}

/**
 * R12: only the classified message reaches here, and `classifyFailure` has
 * already scrubbed it. Nothing in this module touches the client options, which
 * is the only place the key could have come from.
 */
export async function surfaceFailure(failure: CaptureFailure): Promise<void> {
  await surface(
    failure.reconfigure ? 'Capture needs attention' : 'Capture not filed',
    failure.message,
    `clipper/failure/${failure.kind}`,
  );
}

/** Used for the lifecycle events R15 and R16 require be told, not just logged. */
export async function surfaceNotice(title: string, message: string, id: string): Promise<void> {
  await surface(title, message, id);
}

/**
 * Delivers one notice, through whichever link in the chain is actually there.
 *
 * KTD2 assumed a single surface because Chrome has one. Safari has none —
 * `chrome.notifications` is not implemented — so the notice has to find its own
 * way out. The links are tried in descending order of how likely the
 * practitioner is to *see* the result while doing something else:
 *
 *   1. `chrome.notifications` — Chrome. A real system notification.
 *   2. The containing app, over native messaging — Safari. Also a real system
 *      notification, raised by the app rather than the extension.
 *   3. Storage — everywhere. Not seen until a surface is opened, which is why
 *      it is last, and why it is still worth having: a background quick-capture
 *      that failed with nowhere to report it is R18's worst case, where the
 *      practitioner believes a capture was filed and it was not.
 *
 * The badge is set by the caller and is orthogonal — it says *something*
 * happened without being able to say what.
 *
 * Every link is attempted for effect and none is allowed to throw: this runs on
 * the failure path, and a failure to report a failure would replace a
 * recoverable problem with a silent one.
 */
async function surface(title: string, message: string, id: string): Promise<void> {
  const deliveredBy = await deliver(title, message, id);
  // Recorded even when a system notification did land, so a surface opened
  // afterwards can show what the practitioner may have dismissed unread. The
  // `deliveredBy` discriminator is what lets it avoid repeating itself.
  await record({ id, title, message, at: new Date().toISOString(), deliveredBy });
}

async function deliver(title: string, message: string, id: string): Promise<Notice['deliveredBy']> {
  if (hasNotifications()) {
    try {
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon128.png'),
        title,
        message,
      });
      return 'notifications';
    } catch {
      // Fall through: a rejected create is no different from an absent API.
    }
  }

  // `sendNative` already swallows its own failures and reports absence as
  // undefined, so an unreachable containing app costs one round trip and
  // continues rather than throwing.
  const acknowledged = await sendNative<{ delivered?: boolean }>({
    kind: 'notice',
    id,
    title,
    message,
  });
  if (acknowledged?.delivered) return 'native';

  return 'stored';
}

async function record(notice: Notice): Promise<void> {
  try {
    await writeNotice(notice);
  } catch {
    // Storage full, or quota exceeded by the very capture being reported on.
    // There is nothing further to try and nothing useful to say.
  }
}

/**
 * Hands back a notice the practitioner has not already seen, and clears the slot.
 *
 * Only a notice the chain could not deliver is returned. One that went out as a
 * system notification has already been read or dismissed, and repeating it in
 * the popup would make every capture surface open onto a stale complaint.
 *
 * The slot is cleared either way: it holds one notice as a floor against
 * silence, not a log, and KD1 rejects anything that accumulates.
 */
export async function takeUnseenNotice(): Promise<Notice | undefined> {
  const notice = await readNotice();
  if (!notice) return undefined;
  await clearNotice();
  return notice.deliveredBy === 'stored' ? notice : undefined;
}

/**
 * R22. Chrome drops a suggested shortcut silently when another extension already
 * holds it, leaving a capture path that looks installed and does nothing. There
 * is no event for this, so it is checked at startup against the manifest.
 */
export async function reportUnboundShortcut(): Promise<boolean> {
  // Safari on iOS and iPadOS has no extension-shortcut concept, so `getAll()`
  // reports nothing there whether or not anything is wrong. Raising R22's
  // notice on every startup would teach the practitioner to dismiss the one
  // message that means their fastest capture path is dead.
  if (!hasCommands()) return false;

  const declared = chrome.runtime.getManifest().commands ?? {};
  if (!(QUICK_CAPTURE_COMMAND in declared)) return false;

  const bound = await chrome.commands.getAll();
  const entry = bound.find((command) => command.name === QUICK_CAPTURE_COMMAND);
  if (entry?.shortcut) return false;

  await surfaceNotice(
    'Capture shortcut is not assigned',
    'Another extension may already use it. Assign one at chrome://extensions/shortcuts.',
    'clipper/unbound-shortcut',
  );
  return true;
}
