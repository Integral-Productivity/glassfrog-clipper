/**
 * How the measurements read to a practitioner.
 *
 * Pure, and separate from the options page, for the same reason the capture
 * path keeps composition out of the DOM: the wording carries the meaning. A
 * report that renders the touch clock next to the capture clock without saying
 * which one is thresholded, or that prints a survival rate without saying it is
 * a tripwire, would hand back exactly the false confidence ADR 0006 removed.
 *
 * Those captions are therefore asserted in test/report.test.ts rather than left
 * to whoever next edits the HTML.
 */
import {
  type CaptureMetrics,
  MINIMUM_CAPTURES,
  POPUP_ABANDONMENT_THRESHOLD,
  STRUCTURE_AT_CAPTURE_THRESHOLD,
} from './metrics.ts';
import { AGE_MAX_THRESHOLD_DAYS, AGE_P90_THRESHOLD_DAYS, type QueueHealth } from './queue-health.ts';

export type LineVerdict = 'pass' | 'fail' | 'unjudged';

export interface ReportLine {
  label: string;
  value: string;
  note?: string;
  verdict?: LineVerdict;
}

export interface ReportSection {
  title: string;
  caption: string;
  lines: ReportLine[];
}

const UNKNOWN = '—';

const percent = (value: number | null): string =>
  value === null ? UNKNOWN : `${(value * 100).toFixed(1)}%`;

const seconds = (ms: number | null): string => (ms === null ? UNKNOWN : `${(ms / 1000).toFixed(2)}s`);

const days = (value: number | null): string => (value === null ? UNKNOWN : `${value}d`);

const verdictOf = (meets: boolean | null): LineVerdict =>
  meets === null ? 'unjudged' : meets ? 'pass' : 'fail';

/**
 * STRATEGY.md's first three metrics.
 *
 * Time-to-capture and abandonment are split by path because they are
 * thresholded by path: the keystroke path is the flow claim, and the popup path
 * is recorded but not judged, since human deliberation dominates it. Both
 * numbers are shown; only one carries a verdict.
 */
export function formatCaptureMetrics(metrics: CaptureMetrics): ReportSection {
  const gate = metrics.sufficient
    ? `${metrics.captures} captures in the last ${metrics.window.days} days.`
    : `${metrics.captures} captures in the last ${metrics.window.days} days — ${MINIMUM_CAPTURES} are needed before any of these is judged.`;

  return {
    title: 'Capture telemetry',
    caption: `${gate} Recorded on this device only; nothing is sent anywhere.`,
    lines: [
      {
        label: 'Time to capture (keystroke p95)',
        value: seconds(metrics.timeToCapture.value),
        note: `p50 ${seconds(metrics.keystroke.timeToCapture.p50Ms)} · threshold 2.00s · ${metrics.keystroke.timeToCapture.samples} filed`,
        verdict: verdictOf(metrics.timeToCapture.meets),
      },
      {
        label: 'Time to capture (popup p95)',
        value: seconds(metrics.popup.timeToCapture.p95Ms),
        note: 'Recorded, not thresholded — deliberation dominates this path, so it is not a measure of flow.',
      },
      {
        label: 'Keystroke capture failures',
        value: percent(metrics.keystrokeFailure.value),
        note: `${metrics.keystroke.failed} of ${metrics.keystroke.failed + metrics.keystroke.filed} · threshold 1% · a keystroke that does not file is a defect`,
        verdict: verdictOf(metrics.keystrokeFailure.meets),
      },
      {
        label: 'Popup abandonment',
        value: percent(metrics.popupAbandonment.value),
        note: `${metrics.popup.abandoned} of ${metrics.popup.abandoned + metrics.popup.filed} · threshold ${POPUP_ABANDONMENT_THRESHOLD * 100}%`,
        verdict: verdictOf(metrics.popupAbandonment.meets),
      },
      {
        label: 'Structure at capture',
        value: percent(metrics.structureAtCapture.value),
        note: `${metrics.structureAtCapture.structured} of ${metrics.structureAtCapture.filed} filed with a role you chose or a work type · threshold ${STRUCTURE_AT_CAPTURE_THRESHOLD * 100}% · this is the falsification test for the positioning`,
        verdict: verdictOf(metrics.structureAtCapture.meets),
      },
      {
        label: 'Held for configuration',
        value: `${metrics.keystroke.held + metrics.popup.held}`,
        note: 'Outside every rate above — the extension did what R9 asks, and the capture files later.',
      },
    ],
  };
}

/**
 * STRATEGY.md's fourth metric, in the order ADR 0006 requires it be read.
 *
 * The capture clock leads and carries the verdict. The touch clock follows it,
 * captioned as unthresholded. Survival comes last, captioned as a tripwire —
 * it is the number that reads best on the sickest queue, so putting it first
 * would answer the question before the report has asked it.
 */
export function formatQueueHealth(health: QueueHealth): ReportSection {
  const capture = health.clipped.age.sinceCapture;
  const touch = health.clipped.age.sinceTouch;
  const wholeQueue = health.all.age.sinceCapture;
  const flow = health.flow[0];
  // The preceding period rides in the note beside each count. Both stay counts
  // rather than becoming a ratio: rising inflow and falling outflow move a
  // ratio identically, which is precisely what makes a breach unreadable
  // (issue #38).
  const previous = health.flow[1];
  const before = (value: number | undefined): string =>
    value === undefined ? 'no preceding period recorded' : `previous period ${value}`;

  return {
    title: 'Queue health',
    caption: `${health.clipped.unprocessed} unprocessed clipped items, in a queue of ${health.all.unprocessed}. Read from GlassFrog just now; nothing was written.`,
    lines: [
      {
        label: 'Age since capture (clipped p90)',
        value: days(capture.p90Days),
        note: `median ${days(capture.medianDays)} · oldest ${days(capture.maxDays)} · threshold p90 ${AGE_P90_THRESHOLD_DAYS}d, none past ${AGE_MAX_THRESHOLD_DAYS}d`,
        verdict:
          capture.p90Days === null ? 'unjudged' : health.breaches.length === 0 ? 'pass' : 'fail',
      },
      {
        label: 'Age since last touch (clipped p90)',
        value: days(touch.p90Days),
        note: `median ${days(touch.medianDays)} · oldest ${days(touch.maxDays)} · reported, never thresholded: GlassFrog moves this for any edit, so sharpening an item and fixing a typo look the same`,
      },
      {
        label: 'Whole unprocessed queue (p90 since capture)',
        value: days(wholeQueue.p90Days),
        note: `median ${days(wholeQueue.medianDays)} · oldest ${days(wholeQueue.maxDays)} · shown because a clipped sample this small is unreadable alone`,
      },
      {
        label: 'Clipped items filed this period',
        value: `${flow?.inflow ?? 0}`,
        note: `Inflow · ${before(previous?.inflow)} · the capture path exists to raise this`,
      },
      {
        label: 'Clipped items processed this period',
        value: `${flow?.outflow ?? 0}`,
        note: `Outflow · ${before(previous?.outflow)} · reported as its own count, because a ratio hides which of the two moved (issue #38)`,
      },
      {
        label: 'Triage survival',
        value: percent(health.survival.rate),
        note: `${health.survival.processed} processed, ${health.survival.archived} archived · a tripwire for outright deletion only, never read alone: on a stalled backlog it reads 100%`,
      },
    ],
  };
}
