/**
 * The pending capture's lifecycle.
 *
 * KD4 promises that a capture invoked before the extension is configured is not
 * lost — the options page opens holding it, and it files once configuration is
 * saved. KTD3 is what keeps that promise from becoming the accumulating inbox
 * KD1 rejects: one fixed slot, overwritten rather than appended, with an expiry.
 *
 * R10 widens the promise past the unconfigured case: a capture that fails
 * *after* configuration — a stale role, a revoked key, no network — is preserved
 * too, in the same slot, under the same one-slot rule. Two doors, one room.
 *
 * The hard part is not the happy path. It is that the service worker can die at
 * any point, so every state has to be recoverable from storage alone.
 */
import { type CaptureWriter, fileCapture } from './capture.ts';
import { classifyFailure } from './errors.ts';
import type { CaptureFailure, FileCaptureOutcome } from './messages.ts';
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
 * Puts a capture in the one slot, announcing a replacement if it evicted one.
 *
 * R15: a later capture replaces the held one and the replacement is *surfaced*.
 * Silently overwriting would be the worst of both worlds — the practitioner
 * believes two things were captured and finds one.
 *
 * Newest wins, on both doors. The alternative — refusing to hold a newly failed
 * capture because an older one is already waiting — would preserve the capture
 * the practitioner has most likely forgotten at the cost of the one they are
 * still looking at, and with no discard control it would let a single stale
 * capture refuse every capture made for the next seven days.
 *
 * Re-holding the capture already in the slot is not a replacement, so it is not
 * announced as one: a capture that fails twice must not report that it evicted
 * itself.
 */
async function occupySlot(capture: Capture, captureId: string): Promise<{ replacedPending: boolean }> {
  const { replaced } = await writePendingCapture({
    id: captureId,
    capture,
    capturedAt: new Date().toISOString(),
  });

  const evicted = replaced && replaced.id !== captureId ? replaced : undefined;
  if (evicted) {
    await surfaceNotice(
      'Replaced the capture waiting to be filed',
      `Only one capture is held at a time. "${describe(evicted.capture)}" was replaced by "${describe(capture)}".`,
      'clipper/pending-replaced',
    );
  }

  return { replacedPending: evicted !== undefined };
}

/**
 * R9: hold the capture, then open the options page.
 */
export async function holdCapture(capture: Capture, captureId: string): Promise<FileCaptureOutcome> {
  const { replacedPending } = await occupySlot(capture, captureId);

  await confirmHeld();
  await chrome.runtime.openOptionsPage();

  return { status: 'held', captureId, replacedPending };
}

/**
 * R10: a capture that fails *after* configuration is preserved, not discarded.
 *
 * This is the branch `submit()` was missing. Without it a configured extension
 * whose role went stale surfaced the failure and kept the content nowhere — so
 * R18's re-file had nothing to re-file, and the only remaining trace, the
 * in-flight marker, was surfaced with the wrong message and then deleted.
 *
 * The slot is written before anything is surfaced. A worker killed between the
 * two loses a notification, which the practitioner can live without; the other
 * order loses the capture, which is the whole thing this module exists to stop.
 *
 * R18: the options page opens only for a failure that reconfiguring can fix.
 * Opening it on a rate limit or a dropped connection would send the practitioner
 * to change settings that are already correct.
 */
export async function preserveFailedCapture(
  capture: Capture,
  captureId: string,
  failure: CaptureFailure,
): Promise<FileCaptureOutcome> {
  await occupySlot(capture, captureId);
  await settleInFlight(captureId, failure);

  await surfaceFailure(failure);
  // The held badge, not the success badge: kept and not filed is its own state,
  // and R14 forbids anything here taking focus.
  await confirmHeld();

  if (failure.reconfigure) await chrome.runtime.openOptionsPage();

  return { status: 'failed', captureId, failure };
}

/**
 * What a failed write does with its in-flight marker.
 *
 * KTD7 leaves the marker behind so U6 can surface a write whose outcome is
 * unknown. A failure that names its own rejection — any 4xx, or the client-side
 * id validation that never reached the network — has no unknown outcome to
 * surface, and leaving its marker makes `reviewOnStartup` tell the practitioner
 * to go check GlassFrog for an item that was never created.
 */
async function settleInFlight(captureId: string, failure: CaptureFailure): Promise<void> {
  if (failure.mayHaveFiled) return;
  await clearInFlight(captureId);
}

/**
 * Files the held capture when configuration is valid.
 *
 * The trigger is deliberately "a capture is held and configuration is now
 * valid" rather than "the extension was previously unconfigured" — the same
 * path has to serve R18's reconfigure case, where the practitioner fixes an
 * unusable role and the preserved capture should go out without being
 * re-captured. `preserveFailedCapture` is what now puts a capture there for it
 * to find.
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
    // R10: the capture stays in the slot. Nothing here discards it.
    await settleInFlight(id, failure);
    await surfaceFailure(failure);
    return { status: 'failed', captureId: id, failure };
  }
}

/**
 * The plan's `Pending --> None: practitioner discards` edge.
 *
 * Every other way out of the slot is automatic — filed, replaced, or expired —
 * so without this a capture the practitioner has decided against can only be
 * dropped by waiting out the seven-day expiry, and the options page keeps
 * announcing it in the meantime. Nothing is surfaced: the practitioner asked for
 * this and is looking at the page that did it.
 */
export async function discardPendingCapture(): Promise<boolean> {
  const pending = await readPendingCapture();
  if (pending.state === 'absent') return false;
  await clearPendingCapture();
  return true;
}

/**
 * Run whenever the service worker wakes. Nothing here files anything.
 *
 * An in-flight marker means the worker died between the POST and the clear, so
 * the item may or may not exist in GlassFrog. v5 has no idempotency key, so
 * re-filing would silently duplicate a tension on the capture role and corrupt
 * the triage-survival metric. KTD7 hands that ambiguity to the one party who
 * can actually resolve it by looking.
 *
 * Only genuinely ambiguous outcomes reach here now: `settleInFlight` clears the
 * marker for any failure that already named itself as a rejection, so the
 * "check GlassFrog" instruction is only ever given about a write that really may
 * have landed.
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
