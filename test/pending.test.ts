import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import type { CaptureWriter } from '../src/capture.ts';
import { fileHeldCapture, holdCapture, reviewOnStartup } from '../src/pending.ts';
import {
  PENDING_CAPTURE_TTL_MS,
  listInFlight,
  markInFlight,
  readPendingCapture,
  setApiKey,
  setCaptureRoleId,
  writePendingCapture,
} from '../src/storage.ts';
import type { Capture } from '../src/types.ts';

const ROLE = 'role_0123456789abcdef0123456789abcdef';

function capture(title = 'A page'): Capture {
  return {
    page: { url: 'https://example.test/page', title, capturedAt: '2026-08-28T12:00:00.000Z' },
  };
}

/**
 * `calls` is an array rather than a counter: a getter would be snapshotted by
 * any destructuring at the call site, which silently turns "was it called?"
 * into "was it called before I looked?".
 */
function fakeWriter(options: { fail?: unknown } = {}): { writer: CaptureWriter; calls: string[] } {
  const calls: string[] = [];
  const record = (kind: string) => async () => {
    calls.push(kind);
    if (options.fail) throw options.fail;
    return { id: 'item-1' };
  };
  return {
    calls,
    writer: {
      createTension: record('tension'),
      createAction: record('action'),
      createProject: record('project'),
    },
  };
}

async function configure(): Promise<void> {
  await setApiKey('gfk_live_test');
  await setCaptureRoleId(ROLE);
}

test('R9: an unconfigured capture is held and the options page is opened', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  const outcome = await holdCapture(capture(), 'cap-1');

  assert.equal(outcome.status, 'held');
  assert.equal((await readPendingCapture()).state, 'current');
  assert.equal(chrome.__optionsPageOpened, 1);
  assert.equal(chrome.__badge.text, '…', 'held is visibly not the same as filed');
});

test('AE9 / R15: a second unconfigured capture replaces the first and the replacement is surfaced', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await holdCapture(capture('First page'), 'cap-1');
  const outcome = await holdCapture(capture('Second page'), 'cap-2');

  assert.equal(outcome.status === 'held' && outcome.replacedPending, true);

  const pending = await readPendingCapture();
  assert.equal(pending.state === 'current' ? pending.pending.id : undefined, 'cap-2');

  const notice = chrome.__notifications.find((n) => n.id === 'clipper/pending-replaced');
  assert.ok(notice, 'the replacement is told, not silent');
  assert.match(notice?.options.message ?? '', /First page/);
  assert.match(notice?.options.message ?? '', /Second page/);
});

test('AE1: saving configuration files the capture that was held', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await holdCapture(capture(), 'cap-1');
  await configure();

  const { writer, calls } = fakeWriter();
  const outcome = await fileHeldCapture(writer);

  assert.equal(outcome?.status, 'filed');
  assert.equal(calls.length, 1);
  assert.equal((await readPendingCapture()).state, 'absent', 'R16: the slot clears when its item files');
  assert.equal(chrome.__badge.text, '✓');
});

test('configuration saved with no capture held files nothing', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer, calls } = fakeWriter();

  assert.equal(await fileHeldCapture(writer), undefined);
  assert.equal(calls.length, 0);
});

test('a held capture is not filed while configuration is still incomplete', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  await holdCapture(capture(), 'cap-1');
  await setApiKey('gfk_live_test'); // key saved, role not yet chosen

  const { writer, calls } = fakeWriter();

  assert.equal(await fileHeldCapture(writer), undefined);
  assert.equal(calls.length, 0, 'the two-phase save must not fire early');
  assert.equal((await readPendingCapture()).state, 'current', 'and the capture is still held');
});

test('R18: reconfiguring after an unusable-role failure files the preserved capture', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  await holdCapture(capture(), 'cap-1');
  await configure();

  const rejecting = fakeWriter({ fail: Object.assign(new Error('forbidden'), { status: 403 }) });
  const failed = await fileHeldCapture(rejecting.writer);

  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.status === 'failed' && failed.failure.reconfigure, true);
  assert.equal((await readPendingCapture()).state, 'current', 'R10: the capture survives the failure');

  // The practitioner picks a different role; the same trigger re-fires.
  await setCaptureRoleId('role_fedcba9876543210fedcba9876543210');
  const accepting = fakeWriter();
  const filed = await fileHeldCapture(accepting.writer);

  assert.equal(filed?.status, 'filed');
  assert.equal((await readPendingCapture()).state, 'absent');
});

test('AE6: a failed file surfaces the failure and preserves the content', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await holdCapture(capture(), 'cap-1');
  await configure();

  const offline = fakeWriter({ fail: Object.assign(new Error('offline'), { status: 0 }) });
  await fileHeldCapture(offline.writer);

  assert.ok(chrome.__notifications.some((n) => n.id.startsWith('clipper/failure/')));
  assert.equal((await readPendingCapture()).state, 'current');
});

test('KTD7: an in-flight marker found at startup is surfaced and no request is issued', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  await markInFlight({ id: 'cap-1', capture: capture('Interrupted page'), startedAt: '2026-08-28T12:00:00.000Z' });

  const result = await reviewOnStartup();

  assert.equal(result.stranded, 1);
  const notice = chrome.__notifications.find((n) => n.id === 'clipper/stranded/cap-1');
  assert.ok(notice);
  assert.match(notice?.options.message ?? '', /Interrupted page/);
  assert.match(notice?.options.message ?? '', /Check GlassFrog/i, 'the practitioner resolves it, not the extension');
});

test('KTD7: a stranded marker is surfaced once, not on every startup', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await markInFlight({ id: 'cap-1', capture: capture(), startedAt: '2026-08-28T12:00:00.000Z' });

  await reviewOnStartup();
  assert.deepEqual(await listInFlight(), []);

  const afterFirst = chrome.__notifications.length;
  await reviewOnStartup();
  assert.equal(chrome.__notifications.length, afterFirst, 'repeat nagging trains the practitioner to ignore it');
});

test('R16: a capture past the expiry is surfaced rather than filed or silently dropped', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const longAgo = new Date(Date.now() - PENDING_CAPTURE_TTL_MS - 60_000).toISOString();
  await writePendingCapture({ id: 'cap-old', capture: capture('Stale page'), capturedAt: longAgo });

  const { writer, calls } = fakeWriter();
  const outcome = await fileHeldCapture(writer);

  assert.equal(outcome, undefined, 'an expired capture is never filed');
  assert.equal(calls.length, 0);

  const notice = chrome.__notifications.find((n) => n.id === 'clipper/pending-expired');
  assert.ok(notice, 'and never disappears silently');
  assert.match(notice?.options.message ?? '', /Stale page/);
  assert.equal((await readPendingCapture()).state, 'absent', 'nor is it retained indefinitely');
});

test('R16: startup review expires a stale capture even when nothing triggers a file', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  const longAgo = new Date(Date.now() - PENDING_CAPTURE_TTL_MS - 60_000).toISOString();
  await writePendingCapture({ id: 'cap-old', capture: capture('Stale page'), capturedAt: longAgo });

  const result = await reviewOnStartup();

  assert.equal(result.expired, true);
  assert.ok(chrome.__notifications.some((n) => n.id === 'clipper/pending-expired'));
});

test('no ordering of capture, restart and reconfigure yields a duplicate', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  await holdCapture(capture(), 'cap-1');
  await configure();

  // Worker dies mid-request: the POST may have landed.
  const dying = fakeWriter({ fail: Object.assign(new Error('worker gone'), { status: 0 }) });
  await fileHeldCapture(dying.writer);

  // Restart. The marker is surfaced, never re-filed.
  const afterRestart = await reviewOnStartup();
  assert.equal(afterRestart.stranded, 1);

  const wouldRefile = fakeWriter();
  await reviewOnStartup();
  assert.equal(wouldRefile.calls.length, 0, 'startup issues no requests at all');
});
