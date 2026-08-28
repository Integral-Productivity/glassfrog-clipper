import type { Capture, PageContext, WorkType } from './types.js';

export function pageContextFromTab(tab: chrome.tabs.Tab, selection?: string): PageContext {
  return {
    url: tab.url ?? '',
    title: tab.title ?? '',
    selection,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Decides what a zero-input capture actually becomes.
 *
 * This is the load-bearing decision in the whole extension. STRATEGY.md commits
 * to "capture never blocks on a decision, and never discards one already made" —
 * so when the practitioner hits the shortcut and supplies nothing, something
 * still has to be filed, under some work type, against some role.
 *
 * TODO(kraig): implement. The trade-offs to weigh:
 *
 *   - Defaulting everything to `tension` is the most honest Holacratic reading
 *     (a tension is "a gap between what is and what could be" — the least
 *     committed shape). But it risks the exact failure named in the interview:
 *     everything lands in one bucket and the backlog stops discriminating.
 *
 *   - Inferring from `capture.note` (e.g. an imperative verb → action) is
 *     cheap and often right, but STRATEGY.md's Boundaries currently rule out
 *     inference in the capture path for iteration 1. Re-read that line before
 *     reaching for it.
 *
 *   - Whatever this returns must be *visibly provisional*, or "classify later"
 *     silently becomes "misclassified forever" — which would show up as a
 *     healthy structure-at-capture rate hiding a collapsing triage survival rate.
 *
 * @param capture the in-flight capture; `workType` may already be set by the
 *                practitioner, in which case this must not override it.
 * @returns the work type to file under, and whether it was chosen or defaulted.
 */
export function resolveWorkType(capture: Capture): { workType: WorkType; provisional: boolean } {
  throw new Error('resolveWorkType is not implemented yet — see the TODO above.');
}
