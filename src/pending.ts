/**
 * The pending capture's lifecycle.
 *
 * KD4 promises that a capture invoked before the extension is configured is not
 * lost — the options page opens holding it, and it files once configuration is
 * saved. KTD3 is what keeps that promise from becoming the accumulating inbox
 * KD1 rejects: one fixed slot, overwritten rather than appended, with an expiry.
 *
 * The hard part is not the happy path. It is that the service worker can die at
 * any point, so every state has to be recoverable from storage alone.
 */
import { type CaptureWriter, fileCapture } from './capture.ts';
import { classifyFailure } from './errors.ts';
import type { FileCaptureOutcome } from './messages.ts';
import { confirmHeld, confirmSuccess, surfaceFailure, surfaceNotice } from './notify.ts';
import {
  clearInFlight,
  clearPendingCapture,
  getApiKey,
  getConfigurationState,
  listInFlight,
  readPendingCapture,
  writePendingCapture,
} from './storage.ts';
import type { Capture } from './types.ts';

/** A short, recognisable stand-in for the page, for notification text. */
function describe(capture: Capture): string {
  const title = capture.page.title?.trim();
  if (title) return title;
  const url = capture.page.url?.trim();
  return url || 'an untitled page';
}

/**
 * R9: hold the capture, then open the options page.
 *
 * R15: a later capture replaces the held one and the replacement is *surfaced*.
 * Silently overwriting would be the worst of both worlds — the practitioner
 * believes two things were captured and finds one.
 */
export async function holdCapture(capture: Capture, captureId: string): Promise<FileCaptureOutcome> {
  const { replaced } = await writePendingCapture({
    id: captureId,
    capture,
    capturedAt: new Date().toISOString(),
  });

  if (replaced) {
    await surfaceNotice(
      'Replaced the capture waiting to be filed',
      `Only one capture is held at a time. "${describe(replaced.capture)}" was replaced by "${describe(capture)}".`,
      'clipper/pending-replaced',
    );
  }

  await confirmHeld();
  await chrome.runtime.openOptionsPage();

  return { status: 'held', captureId, replacedPending: replaced !== undefined };
}

/**
 * Files the held capture when configuration is valid.
 *
 * The trigger is deliberately "a capture is held and configuration is now
 * valid" rather than "the extension was previously unconfigured" — the same
 * path has to serve R18's reconfigure case, where the practitioner fixes an
 * unusable role and the preserved capture should go out without being
 * re-captured.
 */
export async function fileHeldCapture(writer: CaptureWriter): Promise<FileCaptureOutcome | undefined> {
  const state = await getConfigurationState();
  if (!state.configured) return undefined;

  const pending = await readPendingCapture();
  if (pending.state === 'absent') return undefined;

  if (pending.state === 'expired') {
    await expire(pending.pending.capture);
    return undefined;
  }

  const { id, capture } = pending.pending;
  try {
    const created = await fileCapture(writer, capture, id);
    await confirmSuccess();
    return { status: 'filed', captureId: id, ...(created.id ? { itemId: created.id } : {}) };
  } catch (error) {
    const failure = classifyFailure(error, { apiKey: await getApiKey() });
    await surfaceFailure(failure);
    // R10: the capture stays in the slot. Nothing here discards it.
    return { status: 'failed', captureId: id, failure };
  }
}

/**
 * Run at worker startup. Nothing here files anything.
 *
 * An in-flight marker means the worker died between the POST and the clear, so
 * the item may or may not exist in GlassFrog. v5 has no idempotency key, so
 * re-filing would silently duplicate a tension on the capture role and corrupt
 * the triage-survival metric. KTD7 hands that ambiguity to the one party who
 * can actually resolve it by looking.
 */
export async function reviewOnStartup(): Promise<{ stranded: number; expired: boolean }> {
  const stranded = await listInFlight();
  for (const marker of stranded) {
    await surfaceNotice(
      'A capture may not have finished filing',
      `"${describe(marker.capture)}" was being filed when the extension stopped. Check GlassFrog before capturing it again.`,
      `clipper/stranded/${marker.id}`,
    );
    // Surfaced once. Leaving the marker would re-raise this on every startup,
    // which trains the practitioner to ignore it.
    await clearInFlight(marker.id);
  }

  const pending = await readPendingCapture();
  const expired = pending.state === 'expired';
  if (expired) await expire(pending.pending.capture);

  return { stranded: stranded.length, expired };
}

/**
 * R16: an expired capture is not retained indefinitely, and not deleted
 * silently either. The notice names the page, so the practitioner can go back
 * and capture it again if it still matters.
 */
async function expire(capture: Capture): Promise<void> {
  await surfaceNotice(
    'A held capture expired',
    `"${describe(capture)}" waited too long to be configured and was discarded. Capture it again if it still matters.`,
    'clipper/pending-expired',
  );
  await clearPendingCapture();
}
