/**
 * The service worker: the only thing that writes to GlassFrog (KTD1).
 *
 * Every listener below is registered at top level, synchronously. A listener
 * added after an `await` is missed on a cold start — which is exactly the first
 * keystroke after the worker has been idle, the single most common capture there
 * is. This file therefore does no asynchronous work before its last
 * addListener() call.
 */
import { captureActiveTab, fileCapture } from './capture.ts';
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
import { fileHeldCapture, holdCapture, reviewOnStartup } from './pending.ts';
import {
  enableTrustedContexts,
  getApiKey,
  getConfigurationState,
  onConfigurationChanged,
} from './storage.ts';
import type { Capture } from './types.ts';

const QUICK_CAPTURE = 'quick-capture';

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

chrome.runtime.onStartup.addListener(() => void onWake());
chrome.runtime.onInstalled.addListener(() => void onWake());

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
 * F1, the zero-decision path. Nothing here prompts, and nothing here decides.
 */
async function quickCapture(): Promise<void> {
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

  await submit({ page }, newCaptureId());
}

/**
 * The single entry point both flows share, so the configured/unconfigured
 * branch and the failure classification exist in exactly one place.
 */
async function submit(capture: Capture, captureId: string): Promise<FileCaptureOutcome> {
  const state = await getConfigurationState();
  if (!state.configured) {
    // R9 / KD4: held, not lost. The first keystroke is where a practitioner
    // decides whether the tool works, so a dead end here is the most expensive
    // failure available.
    return holdCapture(capture, captureId);
  }

  try {
    const created = await fileCapture(await getWriter(), capture, captureId);
    await confirmSuccess();
    return { status: 'filed', captureId, ...(created.id ? { itemId: created.id } : {}) };
  } catch (error) {
    const failure = classifyFailure(error, { apiKey: await getApiKey() });
    await surfaceFailure(failure);
    return { status: 'failed', captureId, failure };
  }
}

async function fileHeldCaptureIfPossible(): Promise<void> {
  try {
    await fileHeldCapture(await getWriter());
  } catch (error) {
    await surfaceFailure(classifyFailure(error, { apiKey: await getApiKey() }));
  }
}

async function onWake(): Promise<void> {
  // Nothing in here files anything (KTD7).
  await reviewOnStartup();
  await reportUnboundShortcut();
}

function newCaptureId(): string {
  return crypto.randomUUID();
}
