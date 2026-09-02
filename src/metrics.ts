/**
 * The three extension-telemetry metrics from STRATEGY.md, aggregated.
 *
 * Pure: handed records and an instant, it returns numbers. It never reads
 * storage, so every threshold and every edge of the window can be exercised
 * exactly rather than approximately.
 *
 * STRATEGY.md judges these over a rolling 30 days with at least 20 captures,
 * and splits time-to-capture and abandonment *by path* rather than measuring
 * across both. That split is the point: the keystroke path is the flow claim
 * and is thresholded, while the popup path is recorded and not, because human
 * deliberation dominates it and would make a slow number look like a slow tool.
 */
import type { CaptureRecord, CapturePath } from './telemetry.ts';

export const METRIC_WINDOW_DAYS = 30;

/** STRATEGY.md: below this the window is reported but no verdict is reached. */
export const MINIMUM_CAPTURES = 20;

/** Keystroke path only. */
export const TIME_TO_CAPTURE_P95_MS = 2000;

/** "A keystroke that does not file is a defect, not a preference." */
export const KEYSTROKE_FAILURE_THRESHOLD = 0.01;

export const POPUP_ABANDONMENT_THRESHOLD = 0.3;

/** The falsification test for Positioning. Below it, "never discard" is aspirational. */
export const STRUCTURE_AT_CAPTURE_THRESHOLD = 0.25;

/**
 * How long an invocation may stay open before it is read as settled.
 *
 * An MV3 worker can be destroyed between a capture starting and its outcome
 * being written, so "no outcome" is ambiguous: still happening, or lost. Inside
 * this grace period the record is excluded from every denominator rather than
 * guessed at; past it, the two paths settle differently — see `settle`.
 */
export const OPEN_RECORD_SETTLES_AFTER_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nearest-rank, not interpolated, and shared with src/queue-health.ts so that
 * every percentile STRATEGY.md names — p50 and p95 here, p90 there — is the
 * same kind of number. Returns null for an empty sample: "nothing to measure"
 * must never render as zero, which for a latency reads as instantaneous.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

/**
 * A measured value against its threshold.
 *
 * `meets: null` means *not judged* — too few captures, or nothing to measure.
 * Keeping that distinct from `false` matters: an unjudged metric reported as
 * failing invites a fix for a problem nobody has observed, and reported as
 * passing is worse.
 */
export interface Verdict {
  value: number | null;
  threshold: number;
  direction: 'at-most' | 'at-least';
  meets: boolean | null;
}

export interface PathMetrics {
  path: CapturePath;
  /** Settled invocations. Records still inside the grace period are excluded. */
  invocations: number;
  filed: number;
  failed: number;
  held: number;
  abandoned: number;
  unreadableTab: number;
  open: number;
  timeToCapture: { p50Ms: number | null; p95Ms: number | null; samples: number };
}

export interface StructureVerdict extends Verdict {
  filed: number;
  structured: number;
}

export interface CaptureMetrics {
  window: { days: number; from: string; to: string };
  /** Filed items across both paths — the count STRATEGY.md's "at least 20" gates on. */
  captures: number;
  sufficient: boolean;
  keystroke: PathMetrics;
  popup: PathMetrics;
  /** Keystroke p95 only. The popup's own number is in `popup.timeToCapture`, unjudged. */
  timeToCapture: Verdict;
  keystrokeFailure: Verdict;
  popupAbandonment: Verdict;
  structureAtCapture: StructureVerdict;
}

export interface MetricsOptions {
  now?: number;
  windowDays?: number;
  minimumCaptures?: number;
}

/**
 * Resolves what an invocation with no recorded outcome should count as.
 *
 * The two paths settle differently on purpose. A popup that closed without
 * filing is the definition of abandonment, and is the number STRATEGY.md
 * thresholds at 30%. A keystroke has no equivalent — nothing about it can be
 * abandoned, because it asks nothing — so a keystroke invocation that never
 * reached an outcome is a capture that did not file, which is exactly the
 * defect the 1% threshold is set against. Reading it as anything softer would
 * hide worker deaths inside the one metric meant to catch them.
 */
export function settle(record: CaptureRecord, now: number): CaptureRecord | undefined {
  if (record.outcome) return record;
  const started = Date.parse(record.startedAt);
  if (Number.isNaN(started)) return undefined;
  if (now - started < OPEN_RECORD_SETTLES_AFTER_MS) return undefined;
  return { ...record, outcome: record.path === 'popup' ? 'abandoned' : 'failed' };
}

function pathMetrics(
  path: CapturePath,
  settled: readonly CaptureRecord[],
  open: number,
): PathMetrics {
  const of = (outcome: CaptureRecord['outcome']): number =>
    settled.filter((r) => r.outcome === outcome).length;

  // Only a filed item has a meaningful time-to-capture: the measure is
  // "invoking the extension to a filed item", so a failure has no endpoint.
  const durations = settled
    .filter((r) => r.outcome === 'filed' && typeof r.durationMs === 'number')
    .map((r) => r.durationMs as number);

  return {
    path,
    invocations: settled.length,
    filed: of('filed'),
    failed: of('failed'),
    held: of('held'),
    abandoned: of('abandoned'),
    unreadableTab: of('unreadable-tab'),
    open,
    timeToCapture: {
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      samples: durations.length,
    },
  };
}

function verdict(
  value: number | null,
  threshold: number,
  direction: 'at-most' | 'at-least',
  judged: boolean,
): Verdict {
  if (!judged || value === null) return { value, threshold, direction, meets: null };
  return {
    value,
    threshold,
    direction,
    meets: direction === 'at-most' ? value <= threshold : value >= threshold,
  };
}

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export function captureMetrics(
  records: readonly CaptureRecord[],
  options: MetricsOptions = {},
): CaptureMetrics {
  const now = options.now ?? Date.now();
  const windowDays = options.windowDays ?? METRIC_WINDOW_DAYS;
  const minimum = options.minimumCaptures ?? MINIMUM_CAPTURES;
  const from = now - windowDays * DAY_MS;

  const inWindow = records.filter((record) => {
    const at = Date.parse(record.startedAt);
    return !Number.isNaN(at) && at > from && at <= now;
  });

  const byPath = (path: CapturePath): PathMetrics => {
    const ours = inWindow.filter((r) => r.path === path);
    const settled = ours.map((r) => settle(r, now)).filter((r): r is CaptureRecord => r !== undefined);
    return pathMetrics(path, settled, ours.length - settled.length);
  };

  const keystroke = byPath('keystroke');
  const popup = byPath('popup');

  const captures = keystroke.filed + popup.filed;
  const sufficient = captures >= minimum;

  const filedRecords = inWindow
    .map((r) => settle(r, now))
    .filter((r): r is CaptureRecord => r?.outcome === 'filed');
  const structured = filedRecords.filter((r) => r.roleSet === true || r.workTypeSet === true).length;

  return {
    window: { days: windowDays, from: new Date(from).toISOString(), to: new Date(now).toISOString() },
    captures,
    sufficient,
    keystroke,
    popup,
    timeToCapture: verdict(keystroke.timeToCapture.p95Ms, TIME_TO_CAPTURE_P95_MS, 'at-most', sufficient),
    // Held and unreadable-tab are left out of both denominators below. Each is a
    // guard working correctly — R9 parking a capture, OQ7 refusing to file an
    // empty one — and counting a working guard as a failure would push the
    // extension towards filing something rather than saying it cannot.
    keystrokeFailure: verdict(
      rate(keystroke.failed, keystroke.filed + keystroke.failed),
      KEYSTROKE_FAILURE_THRESHOLD,
      'at-most',
      sufficient,
    ),
    popupAbandonment: verdict(
      rate(popup.abandoned, popup.filed + popup.abandoned),
      POPUP_ABANDONMENT_THRESHOLD,
      'at-most',
      sufficient,
    ),
    structureAtCapture: {
      ...verdict(
        rate(structured, filedRecords.length),
        STRUCTURE_AT_CAPTURE_THRESHOLD,
        'at-least',
        sufficient,
      ),
      filed: filedRecords.length,
      structured,
    },
  };
}
