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

/**
 * Removes the URL's `userinfo` component — `user:password@`, and the bare
 * `token@` and `:password@` forms — from a captured URL.
 *
 * R7 carries the URL as evidence, and a magic-link, password-reset, or
 * signed-URL page turns a zero-decision keystroke into an export of a
 * credential the practitioner never chose to share. Userinfo is the one part of
 * a URL that is *definitionally* a credential, so removing it costs no
 * decision — which is what keeps this on the right side of STRATEGY.md's resist
 * test. Secrets carried in the query string or fragment are a judgement call,
 * not a component, and R7 carries those as-is by design.
 *
 * A URL with no userinfo is returned byte-identical rather than round-tripped
 * through `URL`. Serialising every capture would lowercase hosts, add trailing
 * slashes, and re-encode paths — rewriting the evidence on the overwhelming
 * majority of captures that were never at risk. An unparseable string is
 * likewise returned unchanged: `chrome.tabs.Tab.url` is browser-normalised, so
 * a parse failure means there is no authority component to reason about.
 */
export function stripUrlCredentials(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!parsed.username && !parsed.password) return url;

  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

export type Composed =
  | { kind: 'tension'; body: string }
  | { kind: 'action'; description: string; note: string }
  /**
   * Only a project carries `link`. `ActionInput` has no such field and neither
   * does a tension — verified against the SDK's own types — so there is nothing
   * to invent an equivalent for on those two paths.
   */
  | { kind: 'project'; description: string; note: string; link?: string };

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
      // The URL goes to `link` AND stays in the note. The note is the
      // human-readable evidence block and is subject to R7's truncation; `link`
      // is the single canonical field GlassFrog renders the project as linked
      // from, and truncation must never reach it. Both, deliberately.
      //
      // An empty URL is omitted rather than sent blank: `link: ''` would read
      // as a link that exists and is broken.
      return {
        kind: 'project',
        description: head,
        note: body,
        ...(capture.page.url.trim() ? { link: capture.page.url } : {}),
      };
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
