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

async function surface(title: string, message: string, id: string): Promise<void> {
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon128.png'),
    title,
    message,
  });
}

/**
 * R22. Chrome drops a suggested shortcut silently when another extension already
 * holds it, leaving a capture path that looks installed and does nothing. There
 * is no event for this, so it is checked at startup against the manifest.
 */
export async function reportUnboundShortcut(): Promise<boolean> {
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
