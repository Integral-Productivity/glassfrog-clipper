/**
 * The service worker: the only thing that writes to GlassFrog (KTD1).
 *
 * Every listener below is registered at top level, synchronously. A listener
 * added after an `await` is missed on a cold start — which is exactly the first
 * keystroke after the worker has been idle, the single most common capture there
 * is. This file therefore does no asynchronous work before its last
 * addListener() call.
 */
import { adoptConfigurationFromApp } from './bridge.ts';
import { type CaptureWriter, captureActiveTab, fileCapture } from './capture.ts';
import { classifyFailure } from './errors.ts';
import { getWriter } from './glassfrog.ts';
import {
  type FileCaptureOutcome,
  isFileCaptureRequest,
} from './messages.ts';
import {
  BADGE_CLEAR_ALARM,
  clearBadge,
  confirmSuccess,
  reportUnboundShortcut,
  surfaceFailure,
  surfaceNotice,
} from './notify.ts';
import {
  fileHeldCapture,
  holdCapture,
  preserveFailedCapture,
  reviewOnStartup,
} from './pending.ts';
import {
  enableTrustedContexts,
  getApiKey,
  getConfigurationState,
  onConfigurationChanged,
} from './storage.ts';
import type { Capture } from './types.ts';

const QUICK_CAPTURE = 'quick-capture';

/**
 * How a flow obtains its writer.
 *
 * Passed as a factory rather than a writer so the unconfigured branch still
 * never resolves one — `getWriter()` throws without an API key, and calling it
 * eagerly would turn R9's hold into a failure. Defaulted rather than required so
 * the listeners below read as they did before; the seam exists for tests, which
 * is the whole reason `submit()` had none.
 */
type WriterFactory = () => Promise<CaptureWriter>;

enableTrustedContexts();

/* ------------------------------------------------------------- listeners -- */

chrome.commands.onCommand.addListener((command) => {
  if (command !== QUICK_CAPTURE) return;
  void quickCapture();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isFileCaptureRequest(message)) return false;
  void submit(message.capture, message.captureId).then(sendResponse);
  // Keeps the message channel open for the async reply. The popup may be gone
  // before it arrives, which KTD1 treats as expected rather than exceptional.
  return true;
});

/**
 * R22's shortcut check is the only thing still bound to the browser's lifecycle.
 *
 * It is a standing configuration problem, not an event: running it on every
 * worker wake would re-raise the same notification many times a day, which is
 * the behaviour `reviewOnStartup` avoids by clearing what it surfaces.
 */
chrome.runtime.onStartup.addListener(() => void reportUnboundShortcut());
chrome.runtime.onInstalled.addListener(() => void reportUnboundShortcut());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_CLEAR_ALARM) void clearBadge();
});

/**
 * R18's reconfigure path and AE1's first-run path are the same path: whenever
 * configuration becomes valid and something is held, it files. Watching storage
 * rather than the options page's save means it works no matter which context
 * completed the configuration.
 */
onConfigurationChanged(() => void fileHeldCaptureIfPossible());

/* ----------------------------------------------------------------- flows -- */

/**
 * F1, the zero-decision path (R1): the shortcut files the active tab without
 * opening the popup and without presenting any prompt. Nothing here asks the
 * practitioner anything — that property is the product.
 */
export async function quickCapture(writerFor: WriterFactory = getWriter): Promise<void> {
  const page = await captureActiveTab();

  // OQ7: a tab the extension cannot read fails visibly rather than filing an
  // empty tension — one carrying nothing is worse than none.
  if (!page) {
    await surfaceNotice(
      'Cannot capture this page',
      'Chrome does not allow extensions to read this tab. Try again on an ordinary web page.',
      'clipper/unreadable-tab',
    );
    return;
  }

  await submit({ page }, newCaptureId(), writerFor);
}

/**
 * The single entry point both flows share, so the configured/unconfigured
 * branch and the failure classification exist in exactly one place.
 *
 * Both exits preserve the capture. The unconfigured one always did; the failure
 * one did not, which is the defect R10 and R18 were written against — a
 * configured extension whose role had gone stale surfaced the failure and kept
 * the content nowhere, so there was nothing for the reconfigure to re-file.
 */
export async function submit(
  capture: Capture,
  captureId: string,
  writerFor: WriterFactory = getWriter,
): Promise<FileCaptureOutcome> {
  const state = await getConfigurationState();
  if (!state.configured) {
    // R9 / KD4: held, not lost. The first keystroke is where a practitioner
    // decides whether the tool works, so a dead end here is the most expensive
    // failure available.
    return holdCapture(capture, captureId);
  }

  try {
    const created = await fileCapture(await writerFor(), capture, captureId);
    await confirmSuccess();
    return { status: 'filed', captureId, ...(created.id ? { itemId: created.id } : {}) };
  } catch (error) {
    const failure = classifyFailure(error, { apiKey: await getApiKey() });
    // R10: preserved in the pending slot, which is also what gives R18's
    // reconfigure something to find.
    return preserveFailedCapture(capture, captureId, failure);
  }
}

export async function fileHeldCaptureIfPossible(
  writerFor: WriterFactory = getWriter,
): Promise<void> {
  try {
    await fileHeldCapture(await writerFor());
  } catch (error) {
    await surfaceFailure(classifyFailure(error, { apiKey: await getApiKey() }));
  }
}

/**
 * Run once per worker lifetime, not once per browser session.
 *
 * `chrome.runtime.onStartup` fires when the browser starts; it does not fire
 * when MV3 tears the worker down for idleness and respawns it on the next event,
 * which is the ordinary lifecycle and the one KTD7 exists for. Bound to those
 * events alone, a stranded capture stayed invisible for the rest of the session
 * and was then deleted at the next browser start.
 *
 * Safe to repeat because everything it surfaces, it also clears.
 */
export async function onWake(): Promise<void> {
  // Nothing in here files anything directly (KTD7). Adopting configuration from
  // the containing app can *cause* a held capture to file, but only through
  // onConfigurationChanged — the same single path R18's reconfigure case uses,
  // rather than a second one. A no-op anywhere there is no containing app.
  await adoptConfigurationFromApp();
  await reviewOnStartup();
}

function newCaptureId(): string {
  return crypto.randomUUID();
}

// Last, and deliberately after every addListener above: this is the file's only
// asynchronous work at module scope, and the header's rule is that none of it
// may precede a listener registration.
void onWake();
