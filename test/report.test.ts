import test from 'node:test';
import assert from 'node:assert/strict';

import { captureMetrics } from '../src/metrics.ts';
import { queueHealth, type TensionRecord } from '../src/queue-health.ts';
import { formatCaptureMetrics, formatQueueHealth, type ReportSection } from '../src/report.ts';
import type { CaptureRecord } from '../src/telemetry.ts';

/**
 * The wording is part of the measure.
 *
 * ADR 0006's whole argument is that two numbers presented as peers mislead: a
 * touch-clock p90 sitting beside a capture-clock p90 with no caption reads as
 * corroboration when it is the opposite. The same goes for survival, which is
 * at its most flattering on the sickest queue. These tests pin the captions
 * that carry that meaning, so a later edit to the options page cannot quietly
 * drop them.
 */

const NOW = Date.parse('2026-08-31T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (d: number): string => new Date(NOW - d * DAY_MS).toISOString();

const line = (section: ReportSection, label: string): { value: string; note?: string; verdict?: string } => {
  const found = section.lines.find((l) => l.label === label);
  assert.ok(found, `expected a line labelled "${label}"`);
  return found;
};

/* --------------------------------------------------------- queue health -- */

const CAPTURE_AGES = [1, 2, 5, 12, 20, 30, 35, 38, 44, 60, 380, 400, 500, 662, 671];
const TOUCH_AGES = [1, 2, 3, 5, 10, 20, 28, 31, 33, 35, 36, 37, 38, 38, 38];

const liveQueue = (): TensionRecord[] =>
  CAPTURE_AGES.map((capture, i) => ({
    id: `ten_${i}`,
    body: '[glassfrog-clipper] a page',
    status: 'unprocessed' as const,
    createdAt: ago(capture),
    updatedAt: ago(TOUCH_AGES[i] as number),
  }));

test('the capture clock leads and is the line that carries the verdict', () => {
  const section = formatQueueHealth(queueHealth(liveQueue(), { now: NOW }));

  assert.equal(section.lines[0]?.label, 'Age since capture (clipped p90)');
  assert.equal(line(section, 'Age since capture (clipped p90)').verdict, 'fail');
  assert.equal(line(section, 'Age since capture (clipped p90)').value, '662d');
});

test('the touch clock is shown and explicitly captioned as unthresholded', () => {
  const section = formatQueueHealth(queueHealth(liveQueue(), { now: NOW }));
  const touch = line(section, 'Age since last touch (clipped p90)');

  assert.equal(touch.value, '38d');
  assert.equal(touch.verdict, undefined, 'no verdict, because there is no threshold');
  assert.match(touch.note ?? '', /never thresholded/);
});

test('the two clocks disagreeing by an order of magnitude is visible in one glance', () => {
  // This is the entire reason ADR 0006 exists. If a reader can see 662 and 38
  // side by side, the report has done its job.
  const section = formatQueueHealth(queueHealth(liveQueue(), { now: NOW }));
  assert.equal(line(section, 'Age since capture (clipped p90)').value, '662d');
  assert.equal(line(section, 'Age since last touch (clipped p90)').value, '38d');
});

test('the whole unprocessed queue is reported beside the clipped subset', () => {
  const records: TensionRecord[] = [
    { id: 'a', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(5), updatedAt: ago(5) },
    { id: 'b', body: 'by hand', status: 'unprocessed', createdAt: ago(900), updatedAt: ago(5) },
  ];
  const section = formatQueueHealth(queueHealth(records, { now: NOW }));

  assert.equal(line(section, 'Whole unprocessed queue (p90 since capture)').value, '900d');
  assert.match(section.caption, /1 unprocessed clipped items, in a queue of 2/);
});

test('inflow and outflow each get their own line (issue #38)', () => {
  const records: TensionRecord[] = [
    { id: 'in', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(2), updatedAt: ago(2) },
    { id: 'out', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(300), updatedAt: ago(3) },
  ];
  const section = formatQueueHealth(queueHealth(records, { now: NOW, periodDays: 30, periods: 1 }));

  assert.equal(line(section, 'Clipped items filed this period').value, '1');
  assert.equal(line(section, 'Clipped items processed this period').value, '1');
});

test('survival is last and is captioned as a tripwire', () => {
  const section = formatQueueHealth(queueHealth(liveQueue(), { now: NOW }));
  const survival = line(section, 'Triage survival');

  assert.equal(section.lines.at(-1)?.label, 'Triage survival', 'putting it first would answer the question early');
  assert.equal(survival.verdict, undefined);
  assert.match(survival.note ?? '', /never read alone/);
});

test('an empty queue renders dashes rather than zeroes', () => {
  // Zero days would read as "captured moments ago", which is the opposite of
  // "there is nothing here to measure".
  const section = formatQueueHealth(queueHealth([], { now: NOW }));
  assert.equal(line(section, 'Age since capture (clipped p90)').value, '—');
  assert.equal(line(section, 'Age since capture (clipped p90)').verdict, 'unjudged');
});

test('the queue-health caption says the read wrote nothing', () => {
  const section = formatQueueHealth(queueHealth([], { now: NOW }));
  assert.match(section.caption, /nothing was written/);
});

/* --------------------------------------------------------- capture metrics */

let seq = 0;
const filed = (over: Partial<CaptureRecord> = {}): CaptureRecord => {
  seq += 1;
  return {
    id: `cap_${seq}`,
    path: 'keystroke',
    startedAt: new Date(NOW - 60_000).toISOString(),
    outcome: 'filed',
    durationMs: 400,
    ...over,
  };
};

test('the capture section states plainly that nothing leaves the device', () => {
  // STRATEGY.md makes trust the adoption gate, so the practitioner should not
  // have to take the posture on faith from a README they will not read.
  const section = formatCaptureMetrics(captureMetrics([], { now: NOW }));
  assert.match(section.caption, /Recorded on this device only; nothing is sent anywhere/);
});

test('below the gate the caption says how many more captures are needed', () => {
  const section = formatCaptureMetrics(captureMetrics([filed()], { now: NOW }));
  assert.match(section.caption, /20 are needed before any of these is judged/);
  assert.equal(line(section, 'Structure at capture').verdict, 'unjudged');
});

test('the popup time-to-capture line is shown without a verdict', () => {
  const records = [
    ...Array.from({ length: 20 }, () => filed({ durationMs: 300 })),
    filed({ path: 'popup', durationMs: 25_000 }),
  ];
  const section = formatCaptureMetrics(captureMetrics(records, { now: NOW }));

  assert.equal(line(section, 'Time to capture (popup p95)').value, '25.00s');
  assert.equal(line(section, 'Time to capture (popup p95)').verdict, undefined);
  assert.equal(line(section, 'Time to capture (keystroke p95)').verdict, 'pass', 'the judged one is unaffected');
});

test('structure at capture is labelled as the falsification test', () => {
  const section = formatCaptureMetrics(captureMetrics([], { now: NOW }));
  assert.match(line(section, 'Structure at capture').note ?? '', /falsification test for the positioning/);
});

test('held captures are shown and named as outside the rates', () => {
  const section = formatCaptureMetrics(captureMetrics([filed({ outcome: 'held' })], { now: NOW }));
  assert.equal(line(section, 'Held for configuration').value, '1');
  assert.match(line(section, 'Held for configuration').note ?? '', /Outside every rate/);
});

test('a failing keystroke p95 renders as a failure', () => {
  const section = formatCaptureMetrics(
    captureMetrics(Array.from({ length: 20 }, () => filed({ durationMs: 3000 })), { now: NOW }),
  );
  assert.equal(line(section, 'Time to capture (keystroke p95)').value, '3.00s');
  assert.equal(line(section, 'Time to capture (keystroke p95)').verdict, 'fail');
});

test('the preceding period is shown beside each count, and neither becomes a ratio', () => {
  // Issue #38's rule reads the trailing period against the preceding one. A
  // report producing only the trailing period would make that rule unusable at
  // exactly the moment a breach calls for it.
  const records: TensionRecord[] = [
    { id: 'now_in', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(10), updatedAt: ago(10) },
    { id: 'then_in', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(120), updatedAt: ago(100) },
  ];
  const section = formatQueueHealth(queueHealth(records, { now: NOW, periodDays: 90, periods: 2 }));

  assert.equal(line(section, 'Clipped items filed this period').value, '1');
  assert.match(line(section, 'Clipped items filed this period').note ?? '', /previous period 1/);
  assert.match(line(section, 'Clipped items processed this period').note ?? '', /previous period 1/);
});

test('the queue-health report defaults to two periods, so the rule is computable', () => {
  assert.equal(queueHealth([], { now: NOW }).flow.length, 2);
});
