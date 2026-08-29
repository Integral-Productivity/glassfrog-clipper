import { compose } from './compose.ts';
import { EVIDENCE_FIELD_LIMIT, truncate } from './compose.ts';
import {
  type DefaultStatus,
  clearInFlight,
  clearPendingCapture,
  getCaptureRoleId,
  getDefaultStatus,
  markInFlight,
  readPendingCapture,
} from './storage.ts';
import type { Capture, PageContext } from './types.ts';

/**
 * The narrow port the capture path writes through.
 *
 * The Verification Contract forbids mocking GlassFrog at the network boundary,
 * so tests substitute a fake *client* behind this interface instead — the same
 * shape as the SdkGlassFrogReader adapter in glassfrog-productboard-plugin.
 * Keeping the port here rather than in src/glassfrog.ts is what lets the tests
 * run without resolving the SDK at all.
 */
export interface CaptureWriter {
  createTension(roleId: string, input: { body: string }): Promise<CreatedItem>;
  createAction(
    roleId: string,
    input: { description: string; note: string; status: DefaultStatus },
  ): Promise<CreatedItem>;
  createProject(
    roleId: string,
    input: { description: string; note: string; status: DefaultStatus },
  ): Promise<CreatedItem>;
}

export interface CreatedItem {
  id?: string;
}

/**
 * Page fields are bounded here, at the moment of capture, rather than only at
 * compose time. An untruncated multi-megabyte selection would otherwise blow
 * the storage quota on its way into the pending slot — losing exactly the
 * capture the slot exists to protect.
 */
export function pageContextFromTab(tab: chrome.tabs.Tab, selection?: string): PageContext {
  const trimmed = selection?.trim();
  return {
    url: truncate(tab.url ?? '', EVIDENCE_FIELD_LIMIT),
    title: truncate(tab.title ?? '', EVIDENCE_FIELD_LIMIT),
    ...(trimmed ? { selection: truncate(trimmed, EVIDENCE_FIELD_LIMIT) } : {}),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Reads the active tab into a capture context, or reports that it cannot.
 *
 * Shared by the shortcut and the popup so both flows see exactly the same
 * evidence — F2 is "the same capture with more revealed", not a second path.
 *
 * OQ7: a tab Chrome will not let the extension read yields undefined, so the
 * caller can fail visibly rather than file an empty tension. chrome:// pages and
 * the Web Store deny activeTab outright, so the URL never arrives at all.
 */
export async function captureActiveTab(): Promise<PageContext | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return undefined;

  // KTD6: the selection is read on the invoking gesture, in the same turn and
  // before any network await — activeTab is revoked on cross-origin navigation.
  return pageContextFromTab(tab, await readSelection(tab.id));
}

/**
 * A failure here is not a capture failure: the page may simply forbid
 * injection, and the URL and title are still worth filing.
 */
async function readSelection(tabId: number): Promise<string | undefined> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? '',
    });
    const selection = result?.result;
    return typeof selection === 'string' && selection.trim() ? selection : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Files one capture, once.
 *
 * KTD7's at-most-once rests on ordering: the in-flight marker is written before
 * the request and cleared only after it is accepted. A worker that dies in
 * between leaves the marker behind, which U6 surfaces rather than auto-refiling
 * — GlassFrog v5 has no idempotency key, so a silent retry would duplicate
 * tensions on the capture role and corrupt the triage-survival metric.
 */
export async function fileCapture(
  writer: CaptureWriter,
  capture: Capture,
  captureId: string,
): Promise<CreatedItem> {
  // R5: a role the practitioner named in the popup is used as given and is
  // never replaced by the configured one.
  const roleId = capture.roleId ?? (await getCaptureRoleId());
  if (!roleId) {
    throw new Error('No capture role configured. Open the extension options to choose one.');
  }

  const composed = compose(capture);

  await markInFlight({ id: captureId, capture, startedAt: new Date().toISOString() });

  const created = await write(writer, roleId, composed);

  await clearInFlight(captureId);
  await clearPendingIfThisCapture(captureId);

  return created;
}

async function write(
  writer: CaptureWriter,
  roleId: string,
  composed: ReturnType<typeof compose>,
): Promise<CreatedItem> {
  switch (composed.kind) {
    case 'tension':
      // No status: v5 derives unprocessed/processed from associations and
      // accepts only `archived` from a client. No label either — see compose().
      return writer.createTension(roleId, { body: composed.body });
    case 'action':
      return writer.createAction(roleId, {
        description: composed.description,
        note: composed.note,
        // R6 / KD3: neither status vocabulary shares a value with tensions, so
        // which holding state fits is the practitioner's call.
        status: await getDefaultStatus(),
      });
    case 'project':
      return writer.createProject(roleId, {
        description: composed.description,
        note: composed.note,
        status: await getDefaultStatus(),
      });
  }
}

/**
 * R16 clears the pending slot when *its* item files — matching on id so a
 * popup capture cannot clear an unrelated capture someone is still configuring
 * for.
 */
async function clearPendingIfThisCapture(captureId: string): Promise<void> {
  const pending = await readPendingCapture();
  if (pending.state === 'absent') return;
  if (pending.pending.id !== captureId) return;
  await clearPendingCapture();
}
