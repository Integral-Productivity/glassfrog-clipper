import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TELEMETRY_FIELDS,
  TELEMETRY_MAX_RECORDS,
  TELEMETRY_RETENTION_DAYS,
  type CaptureRecord,
  attachTelemetrySession,
  clearTelemetry,
  readTelemetry,
  recordOutcome,
  recordStarted,
  sanitize,
  structureOf,
} from '../src/telemetry.ts';
import { STORAGE_KEYS, writeTelemetryLog } from '../src/storage.ts';
import type { Capture } from '../src/types.ts';
import { type FakeChrome, installFakeChrome } from './support/chrome.ts';

/**
 * R13 and the trust posture behind it.
 *
 * STRATEGY.md's Distribution & trust track makes trust the adoption gate, so
 * "no captured content in telemetry" is a product property rather than a
 * hygiene preference. The sentinel test below is the counterpart of the
 * wire-level assertions in test/glassfrog-adapter.test.ts: rather than checking
 * each field by name, it drives real captures through the recorder and then
 * greps the serialised log for text that must not be there.
 */

let harness: { chrome: FakeChrome; restore: () => void } | undefined;

function withChrome(t: { after(fn: () => void): void }): FakeChrome {
  harness = installFakeChrome();
  t.after(() => harness?.restore());
  return harness.chrome;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Distinctive enough that a substring search cannot miss them. */
const SENTINELS = {
  url: 'https://secret-intranet.example.test/quarterly-layoff-plan?token=zzz',
  title: 'CONFIDENTIAL Layoff Plan Q4',
  selection: 'The following twelve people will be let go in November.',
  apiKey: 'gf_live_supersecretkey_0123456789',
  note: 'My private thought about this page',
};

const sentinelCapture = (over: Partial<Capture> = {}): Capture => ({
  page: {
    url: SENTINELS.url,
    title: SENTINELS.title,
    selection: SENTINELS.selection,
    capturedAt: new Date().toISOString(),
  },
  note: SENTINELS.note,
  ...over,
});

/* ------------------------------------------------------------------- R13 -- */

test('R13: nothing a practitioner captured reaches the telemetry log', async (t) => {
  const chrome = withChrome(t);

  const capture = sentinelCapture({ roleId: 'role_chosen', workType: 'project' });
  await recordStarted({ id: 'cap_1', path: 'popup' });
  await recordOutcome('cap_1', 'filed', {
    durationMs: 800,
    structure: structureOf(capture, { captureRoleId: 'role_default' }),
  });

  const serialised = JSON.stringify(chrome.__dump());
  for (const [name, value] of Object.entries(SENTINELS)) {
    assert.equal(serialised.includes(value), false, `the ${name} must not appear in storage`);
  }
});

test('R13: the allowlist drops a field nobody sanctioned', async (t) => {
  const chrome = withChrome(t);

  // Simulates a future change that carelessly threads a page title through. The
  // allowlist is the layer that catches it without anyone remembering to.
  const smuggled = {
    id: 'cap_2',
    path: 'keystroke',
    startedAt: new Date().toISOString(),
    outcome: 'filed',
    pageTitle: SENTINELS.title,
  } as unknown as CaptureRecord;

  await writeTelemetryLog([smuggled]);
  await recordStarted({ id: 'cap_3', path: 'keystroke' });

  const serialised = JSON.stringify(chrome.__dump());
  assert.equal(serialised.includes(SENTINELS.title), false, 'the next write scrubs it');
  assert.equal(serialised.includes('pageTitle'), false);
});

test('R13: sanitize rejects a value of the wrong type in an allowlisted field', () => {
  // An allowlist that only checked names would happily store a page title in
  // `durationMs`, which is the shape a real leak would most plausibly take.
  const forged = {
    id: 'cap_4',
    path: 'keystroke',
    startedAt: '2026-08-31T00:00:00.000Z',
    durationMs: SENTINELS.title,
  } as unknown as CaptureRecord;

  assert.equal(sanitize(forged).durationMs, undefined);
});

test('R13: every allowlisted field is a timing, an outcome, or a boolean', () => {
  // A guard on the allowlist itself. Adding a field here is the moment to ask
  // whether it carries content, so the list is asserted rather than assumed.
  assert.deepEqual(
    [...TELEMETRY_FIELDS],
    ['id', 'path', 'startedAt', 'outcome', 'endedAt', 'durationMs', 'roleSet', 'workTypeSet', 'failureKind'],
  );
});

/* ------------------------------------------------------------- structure -- */

test('a role matching the configured default is not structure', async () => {
  // The popup pre-fills the picker with the configured capture role, so
  // counting "a role is present" would score every zero-decision capture as
  // structured and drive STRATEGY.md's falsification test towards 100% — a
  // measure that cannot fail is not a test.
  const capture = sentinelCapture({ roleId: 'role_default' });
  assert.deepEqual(structureOf(capture, { captureRoleId: 'role_default' }), {
    roleSet: false,
    workTypeSet: false,
  });
});

test('a role the practitioner changed is structure', () => {
  const capture = sentinelCapture({ roleId: 'role_other' });
  assert.equal(structureOf(capture, { captureRoleId: 'role_default' }).roleSet, true);
});

test('an unset work type is not structure, because a tension is the default (KD2)', () => {
  assert.equal(structureOf(sentinelCapture(), { captureRoleId: 'r' }).workTypeSet, false);
  assert.equal(
    structureOf(sentinelCapture({ workType: 'tension' }), { captureRoleId: 'r' }).workTypeSet,
    true,
    'choosing tension explicitly is still a choice',
  );
});

test('structureOf returns only booleans, whatever it is handed', () => {
  const result = structureOf(sentinelCapture({ roleId: 'role_x', workType: 'action' }), {});
  assert.deepEqual(Object.values(result).map((v) => typeof v), ['boolean', 'boolean']);
});

/* ---------------------------------------------------------- the lifecycle */

test('a started invocation is recorded with no outcome yet', async (t) => {
  withChrome(t);
  await recordStarted({ id: 'cap_a', path: 'popup' });

  const [record] = await readTelemetry();
  assert.equal(record?.id, 'cap_a');
  assert.equal(record?.path, 'popup');
  assert.equal(record?.outcome, undefined);
});

test('starting the same invocation twice does not duplicate it', async (t) => {
  withChrome(t);
  await recordStarted({ id: 'cap_a', path: 'popup' });
  await recordStarted({ id: 'cap_a', path: 'popup' });
  assert.equal((await readTelemetry()).length, 1);
});

test('an outcome closes the invocation and derives the duration', async (t) => {
  withChrome(t);
  const startedAt = new Date(Date.now() - 750).toISOString();
  await recordStarted({ id: 'cap_b', path: 'keystroke', startedAt });
  await recordOutcome('cap_b', 'filed');

  const [record] = await readTelemetry();
  assert.equal(record?.outcome, 'filed');
  assert.ok((record?.durationMs as number) >= 750);
});

test('the first outcome wins, so a closing popup cannot undo a filing', async (t) => {
  // The popup port disconnects after the worker has already recorded the file.
  // Letting the later event overwrite would turn every successful popup capture
  // into an abandonment.
  withChrome(t);
  await recordStarted({ id: 'cap_c', path: 'popup' });
  await recordOutcome('cap_c', 'filed', { durationMs: 500 });
  await recordOutcome('cap_c', 'abandoned');

  const [record] = await readTelemetry();
  assert.equal(record?.outcome, 'filed');
  assert.equal(record?.durationMs, 500);
});

test('an outcome for an invocation nobody opened is still recorded', async (t) => {
  // The worker can be destroyed between the start and the outcome. Dropping the
  // outcome would understate the denominator every rate divides by.
  withChrome(t);
  await recordOutcome('cap_orphan', 'filed', { path: 'keystroke' });

  const [record] = await readTelemetry();
  assert.equal(record?.id, 'cap_orphan');
  assert.equal(record?.outcome, 'filed');
});

test('a failure kind is kept, and it is an enum rather than a message', async (t) => {
  withChrome(t);
  await recordStarted({ id: 'cap_d', path: 'keystroke' });
  await recordOutcome('cap_d', 'failed', { failureKind: 'rate-limited' });

  assert.equal((await readTelemetry())[0]?.failureKind, 'rate-limited');
});

/* ------------------------------------------------------ concurrency, size */

test('two overlapping captures do not overwrite each other (KTD7)', async (t) => {
  // chrome.storage.local has no atomic update, and KTD7 already establishes that
  // two captures can be in flight at once. Without serialising, the second
  // read-modify-write silently discards the first.
  withChrome(t);
  await Promise.all([
    recordStarted({ id: 'cap_x', path: 'keystroke' }),
    recordStarted({ id: 'cap_y', path: 'popup' }),
    recordStarted({ id: 'cap_z', path: 'keystroke' }),
  ]);

  const ids = (await readTelemetry()).map((r) => r.id).sort();
  assert.deepEqual(ids, ['cap_x', 'cap_y', 'cap_z']);
});

test('records older than the retention window are pruned on the next write', async (t) => {
  withChrome(t);
  const ancient: CaptureRecord = {
    id: 'cap_old',
    path: 'keystroke',
    startedAt: new Date(Date.now() - (TELEMETRY_RETENTION_DAYS + 1) * DAY_MS).toISOString(),
    outcome: 'filed',
  };
  await writeTelemetryLog([ancient]);
  await recordStarted({ id: 'cap_new', path: 'keystroke' });

  assert.deepEqual((await readTelemetry()).map((r) => r.id), ['cap_new']);
});

test('the log is bounded, keeping the most recent records', async (t) => {
  withChrome(t);
  const many: CaptureRecord[] = Array.from({ length: TELEMETRY_MAX_RECORDS + 5 }, (_, i) => ({
    id: `cap_${i}`,
    path: 'keystroke',
    startedAt: new Date(Date.now() - (TELEMETRY_MAX_RECORDS + 5 - i) * 1000).toISOString(),
    outcome: 'filed',
  }));
  await writeTelemetryLog(many);
  await recordStarted({ id: 'cap_latest', path: 'keystroke' });

  const log = await readTelemetry();
  assert.equal(log.length, TELEMETRY_MAX_RECORDS);
  assert.equal(log.at(-1)?.id, 'cap_latest');
  assert.equal(log.some((r) => r.id === 'cap_0'), false, 'the oldest went first');
});

test('clearing removes the log entirely', async (t) => {
  const chrome = withChrome(t);
  await recordStarted({ id: 'cap_e', path: 'keystroke' });
  await clearTelemetry();

  assert.deepEqual(await readTelemetry(), []);
  assert.equal(STORAGE_KEYS.telemetry in chrome.__dump(), false, 'the key is gone, not left empty');
});

test('a corrupt log reads as empty rather than throwing', async (t) => {
  // A capture must never fail because telemetry is unreadable. Measurement is
  // strictly secondary to filing.
  const chrome = withChrome(t);
  await chrome.storage.local.set({ [STORAGE_KEYS.telemetry]: 'not an array' });
  assert.deepEqual(await readTelemetry(), []);
});

/* ------------------------------------------------------- the popup port -- */

/**
 * Abandonment is the only metric measured by something *not happening*, so its
 * wiring gets the same scrutiny as a write path. The port is the mechanism —
 * Chrome destroys a popup on blur with no event the popup can send, so the
 * disconnect is the whole observation.
 */
function fakePort(): {
  port: import('../src/telemetry.ts').TelemetryPortLike;
  send: (message: unknown) => void;
  disconnect: () => void;
} {
  const messageListeners: Array<(m: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    port: {
      onMessage: { addListener: (l) => void messageListeners.push(l) },
      onDisconnect: { addListener: (l) => void disconnectListeners.push(l) },
    },
    send: (message) => messageListeners.forEach((l) => l(message)),
    disconnect: () => disconnectListeners.forEach((l) => l()),
  };
}

/** The recorder is fire-and-forget; let its serialised writes drain. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

test('a popup that closes without filing is recorded as abandoned', async (t) => {
  withChrome(t);
  const { port, send, disconnect } = fakePort();
  attachTelemetrySession(port, { isSubmitting: () => false });

  send({ kind: 'started', captureId: 'cap_p1', path: 'popup', startedAt: new Date().toISOString() });
  await settled();
  disconnect();
  await settled();

  const [record] = await readTelemetry();
  assert.equal(record?.outcome, 'abandoned');
  assert.equal(record?.path, 'popup');
});

test('a popup destroyed mid-flight is not abandonment', async (t) => {
  // Chrome kills the popup on blur while the worker is still writing. The
  // capture succeeds; calling it abandoned would report the practitioner's
  // successful capture as one they gave up on.
  withChrome(t);
  const { port, send, disconnect } = fakePort();
  attachTelemetrySession(port, { isSubmitting: (id) => id === 'cap_p2' });

  send({ kind: 'started', captureId: 'cap_p2', path: 'popup', startedAt: new Date().toISOString() });
  await settled();
  disconnect();
  await settled();

  assert.equal((await readTelemetry())[0]?.outcome, undefined, 'left open for the write to close');
});

test('a filing that already landed survives the disconnect that follows it', async (t) => {
  // Belt and suspenders: even if `isSubmitting` has already been cleared by the
  // time the port goes away, first-outcome-wins keeps the filing.
  withChrome(t);
  const { port, send, disconnect } = fakePort();
  attachTelemetrySession(port, { isSubmitting: () => false });

  send({ kind: 'started', captureId: 'cap_p3', path: 'popup', startedAt: new Date().toISOString() });
  await settled();
  await recordOutcome('cap_p3', 'filed', { durationMs: 900 });
  disconnect();
  await settled();

  const [record] = await readTelemetry();
  assert.equal(record?.outcome, 'filed');
  assert.equal(record?.durationMs, 900);
});

test('a disconnect with no session recorded does nothing', async (t) => {
  // A port that opened and closed without a message is not an invocation.
  withChrome(t);
  const { port, disconnect } = fakePort();
  attachTelemetrySession(port, { isSubmitting: () => false });

  disconnect();
  await settled();

  assert.deepEqual(await readTelemetry(), []);
});

test('an outcome the popup reports directly closes the record', async (t) => {
  // The unreadable-tab and held paths end in the popup, not in the worker's
  // submit(), so the popup reports them over the same port.
  withChrome(t);
  const { port, send, disconnect } = fakePort();
  attachTelemetrySession(port, { isSubmitting: () => false });

  send({ kind: 'started', captureId: 'cap_p4', path: 'popup', startedAt: new Date().toISOString() });
  await settled();
  send({ kind: 'outcome', captureId: 'cap_p4', path: 'popup', outcome: 'unreadable-tab' });
  await settled();
  disconnect();
  await settled();

  assert.equal((await readTelemetry())[0]?.outcome, 'unreadable-tab', 'the disconnect does not overwrite it');
});

test('a message that is not telemetry is ignored', async (t) => {
  withChrome(t);
  const { port, send, disconnect } = fakePort();
  attachTelemetrySession(port, { isSubmitting: () => false });

  send({ type: 'clipper/file-capture' });
  send(null);
  send('started');
  await settled();
  disconnect();
  await settled();

  assert.deepEqual(await readTelemetry(), []);
});
