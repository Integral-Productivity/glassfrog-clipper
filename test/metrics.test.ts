import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYSTROKE_FAILURE_THRESHOLD,
  MINIMUM_CAPTURES,
  OPEN_RECORD_SETTLES_AFTER_MS,
  POPUP_ABANDONMENT_THRESHOLD,
  STRUCTURE_AT_CAPTURE_THRESHOLD,
  TIME_TO_CAPTURE_P95_MS,
  captureMetrics,
  settle,
} from '../src/metrics.ts';
import type { CaptureRecord } from '../src/telemetry.ts';

/**
 * STRATEGY.md's first three metrics, with the thresholds OQ8 settled.
 *
 * The assertions that matter most are the ones about *not* reaching a verdict.
 * A metric judged on four captures is noise wearing a threshold's clothes, and
 * an unjudged metric reported as passing is the failure mode this whole issue
 * exists to remove.
 */

const NOW = Date.parse('2026-08-31T12:00:00.000Z');
const MINUTE = 60 * 1000;

const at = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

let seq = 0;
function record(over: Partial<CaptureRecord> = {}): CaptureRecord {
  seq += 1;
  return {
    id: `cap_${seq}`,
    path: 'keystroke',
    startedAt: at(60 * MINUTE),
    outcome: 'filed',
    durationMs: 400,
    ...over,
  };
}

/** Enough filed captures to clear the "at least 20" gate. */
const twentyFiled = (over: Partial<CaptureRecord> = {}): CaptureRecord[] =>
  Array.from({ length: MINIMUM_CAPTURES }, () => record(over));

/* ------------------------------------------------------------- settling -- */

test('an invocation still inside the grace period is not counted at all', () => {
  const open = record({ outcome: undefined, startedAt: at(MINUTE) });
  assert.equal(settle(open, NOW), undefined, 'it may yet succeed; guessing would be worse than waiting');
});

test('a stale open keystroke settles as a failure, not as an abandonment', () => {
  // Nothing about a keystroke can be abandoned — it asks nothing. An invocation
  // that never reached an outcome is a capture that did not file, which is the
  // exact defect the 1% threshold exists to catch.
  const stale = record({ outcome: undefined, startedAt: at(OPEN_RECORD_SETTLES_AFTER_MS + MINUTE) });
  assert.equal(settle(stale, NOW)?.outcome, 'failed');
});

test('a stale open popup settles as an abandonment', () => {
  const stale = record({
    path: 'popup',
    outcome: undefined,
    startedAt: at(OPEN_RECORD_SETTLES_AFTER_MS + MINUTE),
  });
  assert.equal(settle(stale, NOW)?.outcome, 'abandoned');
});

test('an already-settled record is returned untouched', () => {
  const filed = record({ outcome: 'filed' });
  assert.equal(settle(filed, NOW)?.outcome, 'filed');
});

/* --------------------------------------------------------- the 20 gate  -- */

test('below twenty captures nothing is judged, and unjudged is not "passing"', () => {
  const metrics = captureMetrics([record()], { now: NOW });

  assert.equal(metrics.sufficient, false);
  assert.equal(metrics.timeToCapture.meets, null);
  assert.equal(metrics.keystrokeFailure.meets, null);
  assert.equal(metrics.popupAbandonment.meets, null);
  assert.equal(metrics.structureAtCapture.meets, null);
});

test('the measured values are still reported below the gate', () => {
  // Not judging is not the same as not measuring. A practitioner watching the
  // number climb towards the gate needs to see it.
  const metrics = captureMetrics([record({ durationMs: 1234 })], { now: NOW });
  assert.equal(metrics.timeToCapture.value, 1234);
  assert.equal(metrics.captures, 1);
});

test('twenty filed captures open the gate', () => {
  const metrics = captureMetrics(twentyFiled(), { now: NOW });
  assert.equal(metrics.sufficient, true);
  assert.notEqual(metrics.timeToCapture.meets, null);
});

/* ------------------------------------------------------ time-to-capture -- */

test('time-to-capture is judged on the keystroke path alone', () => {
  const records = [
    ...twentyFiled({ durationMs: 300 }),
    // A popup capture the practitioner deliberated over for half a minute.
    record({ path: 'popup', durationMs: 30_000 }),
  ];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.timeToCapture.value, 300, 'the popup duration is not in the judged number');
  assert.equal(metrics.timeToCapture.meets, true);
  assert.equal(metrics.popup.timeToCapture.p95Ms, 30_000, 'but it is still recorded');
});

test('a keystroke p95 over two seconds fails', () => {
  const records = twentyFiled({ durationMs: 300 });
  records[0] = record({ durationMs: TIME_TO_CAPTURE_P95_MS + 1 });
  records[1] = record({ durationMs: TIME_TO_CAPTURE_P95_MS + 1 });
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.timeToCapture.value, TIME_TO_CAPTURE_P95_MS + 1);
  assert.equal(metrics.timeToCapture.meets, false);
});

test('exactly two seconds passes — the threshold is an upper bound, not a limit', () => {
  const metrics = captureMetrics(twentyFiled({ durationMs: TIME_TO_CAPTURE_P95_MS }), { now: NOW });
  assert.equal(metrics.timeToCapture.meets, true);
});

test('only filed captures carry a time-to-capture', () => {
  // The measure is "invoking the extension to a filed item". A failure has no
  // endpoint, so timing it would measure how fast the extension gives up.
  const records = [...twentyFiled(), record({ outcome: 'failed', durationMs: 90_000 })];
  const metrics = captureMetrics(records, { now: NOW });
  assert.equal(metrics.keystroke.timeToCapture.samples, MINIMUM_CAPTURES);
});

/* ------------------------------------------------------------- failures -- */

test('keystroke failure rate is failures over attempts that reached an outcome', () => {
  const records = [...twentyFiled(), record({ outcome: 'failed' })];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.keystrokeFailure.value, 1 / (MINIMUM_CAPTURES + 1));
  assert.equal(metrics.keystrokeFailure.meets, false, 'one in twenty-one is above 1%');
});

test('a held capture is not a failure', () => {
  // R9 parking a capture because the extension is unconfigured is the guard
  // working. Counting it would push the extension towards filing rather than
  // saying it cannot.
  const records = [...twentyFiled(), record({ outcome: 'held' })];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.keystroke.held, 1);
  assert.equal(metrics.keystrokeFailure.value, 0);
  assert.equal(metrics.keystrokeFailure.meets, true);
});

test('an unreadable tab is not a failure either', () => {
  // OQ7: refusing to file an empty tension is the correct behaviour.
  const records = [...twentyFiled(), record({ outcome: 'unreadable-tab' })];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.keystroke.unreadableTab, 1);
  assert.equal(metrics.keystrokeFailure.value, 0);
});

test('the failure threshold is one percent', () => {
  assert.equal(KEYSTROKE_FAILURE_THRESHOLD, 0.01);
});

/* ---------------------------------------------------------- abandonment -- */

test('popup abandonment is abandoned over abandoned plus filed', () => {
  const records = [
    ...twentyFiled({ path: 'popup' }),
    ...Array.from({ length: 8 }, () => record({ path: 'popup', outcome: 'abandoned' })),
  ];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.popupAbandonment.value, 8 / 28);
  assert.equal(metrics.popupAbandonment.meets, true, '28.6% is inside the 30% threshold');
});

test('one more abandonment tips it over thirty percent', () => {
  const records = [
    ...twentyFiled({ path: 'popup' }),
    ...Array.from({ length: 9 }, () => record({ path: 'popup', outcome: 'abandoned' })),
  ];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.popupAbandonment.value, 9 / 29);
  assert.ok((metrics.popupAbandonment.value as number) > POPUP_ABANDONMENT_THRESHOLD);
  assert.equal(metrics.popupAbandonment.meets, false);
});

test('an abandoned keystroke is impossible and never counted as abandonment', () => {
  const records = [...twentyFiled(), record({ path: 'keystroke', outcome: 'abandoned' })];
  const metrics = captureMetrics(records, { now: NOW });
  assert.equal(metrics.popupAbandonment.value, null, 'the popup path saw nothing at all');
});

/* ---------------------------------------------------- structure-at-capture */

test('structure counts a role the practitioner chose, or a work type', () => {
  const records = [
    ...Array.from({ length: 15 }, () => record()),
    ...Array.from({ length: 5 }, () => record({ roleSet: true })),
  ];
  const metrics = captureMetrics(records, { now: NOW });

  assert.equal(metrics.structureAtCapture.filed, 20);
  assert.equal(metrics.structureAtCapture.structured, 5);
  assert.equal(metrics.structureAtCapture.value, 0.25);
  assert.equal(metrics.structureAtCapture.meets, true, 'the threshold is at-least, so 25% passes');
});

test('a work type alone is structure', () => {
  const records = [...Array.from({ length: 19 }, () => record()), record({ workTypeSet: true })];
  const metrics = captureMetrics(records, { now: NOW });
  assert.equal(metrics.structureAtCapture.structured, 1);
});

test('below a quarter, the positioning is the thing that failed', () => {
  // STRATEGY.md: below this the optional path is not reachable enough and
  // "never discard" is aspirational.
  const records = [
    ...Array.from({ length: 19 }, () => record()),
    ...Array.from({ length: 1 }, () => record({ roleSet: true })),
  ];
  const metrics = captureMetrics(records, { now: NOW });
  assert.ok((metrics.structureAtCapture.value as number) < STRUCTURE_AT_CAPTURE_THRESHOLD);
  assert.equal(metrics.structureAtCapture.meets, false);
});

test('structure is measured over filed items only', () => {
  const records = [...twentyFiled(), record({ outcome: 'abandoned', roleSet: true, path: 'popup' })];
  const metrics = captureMetrics(records, { now: NOW });
  assert.equal(metrics.structureAtCapture.filed, MINIMUM_CAPTURES, 'an abandoned capture filed no structure');
});

/* ---------------------------------------------------------- the window  -- */

test('records outside the rolling window are excluded', () => {
  const records = [
    ...twentyFiled(),
    record({ startedAt: new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString() }),
  ];
  const metrics = captureMetrics(records, { now: NOW });
  assert.equal(metrics.captures, MINIMUM_CAPTURES);
});

test('a record with an unreadable timestamp is dropped rather than trusted', () => {
  const metrics = captureMetrics([record({ startedAt: 'not a date' })], { now: NOW });
  assert.equal(metrics.captures, 0);
});

test('the window is reported so a reader can see what was judged', () => {
  const metrics = captureMetrics([], { now: NOW, windowDays: 30 });
  assert.equal(metrics.window.days, 30);
  assert.equal(metrics.window.to, new Date(NOW).toISOString());
});

test('an empty log reports nulls throughout and reaches no verdict', () => {
  const metrics = captureMetrics([], { now: NOW });
  assert.equal(metrics.captures, 0);
  assert.equal(metrics.timeToCapture.value, null);
  assert.equal(metrics.structureAtCapture.meets, null);
});
