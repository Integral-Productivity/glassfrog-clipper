/**
 * Turns a capture into the text fields GlassFrog will store.
 *
 * Implements KTD5: the provenance marker and the page title ride in the
 * tension's `label` (an action's or project's `description`); the practitioner's
 * note and the page evidence ride in `body` (`note`).
 *
 * GlassFrog exposes no provenance field and tags are read-only at create, so
 * R11's marker has to be text. Putting it in a *different field* from the
 * evidence is what makes it safe: truncating a long selection can never reach
 * it, and it always leads its field, so a long title cannot push it out either.
 *
 * This module is pure. It is the one place R11 can fail silently — a filed item
 * missing its marker looks perfectly fine in GlassFrog while quietly making the
 * triage-survival metric uncomputable — which is why it is tested first.
 */
import type { Capture, PageContext } from './types.ts';

/**
 * Stable by contract. Triage-survival matching and the read-back reconciliation
 * contemplated in issue #9 both key off this exact string; changing it orphans
 * every item filed before the change.
 */
export const PROVENANCE_MARKER = '[glassfrog-clipper]';

/** R7's cap, applied to each page-derived field on its own. */
export const EVIDENCE_FIELD_LIMIT = 4000;

const ELLIPSIS = '…';

/**
 * Code-point-safe truncation. Slicing by UTF-16 code unit can split a surrogate
 * pair and leave a lone half in the filed item, so this counts characters the
 * way a reader would.
 */
export function truncate(text: string, limit: number = EVIDENCE_FIELD_LIMIT): string {
  const points = Array.from(text);
  if (points.length <= limit) return text;
  return points.slice(0, Math.max(0, limit - 1)).join('') + ELLIPSIS;
}

export type Composed =
  | { kind: 'tension'; label: string; body: string }
  | { kind: 'action'; description: string; note: string }
  | { kind: 'project'; description: string; note: string };

/**
 * Marker first, then as much of the title as fits. Each field is bounded on its
 * own so one oversized field cannot consume another's budget.
 */
function headline(page: PageContext): string {
  const title = truncate(page.title).trim();
  return title.length > 0 ? `${PROVENANCE_MARKER} ${title}` : PROVENANCE_MARKER;
}

/**
 * The practitioner's own words come before the evidence the machine gathered —
 * whoever reads this in triage is looking for the thought, not the URL.
 */
function detail(capture: Capture): string {
  const parts: string[] = [];

  const note = capture.note?.trim();
  if (note) parts.push(note);

  const evidence: string[] = [];
  const url = truncate(capture.page.url).trim();
  if (url) evidence.push(url);

  const selection = capture.page.selection?.trim();
  if (selection) evidence.push(truncate(selection));

  if (evidence.length > 0) parts.push(evidence.join('\n\n'));

  return parts.join('\n\n');
}

export function compose(capture: Capture): Composed {
  const head = headline(capture.page);
  const body = detail(capture);

  // KD2: an unset work type is a tension. Note that no `status` is composed for
  // one — v5 auto-computes unprocessed/processed from associations and accepts
  // only `archived` from a client, so sending a status here would be the bug.
  switch (capture.workType) {
    case 'action':
      return { kind: 'action', description: head, note: body };
    case 'project':
      return { kind: 'project', description: head, note: body };
    default:
      return { kind: 'tension', label: head, body };
  }
}
