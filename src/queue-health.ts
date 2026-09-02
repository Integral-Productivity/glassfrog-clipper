/**
 * STRATEGY.md's fourth metric, computed from what GlassFrog will tell us.
 *
 * This module is pure. It is handed tension records and returns numbers; the
 * reading lives behind the QueueReader port so the whole measure can be tested
 * without a network, and so the one place that knows the SDK stays src/glassfrog.ts.
 *
 * [ADR 0006](../docs/adr/0006-queue-health-is-measured-from-capture-not-from-last-touch.md)
 * is the specification. Its load-bearing claim is not "measure age" but *which
 * clock carries the threshold*. Measured live on 2026-08-31 the practitioner's
 * queue read p90 662 days since capture and 38 days since last touch, because
 * an inbox-processing pass had touched every aged item without resolving one.
 * A touch-clock threshold would therefore have reported a queue with five items
 * past a year as immaculate — reproducing, one level down, the exact failure
 * issue #19 was filed about.
 *
 * The Breach type below can only name the capture clock. That is deliberate:
 * the constraint is expressed in the type system, not only in a test.
 */
import { PROVENANCE_MARKER } from './compose.ts';
import { percentile } from './metrics.ts';
import type { RoleSummary } from './storage.ts';

/** ADR 0006. Applies to clipped items; the whole queue is reported beside them. */
export const AGE_P90_THRESHOLD_DAYS = 90;
export const AGE_MAX_THRESHOLD_DAYS = 180;

/** STRATEGY.md judges triage over a rolling 90 days rather than 30. */
export const TRIAGE_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * v5 auto-computes `unprocessed`/`processed` from associations and accepts only
 * `archived` from a client — so "processed" means a meeting actually touched
 * it, which is what makes survival meaningful at all.
 */
export type TensionStatus = 'unprocessed' | 'processed' | 'archived';

/** The subset of a GlassFrog tension this measure needs. Nothing else is read. */
export interface TensionRecord {
  id: string;
  body: string | null;
  status: TensionStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The narrow port the report reads through, mirroring CaptureWriter on the
 * write side. Substituting a fake here is what lets the computation be tested
 * exhaustively; src/glassfrog.ts's implementation is tested separately against
 * a real local HTTP server, because a fake cannot prove what goes on the wire.
 */
export interface QueueReader {
  /** Every tension visible across the circle tree rooted at `roleId`. */
  listCircleTree(roleId: string): Promise<TensionRecord[]>;
}

/**
 * ADR 0004 puts the provenance marker at the *head* of the body, which is what
 * lets this match be anchored rather than a substring search. Anchoring
 * matters: a practitioner writing a tension *about* the clipper would otherwise
 * be counted as having been clipped by it, inflating every rate here.
 */
export function isClipped(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.trimStart().startsWith(PROVENANCE_MARKER);
}

/**
 * Nearest-rank, defined once in src/metrics.ts and shared, so the p90 here and
 * the p50/p95 there are the same kind of number.
 *
 * On a queue of fifteen items an interpolated p90 would invent a value no item
 * has, and the point of this measure is to name a real item sitting in a real
 * backlog. Re-exported because this module's own tests and readers reason about
 * p90 without caring where the arithmetic lives.
 */
export { percentile };

export interface AgeReport {
  count: number;
  medianDays: number | null;
  p90Days: number | null;
  maxDays: number | null;
}

/**
 * Both clocks, always together. ADR 0006 keeps the touch clock because an item
 * never looked at and an item reworked repeatedly but never resolved are
 * different failures with different remedies — a distinction the capture clock
 * alone cannot draw. It is reported, never thresholded: GlassFrog moves
 * `updated_at` for any edit, so sharpening a tension and fixing a typo are the
 * same event to it.
 */
export interface ClockPair {
  sinceCapture: AgeReport;
  sinceTouch: AgeReport;
}

export interface Cohort {
  total: number;
  unprocessed: number;
  age: ClockPair;
}

export interface FlowPeriod {
  from: string;
  to: string;
  /** Clipped items captured in this period. */
  inflow: number;
  /** Clipped items resolved in this period, as its own number (issue #38). */
  outflow: number;
}

/**
 * `clock` admits one value on purpose. A touch-clock breach is not a case this
 * report declines to emit — it is a state that cannot be constructed.
 */
export interface Breach {
  clock: 'capture';
  rule: 'p90' | 'max';
  observedDays: number;
  thresholdDays: number;
}

export interface SurvivalReport {
  processed: number;
  archived: number;
  /** Resolved clipped items only. An unprocessed item has survived nothing yet. */
  total: number;
  /**
   * No threshold accompanies this. STRATEGY.md retains survival solely as a
   * tripwire for outright deletion and marks it never read alone: on a stalled
   * backlog nothing is deleted, so it reads 100% while the queue rots.
   */
  rate: number | null;
}

export interface QueueHealth {
  measuredAt: string;
  rootRoleId?: string;
  clipped: Cohort;
  all: Cohort;
  survival: SurvivalReport;
  flow: FlowPeriod[];
  breaches: Breach[];
}

export interface QueueHealthOptions {
  now?: number;
  periodDays?: number;
  periods?: number;
  rootRoleId?: string;
}

const ageInDays = (iso: string, now: number): number | undefined => {
  const at = Date.parse(iso);
  // An unparseable timestamp is dropped rather than counted as age zero, which
  // would quietly pull the whole distribution towards "fresh".
  return Number.isNaN(at) ? undefined : Math.floor((now - at) / DAY_MS);
};

function ageReport(values: readonly number[]): AgeReport {
  return {
    count: values.length,
    medianDays: percentile(values, 0.5),
    p90Days: percentile(values, 0.9),
    maxDays: values.length === 0 ? null : Math.max(...values),
  };
}

function cohort(records: readonly TensionRecord[], now: number): Cohort {
  const open = records.filter((r) => r.status === 'unprocessed');
  const capture: number[] = [];
  const touch: number[] = [];
  for (const record of open) {
    const c = ageInDays(record.createdAt, now);
    const t = ageInDays(record.updatedAt, now);
    if (c !== undefined) capture.push(c);
    if (t !== undefined) touch.push(t);
  }
  return {
    total: records.length,
    unprocessed: open.length,
    age: { sinceCapture: ageReport(capture), sinceTouch: ageReport(touch) },
  };
}

/**
 * Thresholds read the capture clock and only the capture clock. Nothing in this
 * function has access to a touch age, which is why the guarantee holds by
 * construction rather than by remembering.
 */
function breaches(sinceCapture: AgeReport): Breach[] {
  const found: Breach[] = [];
  if (sinceCapture.p90Days !== null && sinceCapture.p90Days > AGE_P90_THRESHOLD_DAYS) {
    found.push({
      clock: 'capture',
      rule: 'p90',
      observedDays: sinceCapture.p90Days,
      thresholdDays: AGE_P90_THRESHOLD_DAYS,
    });
  }
  if (sinceCapture.maxDays !== null && sinceCapture.maxDays > AGE_MAX_THRESHOLD_DAYS) {
    found.push({
      clock: 'capture',
      rule: 'max',
      observedDays: sinceCapture.maxDays,
      thresholdDays: AGE_MAX_THRESHOLD_DAYS,
    });
  }
  return found;
}

function survivalOf(clipped: readonly TensionRecord[]): SurvivalReport {
  const processed = clipped.filter((r) => r.status === 'processed').length;
  const archived = clipped.filter((r) => r.status === 'archived').length;
  const total = processed + archived;
  return { processed, archived, total, rate: total === 0 ? null : processed / total };
}

/**
 * Inflow keys on capture, outflow on resolution, so an item can fall in neither
 * term or in only one. Both are reported as counts rather than as a single
 * ratio because a ratio hides which term moved — the gap issue #38 tracks,
 * where a breached age threshold cannot distinguish the capture path
 * over-producing from a lapsed meeting cadence.
 */
function flowOf(
  clipped: readonly TensionRecord[],
  now: number,
  periodDays: number,
  periods: number,
): FlowPeriod[] {
  const out: FlowPeriod[] = [];
  for (let i = 0; i < periods; i += 1) {
    const to = now - i * periodDays * DAY_MS;
    const from = to - periodDays * DAY_MS;
    const within = (iso: string): boolean => {
      const at = Date.parse(iso);
      return !Number.isNaN(at) && at > from && at <= to;
    };
    out.push({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      inflow: clipped.filter((r) => within(r.createdAt)).length,
      outflow: clipped.filter((r) => r.status !== 'unprocessed' && within(r.updatedAt)).length,
    });
  }
  return out;
}

export function queueHealth(
  records: readonly TensionRecord[],
  options: QueueHealthOptions = {},
): QueueHealth {
  const now = options.now ?? Date.now();
  const periodDays = options.periodDays ?? TRIAGE_WINDOW_DAYS;
  // Two by default, not one. The rule for reading a breached age threshold
  // compares the trailing period against the preceding one (issue #38), and a
  // report that produced a single period would make that rule unusable at the
  // moment it is needed.
  const periods = options.periods ?? 2;

  const clipped = records.filter((r) => isClipped(r.body));
  const clippedCohort = cohort(clipped, now);

  return {
    measuredAt: new Date(now).toISOString(),
    ...(options.rootRoleId ? { rootRoleId: options.rootRoleId } : {}),
    clipped: clippedCohort,
    // Reported alongside because the clipped sample is currently about two
    // items, and two items in isolation say nothing about the queue they sit in.
    all: cohort(records, now),
    survival: survivalOf(clipped),
    flow: flowOf(clipped, now, periodDays, periods),
    breaches: breaches(clippedCohort.age.sinceCapture),
  };
}

/**
 * Which role the report reads from.
 *
 * The capture role's parent circle, so the whole-queue companion has a queue to
 * be a companion to — one role's own tensions would give the clipped subset and
 * almost nothing else. Falls back to the capture role itself when the parent is
 * unknown, which covers both the anchor role (`parentRoleId: null`) and a role
 * list cached before parents were read.
 */
export function resolveQueueRoot(
  roles: readonly RoleSummary[],
  captureRoleId: string,
): string {
  const role = roles.find((r) => r.id === captureRoleId);
  return role?.parentRoleId ?? captureRoleId;
}
