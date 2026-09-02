import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGE_MAX_THRESHOLD_DAYS,
  AGE_P90_THRESHOLD_DAYS,
  type TensionRecord,
  isClipped,
  percentile,
  queueHealth,
  resolveQueueRoot,
} from '../src/queue-health.ts';

/**
 * ADR 0006 is the specification this file enforces.
 *
 * The decision it records is not "add an age measure" — it is *which clock the
 * threshold runs on*. A touch-clock measure reports the practitioner's real
 * queue as immaculate while five items sit past a year, which is the exact
 * defect issue #19 was filed to fix. Every threshold assertion below is
 * therefore written against the capture clock, and there is a test whose only
 * job is to prove the touch clock can never produce a breach.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fixed so ages are exact. Every test measures relative to this instant. */
const NOW = Date.parse('2026-08-31T00:00:00.000Z');

const ago = (days: number): string => new Date(NOW - days * DAY_MS).toISOString();

function unprocessed(
  id: string,
  captureAgeDays: number,
  touchAgeDays: number,
  body = '[glassfrog-clipper] a page',
): TensionRecord {
  return {
    id,
    body,
    status: 'unprocessed',
    createdAt: ago(captureAgeDays),
    updatedAt: ago(touchAgeDays),
  };
}

/**
 * The queue as measured live on 2026-08-31 and recorded in ADR 0006: fifteen
 * unprocessed tensions, five past a year, every one of them touched by an
 * inbox-processing pass a month ago without being resolved.
 *
 *   since created_at — median 38 d, p90 662 d, max 671 d
 *   since updated_at — median 31 d, p90  38 d, max  38 d
 *
 * Paired index-wise so no item is touched before it was created.
 */
const CAPTURE_AGES = [1, 2, 5, 12, 20, 30, 35, 38, 44, 60, 380, 400, 500, 662, 671];
const TOUCH_AGES = [1, 2, 3, 5, 10, 20, 28, 31, 33, 35, 36, 37, 38, 38, 38];

const liveQueue = (): TensionRecord[] =>
  CAPTURE_AGES.map((captureAge, i) => unprocessed(`ten_${i}`, captureAge, TOUCH_AGES[i] as number));

/* ------------------------------------------------------------ percentile -- */

test('percentile uses nearest-rank, so a small sample never interpolates a value nobody has', () => {
  const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // ceil(0.9 * 10) = 9 -> the 9th smallest.
  assert.equal(percentile(sample, 0.9), 9);
  assert.equal(percentile(sample, 0.5), 5);
  assert.equal(percentile(sample, 1), 10);
});

test('percentile of an empty sample is null rather than zero', () => {
  // Zero would read as "perfectly fresh", which is the opposite of "unknown".
  assert.equal(percentile([], 0.9), null);
});

test('percentile does not depend on input order', () => {
  assert.equal(percentile([671, 1, 38], 0.9), percentile([1, 38, 671], 0.9));
});

/* --------------------------------------------------------------- clipped -- */

test('an item is clipped when the provenance marker leads its body (ADR 0004)', () => {
  assert.equal(isClipped('[glassfrog-clipper] A page\n\nhttps://example.test/'), true);
  assert.equal(isClipped('  [glassfrog-clipper] leading whitespace is not meaningful'), true);
});

test('a marker quoted inside a body does not make the item clipped', () => {
  // ADR 0004 puts the marker at the head of the field precisely so this match
  // can be anchored. A substring match would count a practitioner writing
  // *about* the clipper as having been clipped by it, inflating every rate.
  assert.equal(isClipped('We should check whether [glassfrog-clipper] marks these'), false);
});

test('an absent or empty body is not clipped', () => {
  assert.equal(isClipped(null), false);
  assert.equal(isClipped(''), false);
  assert.equal(isClipped(undefined), false);
});

/* ------------------------------------------------------------ two clocks -- */

test('the live 2026-08-31 queue reproduces both clocks from ADR 0006', () => {
  const health = queueHealth(liveQueue(), { now: NOW });

  assert.equal(health.clipped.age.sinceCapture.medianDays, 38);
  assert.equal(health.clipped.age.sinceCapture.p90Days, 662);
  assert.equal(health.clipped.age.sinceCapture.maxDays, 671);

  assert.equal(health.clipped.age.sinceTouch.medianDays, 31);
  assert.equal(health.clipped.age.sinceTouch.p90Days, 38);
  assert.equal(health.clipped.age.sinceTouch.maxDays, 38);
});

test('that queue breaches on the capture clock, which is the whole point of ADR 0006', () => {
  const health = queueHealth(liveQueue(), { now: NOW });

  const rules = health.breaches.map((b) => b.rule).sort();
  assert.deepEqual(rules, ['max', 'p90'], 'p90 662 > 90, and items sit past 180');
  assert.ok(health.breaches.every((b) => b.clock === 'capture'));
});

test('the same queue read on the touch clock alone would look immaculate', () => {
  // This is the defect, written down. Every touch age is inside both
  // thresholds, so a "days since last activity" measure reports full health on
  // a queue with five items past a year. The assertion exists so that anyone
  // tempted to swap the clocks has to delete a test that says why not.
  const health = queueHealth(liveQueue(), { now: NOW });
  const touch = health.clipped.age.sinceTouch;

  assert.ok((touch.p90Days as number) < AGE_P90_THRESHOLD_DAYS);
  assert.ok((touch.maxDays as number) < AGE_MAX_THRESHOLD_DAYS);
  assert.notEqual(health.breaches.length, 0, 'yet the report still fails, because it reads the capture clock');
});

test('no breach can ever originate from the touch clock', () => {
  // Constructed so the touch clock is catastrophic and the capture clock is
  // clean — impossible in practice, which is exactly why it isolates the rule.
  const records: TensionRecord[] = [
    { id: 'ten_a', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(5), updatedAt: ago(9000) },
  ];
  assert.deepEqual(queueHealth(records, { now: NOW }).breaches, []);
});

test('the touch clock is still reported, never dropped', () => {
  // ADR 0006 keeps it because an item never looked at and an item reworked
  // repeatedly but never resolved are different failures with different
  // remedies. Reporting one clock would collapse that distinction.
  const health = queueHealth(liveQueue(), { now: NOW });
  assert.equal(health.clipped.age.sinceTouch.count, 15);
});

/* ------------------------------------------------ clipped vs whole queue -- */

test('the whole unprocessed queue is reported alongside the clipped subset', () => {
  const records = [
    unprocessed('ten_clipped', 400, 30),
    unprocessed('ten_other', 700, 30, 'Filed straight into GlassFrog by hand'),
  ];
  const health = queueHealth(records, { now: NOW });

  assert.equal(health.clipped.unprocessed, 1);
  assert.equal(health.all.unprocessed, 2, 'a clipped sample of one is unreadable without this');
  assert.equal(health.all.age.sinceCapture.maxDays, 700);
  assert.equal(health.clipped.age.sinceCapture.maxDays, 400);
});

test('thresholds are judged on the clipped subset, not on the whole queue', () => {
  const records = [
    unprocessed('ten_clipped', 3, 3),
    unprocessed('ten_other', 900, 900, 'Not ours'),
  ];
  assert.deepEqual(queueHealth(records, { now: NOW }).breaches, []);
});

test('only unprocessed items are aged', () => {
  // A processed item has left the queue; ageing it would make working the
  // backlog look like letting it rot.
  const records: TensionRecord[] = [
    unprocessed('ten_open', 10, 10),
    { id: 'ten_done', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(900), updatedAt: ago(1) },
  ];
  const health = queueHealth(records, { now: NOW });

  assert.equal(health.clipped.total, 2);
  assert.equal(health.clipped.unprocessed, 1);
  assert.equal(health.clipped.age.sinceCapture.maxDays, 10);
  assert.deepEqual(health.breaches, []);
});

test('an empty queue reports nulls and no breach, not a clean bill of health', () => {
  const health = queueHealth([], { now: NOW });
  assert.equal(health.clipped.age.sinceCapture.p90Days, null);
  assert.equal(health.survival.rate, null);
  assert.deepEqual(health.breaches, []);
});

test('the 180-day rule fires on a single item even when p90 passes', () => {
  const records = [
    ...Array.from({ length: 9 }, (_, i) => unprocessed(`ten_fresh_${i}`, 1, 1)),
    unprocessed('ten_ancient', 200, 1),
  ];
  const health = queueHealth(records, { now: NOW });

  assert.equal(health.clipped.age.sinceCapture.p90Days, 1, 'p90 of ten items is the 9th, which is fresh');
  assert.deepEqual(
    health.breaches.map((b) => b.rule),
    ['max'],
    'the tail is exactly what p90 alone can miss at this sample size',
  );
});

/* -------------------------------------------------------------- survival -- */

test('survival is computed over resolved clipped items, archived counting against it', () => {
  const records: TensionRecord[] = [
    { id: 'a', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(10), updatedAt: ago(1) },
    { id: 'b', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(10), updatedAt: ago(1) },
    { id: 'c', body: '[glassfrog-clipper] x', status: 'archived', createdAt: ago(10), updatedAt: ago(1) },
    { id: 'd', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(10), updatedAt: ago(1) },
  ];
  const health = queueHealth(records, { now: NOW });

  assert.equal(health.survival.processed, 2);
  assert.equal(health.survival.archived, 1);
  assert.equal(health.survival.total, 3, 'unprocessed items have not survived anything yet');
  assert.equal(health.survival.rate, 2 / 3);
});

test('survival carries no threshold, because it is only a tripwire', () => {
  // STRATEGY.md retains it solely to catch outright deletion and marks it never
  // read alone. A threshold here would restore the false confidence ADR 0006
  // removed: on a stalled backlog nothing is deleted, so it reads 100%.
  const records: TensionRecord[] = [
    { id: 'a', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(10), updatedAt: ago(1) },
    ...liveQueue(),
  ];
  const health = queueHealth(records, { now: NOW });

  assert.equal(health.survival.rate, 1, 'a perfect survival rate…');
  assert.notEqual(health.breaches.length, 0, '…on a queue the report still fails');
});

/* ------------------------------------------------------------------ flow -- */

test('inflow and outflow are reported as separate numbers per period', () => {
  const records: TensionRecord[] = [
    { id: 'in1', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(3), updatedAt: ago(3) },
    { id: 'in2', body: '[glassfrog-clipper] x', status: 'unprocessed', createdAt: ago(4), updatedAt: ago(4) },
    { id: 'out1', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(200), updatedAt: ago(2) },
  ];
  const health = queueHealth(records, { now: NOW, periodDays: 30, periods: 1 });

  const [period] = health.flow;
  // Inflow is keyed on capture, outflow on resolution, so one item can sit in
  // neither term (captured long ago, still open) or in only one of them.
  assert.equal(period?.inflow, 2, 'out1 was captured 200 days ago, outside this period');
  assert.equal(period?.outflow, 1);
});

test('outflow stays visible when nothing came in (issue #38)', () => {
  // A ratio alone hides which term moved. A period that processed three items
  // and captured none is healthy; a ratio of 0/3 or 3/0 does not say which.
  const records: TensionRecord[] = [
    { id: 'out1', body: '[glassfrog-clipper] x', status: 'processed', createdAt: ago(300), updatedAt: ago(2) },
    { id: 'out2', body: '[glassfrog-clipper] x', status: 'archived', createdAt: ago(300), updatedAt: ago(5) },
  ];
  const health = queueHealth(records, { now: NOW, periodDays: 30, periods: 1 });

  const [period] = health.flow;
  assert.equal(period?.inflow, 0);
  assert.equal(period?.outflow, 2, 'reported on its own, not only inside a ratio');
});

test('flow counts only clipped items', () => {
  const records: TensionRecord[] = [
    { id: 'other', body: 'filed by hand', status: 'unprocessed', createdAt: ago(3), updatedAt: ago(3) },
  ];
  const health = queueHealth(records, { now: NOW, periodDays: 30, periods: 1 });
  assert.equal(health.flow[0]?.inflow, 0);
});

test('periods are contiguous and most-recent-first', () => {
  const health = queueHealth([], { now: NOW, periodDays: 30, periods: 3 });
  assert.equal(health.flow.length, 3);
  assert.equal(health.flow[0]?.to, new Date(NOW).toISOString());
  assert.equal(health.flow[0]?.from, health.flow[1]?.to, 'no gap between periods');
});

/* -------------------------------------------------------------- the root -- */

test('the queue root is the capture role\'s parent circle when one is known', () => {
  const roles = [{ id: 'role_child', name: 'Clipper Dev', parentRoleId: 'role_circle' }];
  assert.equal(resolveQueueRoot(roles, 'role_child'), 'role_circle');
});

test('the queue root falls back to the capture role when the parent is unknown', () => {
  // A role list cached before parents were read has no answer, and reading one
  // role\'s own tensions is strictly better than reading nothing.
  assert.equal(resolveQueueRoot([{ id: 'role_child', name: 'Clipper Dev' }], 'role_child'), 'role_child');
});

test('the anchor role is its own root', () => {
  // parentRoleId null means anchor. Walking past it has nowhere to go.
  const roles = [{ id: 'role_anchor', name: 'Anchor Circle', parentRoleId: null }];
  assert.equal(resolveQueueRoot(roles, 'role_anchor'), 'role_anchor');
});

test('an unknown capture role is still its own root', () => {
  assert.equal(resolveQueueRoot([], 'role_missing'), 'role_missing');
});
