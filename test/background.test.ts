/**
 * The service worker's flows.
 *
 * `src/background.ts` had no test file at all, which is how R10 and R18 came to
 * be unimplemented on the F1/F2 path while the suite stayed green: every test
 * that appeared to cover preservation seeded the pending slot through
 * `holdCapture` — the *unconfigured* door — and then called `fileHeldCapture`.
 * That proves an already-held capture survives a failure. It says nothing about
 * a capture that was never held, which was the whole defect.
 *
 * So nothing below may call `holdCapture` to arrange a preserved capture. Every
 * test here drives `submit()`, with the extension configured, and asserts
 * against what storage actually holds afterwards rather than against what the
 * returned outcome says about itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import type { CaptureWriter } from '../src/capture.ts';
import {
  listInFlight,
  markInFlight,
  readPendingCapture,
  setApiKey,
  setCaptureRoleId,
} from '../src/storage.ts';
import type { Capture } from '../src/types.ts';

/**
 * `src/background.ts` registers its listeners and calls `enableTrustedContexts()`
 * at module evaluation, so `globalThis.chrome` must exist before it is imported.
 * A static import is hoisted above every statement in this file, so the fake is
 * installed first and the module pulled in dynamically after it.
 */
installFakeChrome();
const { fileHeldCaptureIfPossible, onWake, quickCapture, submit } = await import(
  '../src/background.ts'
);
// The module's own `void onWake()` is in flight at this point. Letting it settle
// against the throwaway fake above keeps it from landing inside a later test.
await new Promise((resolve) => setImmediate(resolve));

const ROLE = 'role_0123456789abcdef0123456789abcdef';
const OTHER_ROLE = 'role_fedcba9876543210fedcba9876543210';

function capture(title = 'A page'): Capture {
  return {
    page: { url: 'https://example.test/page', title, capturedAt: '2026-08-28T12:00:00.000Z' },
  };
}

/** Mirrors test/pending.test.ts: an array, not a counter, so a destructure at the call site cannot snapshot it. */
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

const rejecting = (status: number) => Object.assign(new Error(`status ${status}`), { status });

async function configure(): Promise<void> {
  await setApiKey('gfk_live_test');
  await setCaptureRoleId(ROLE);
}

/** The seam `submit()` gained so it could be driven without resolving the SDK. */
const writerFactory = (writer: CaptureWriter) => async (): Promise<CaptureWriter> => writer;

/* ------------------------------------------------ the four required cases -- */

test('configured + success: the item files and the pending slot is left empty', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer, calls } = fakeWriter();
  const outcome = await submit(capture(), 'cap-1', writerFactory(writer));

  assert.equal(outcome.status, 'filed');
  assert.deepEqual(calls, ['tension']);
  assert.equal((await readPendingCapture()).state, 'absent', 'a filed capture is not also held');
  assert.equal(chrome.__badge.text, '✓');
  assert.deepEqual(await listInFlight(), [], 'the in-flight marker is cleared on success');
});

test('R10: configured + 403 preserves the capture in the pending slot', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(403) });
  const outcome = await submit(capture('Stale role page'), 'cap-1', writerFactory(writer));

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.status === 'failed' && outcome.failure.reconfigure, true);

  const pending = await readPendingCapture();
  assert.equal(pending.state, 'current', 'R10: the content is preserved, not just surfaced');
  assert.equal(pending.state === 'current' && pending.pending.id, 'cap-1');
  assert.equal(
    pending.state === 'current' && pending.pending.capture.page.title,
    'Stale role page',
    'and it is this capture, not some earlier one',
  );

  assert.ok(chrome.__notifications.some((n) => n.id === 'clipper/failure/unusable-role'));
  assert.equal(chrome.__optionsPageOpened, 1, 'R18: an unusable role directs to reconfigure');
});

test('R10: configured + 401 preserves the capture and directs to reconfigure', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(401) });
  const outcome = await submit(capture('Revoked key page'), 'cap-1', writerFactory(writer));

  assert.equal(outcome.status === 'failed' && outcome.failure.reconfigure, true);
  assert.equal((await readPendingCapture()).state, 'current');
  assert.equal(chrome.__optionsPageOpened, 1);
});

test('R10: configured + 429 preserves the capture without sending anyone to the options page', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(429) });
  const outcome = await submit(capture(), 'cap-1', writerFactory(writer));

  assert.equal(outcome.status === 'failed' && outcome.failure.kind, 'rate-limited');
  assert.equal(
    (await readPendingCapture()).state,
    'current',
    'the 429 message already promises the capture is saved; this is what makes that true',
  );
  assert.equal(
    chrome.__optionsPageOpened,
    0,
    'nothing about a rate limit is fixed by changing settings',
  );
  assert.equal(chrome.__badge.text, '…', 'kept-and-not-filed is its own badge, not the success one');
});

/* ------------------------------------------- the transition R18 promised -- */

test('R18: a capture failed by an unusable role files after the role is fixed, without re-capturing', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await configure();

  // The capture reaches the slot only by failing. Nothing here calls holdCapture.
  const rejected = fakeWriter({ fail: rejecting(403) });
  await submit(capture('Preserved page'), 'cap-1', writerFactory(rejected.writer));

  const held = await readPendingCapture();
  assert.equal(held.state, 'current', 'precondition: the failure left something to re-file');

  // The practitioner picks a different role. In the extension this fires through
  // onConfigurationChanged; that listener is bound at module load, so the flow it
  // calls is driven directly here.
  await setCaptureRoleId(OTHER_ROLE);
  const accepting = fakeWriter();
  await fileHeldCaptureIfPossible(writerFactory(accepting.writer));

  assert.deepEqual(accepting.calls, ['tension'], 'the preserved capture went out');
  assert.equal((await readPendingCapture()).state, 'absent', 'and the slot is clear afterwards');
});

/* ------------------------------------------------- the stranded marker -- */

test('a definite rejection leaves no stranded marker, so nobody is sent to check GlassFrog', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(403) });
  await submit(capture('Rejected page'), 'cap-1', writerFactory(writer));

  assert.deepEqual(await listInFlight(), [], 'a 403 means the item was never created');

  await onWake();

  assert.equal(
    chrome.__notifications.filter((n) => n.id.startsWith('clipper/stranded/')).length,
    0,
    'and the practitioner is not told to look for an item that does not exist',
  );
  assert.equal(
    (await readPendingCapture()).state,
    'current',
    'nor is the preserved capture deleted on the way past',
  );
});

test('a network failure keeps its marker, because the write may have landed', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(0) });
  await submit(capture('Offline page'), 'cap-1', writerFactory(writer));

  assert.equal((await listInFlight()).length, 1, 'status 0 cannot distinguish sent from never-sent');

  await onWake();

  const notice = chrome.__notifications.find((n) => n.id === 'clipper/stranded/cap-1');
  assert.ok(notice, 'KTD7 hands a genuinely unknown outcome to the practitioner');
  assert.match(notice?.options.message ?? '', /Check GlassFrog/i);
});

/* ----------------------------------------------------- the one-slot rule -- */

test('R15: a second failed capture replaces the first, and the replacement is surfaced', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(0) });
  await submit(capture('First page'), 'cap-1', writerFactory(writer));
  await submit(capture('Second page'), 'cap-2', writerFactory(writer));

  const pending = await readPendingCapture();
  assert.equal(pending.state === 'current' && pending.pending.id, 'cap-2', 'newest wins');

  const notice = chrome.__notifications.find((n) => n.id === 'clipper/pending-replaced');
  assert.ok(notice, 'silently overwriting would leave the practitioner believing both were kept');
  assert.match(notice?.options.message ?? '', /First page/);
  assert.match(notice?.options.message ?? '', /Second page/);
});

test('a capture that fails twice does not report that it replaced itself', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  const { writer } = fakeWriter({ fail: rejecting(0) });
  await submit(capture('Same page'), 'cap-1', writerFactory(writer));
  await submit(capture('Same page'), 'cap-1', writerFactory(writer));

  assert.equal(
    chrome.__notifications.filter((n) => n.id === 'clipper/pending-replaced').length,
    0,
  );
  assert.equal((await readPendingCapture()).state, 'current');
});

/* ------------------------------------------------------------ regressions -- */

test('R9: an unconfigured capture is still held, and no writer is ever resolved', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  let resolved = 0;
  const outcome = await submit(capture(), 'cap-1', async () => {
    resolved += 1;
    throw new Error('getWriter() throws without an API key');
  });

  assert.equal(outcome.status, 'held');
  assert.equal(resolved, 0, 'the unconfigured branch must not reach for a writer');
  assert.equal((await readPendingCapture()).state, 'current');
  assert.equal(chrome.__optionsPageOpened, 1);
});

test('F1: the shortcut path files the active tab and preserves it when that fails', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();
  chrome.__tabs = [
    { id: 1, url: 'https://example.test/article', title: 'An article' } as chrome.tabs.Tab,
  ];

  const { writer } = fakeWriter({ fail: rejecting(403) });
  await quickCapture(writerFactory(writer));

  const pending = await readPendingCapture();
  assert.equal(pending.state, 'current', 'R10 holds on the zero-decision path too');
  assert.equal(pending.state === 'current' && pending.pending.capture.page.title, 'An article');
});

test('F1: an unreadable tab files nothing and holds nothing', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();
  chrome.__tabs = [];

  const { writer, calls } = fakeWriter();
  await quickCapture(writerFactory(writer));

  assert.deepEqual(calls, [], 'an empty tension is worse than none (OQ7)');
  assert.equal((await readPendingCapture()).state, 'absent');
  assert.ok(chrome.__notifications.some((n) => n.id === 'clipper/unreadable-tab'));
});

/* -------------------------------------------------- the worker lifecycle -- */

test('the review runs when the worker wakes, not only when the browser starts', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);
  await configure();

  // A marker left by a worker that died mid-write, found by the *next* worker.
  await markInFlight({
    id: 'cap-stranded',
    capture: capture('Interrupted page'),
    startedAt: '2026-08-28T12:00:00.000Z',
  });

  // A distinct specifier gets a fresh module instance, so module evaluation —
  // which is all an MV3 worker respawn is — happens again here. Nothing else in
  // this test dispatches an event: chrome.runtime.onStartup never fires, which
  // is precisely the case that used to leave a stranded capture invisible for
  // the rest of the session and then delete it.
  // Held in a variable so TypeScript does not try to resolve the query string
  // as part of a module path; the loader treats it as a distinct specifier and
  // evaluates a fresh instance, which the type system has no way to express.
  const respawnSpecifier = '../src/background.ts?respawn=1';
  await import(respawnSpecifier);
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(
    chrome.__notifications.some((n) => n.id === 'clipper/stranded/cap-stranded'),
    'a respawned worker reviews what the dead one left behind',
  );
  assert.deepEqual(await listInFlight(), [], 'and clears it, so it is surfaced once, not every wake');
});
