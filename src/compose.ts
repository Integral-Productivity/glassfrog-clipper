/**
 * Turns a capture into the text fields GlassFrog will store.
 *
 * Revises KTD5 in one respect, forced by live API behaviour rather than by
 * preference — see the note on the headline below. The decision's *substance*
 * is preserved: the provenance marker leads its field and is never truncated,
 * so nothing the practitioner captured can silently destroy it.
 *
 * This module is pure. It is the one place R11 can fail silently — a filed item
 * missing its marker looks perfectly fine in GlassFrog while quietly making the
 * triage-survival metric uncomputable.
 */
import type { Capture, PageContext } from './types.ts';

/**
 * Stable by contract. Triage-survival matching and the read-back reconciliation
 * contemplated in issue #9 both key off this exact string; changing it orphans
 * every item filed before the change.
 */
export const PROVENANCE_MARKER = '[glassfrog-clipper]';

/** R7's cap, applied to each page-derived evidence field on its own. */
export const EVIDENCE_FIELD_LIMIT = 4000;

/**
 * A headline is a headline. 200 is GlassFrog's own cap on a tension `label`,
 * adopted uniformly so an action's `description` cannot become a wall of text
 * either. Verified against the live API: the field rejects more.
 */
export const HEADLINE_LIMIT = 200;

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
  | { kind: 'tension'; body: string }
  | { kind: 'action'; description: string; note: string }
  | { kind: 'project'; description: string; note: string };

/**
 * Marker first, then as much of the title as fits inside HEADLINE_LIMIT.
 *
 * The marker leads and is never truncated, so R11 holds no matter how long the
 * title is — the property KTD5 was written to guarantee.
 */
export function headline(page: PageContext): string {
  const budget = HEADLINE_LIMIT - PROVENANCE_MARKER.length - 1;
  const title = truncate(page.title.trim(), budget).trim();
  return title ? `${PROVENANCE_MARKER} ${title}` : PROVENANCE_MARKER;
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

  // R4 / KD2: an unset work type is a tension. No `status` is composed for one —
  // v5 auto-computes unprocessed/processed from associations and accepts only
  // `archived` from a client, verified live.
  switch (capture.workType) {
    case 'action':
      return { kind: 'action', description: head, note: body };
    case 'project':
      return { kind: 'project', description: head, note: body };
    default:
      // No `label`. The generated OpenAPI types list it on TensionInput, but
      // the API rejects it on create — the tension is created first and the
      // label PATCHed separately, which this path deliberately does not do.
      //
      // A second call would be a second failure point between the POST and the
      // marker landing, and KTD7's at-most-once turns on there being exactly
      // one write per capture. A capture whose marker went missing because the
      // worker died mid-PATCH is precisely the silent R11 failure this module
      // exists to prevent. The marker leads the body instead.
      return { kind: 'tension', body: [head, body].filter(Boolean).join('\n\n') };
  }
}
