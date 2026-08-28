import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import type { Capture } from '../src/types.ts';
import {
  IN_FLIGHT_KEY_PREFIX,
  PENDING_CAPTURE_TTL_MS,
  STORAGE_KEYS,
  clearDraft,
  clearInFlight,
  clearPendingCapture,
  enableTrustedContexts,
  getConfigurationState,
  getDefaultStatus,
  isConfigured,
  listInFlight,
  markInFlight,
  readDraft,
  readPendingCapture,
  setApiKey,
  setCaptureRoleId,
  setDefaultStatus,
  writeDraft,
  writePendingCapture,
} from '../src/storage.ts';

function capture(url = 'https://example.test/a'): Capture {
  return {
    page: { url, title: 'A page', capturedAt: '2026-08-28T12:00:00.000Z' },
  };
}

/** Every test gets a clean global; none leaks a fake into the next. */
function withFakeChrome(options?: { withSetAccessLevel?: boolean }) {
  const installed = installFakeChrome(options);
  return installed;
}

test('a second pending capture replaces the first and leaves exactly one slot', async (t) => {
  const { chrome, restore } = withFakeChrome();
  t.after(restore);

  const first = { id: 'cap-1', capture: capture('https://example.test/first'), capturedAt: '2026-08-28T12:00:00.000Z' };
  const second = { id: 'cap-2', capture: capture('https://example.test/second'), capturedAt: '2026-08-28T12:05:00.000Z' };

  const firstWrite = await writePendingCapture(first);
  assert.equal(firstWrite.replaced, undefined, 'nothing was held before the first capture');

  const secondWrite = await writePendingCapture(second);
  assert.equal(
    secondWrite.replaced?.id,
    'cap-1',
    'the displaced capture is returned so R15 can surface the replacement',
  );

  const slots = Object.keys(chrome.__dump()).filter((key) => key === STORAGE_KEYS.pendingCapture);
  assert.equal(slots.length, 1, 'the slot is overwritten, never appended to');

  const read = await readPendingCapture(Date.parse('2026-08-28T12:06:00.000Z'));
  assert.equal(read.state, 'current');
  assert.equal(read.state === 'current' ? read.pending.id : undefined, 'cap-2');
});

test('a pending capture past the expiry reports expired rather than current', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  const capturedAt = '2026-08-01T00:00:00.000Z';
  await writePendingCapture({ id: 'cap-old', capture: capture(), capturedAt });

  const justInside = Date.parse(capturedAt) + PENDING_CAPTURE_TTL_MS;
  const justOutside = justInside + 1;

  assert.equal((await readPendingCapture(justInside)).state, 'current', 'the boundary itself is still current');

  const expired = await readPendingCapture(justOutside);
  assert.equal(expired.state, 'expired');
  assert.equal(
    expired.state === 'expired' ? expired.pending.id : undefined,
    'cap-old',
    'R16 forbids silent deletion, so the capture still comes back with the verdict',
  );
});

test('an unparseable capturedAt is treated as expired, not trusted as current', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  await writePendingCapture({ id: 'cap-bad', capture: capture(), capturedAt: 'not-a-date' });

  assert.equal((await readPendingCapture(Date.now())).state, 'expired');
});

test('reading a pending capture when none is held reports absent rather than throwing', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  assert.equal((await readPendingCapture()).state, 'absent');

  await writePendingCapture({ id: 'cap-1', capture: capture(), capturedAt: new Date().toISOString() });
  await clearPendingCapture();

  assert.equal((await readPendingCapture()).state, 'absent', 'clearing returns the slot to absent');
});

test('configuration state names which piece is missing', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  assert.deepEqual(await getConfigurationState(), {
    configured: false,
    missing: ['apiKey', 'captureRole'],
  });

  await setApiKey('key-123');
  assert.deepEqual(
    await getConfigurationState(),
    { configured: false, missing: ['captureRole'] },
    'a valid key with no role chosen is its own state, not just "unconfigured"',
  );
  assert.equal(await isConfigured(), false);

  await setCaptureRoleId('role_0123456789abcdef0123456789abcdef');
  assert.deepEqual(await getConfigurationState(), { configured: true });
  assert.equal(await isConfigured(), true);
});

test('a blank API key counts as missing rather than sailing through', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  await setApiKey('');
  await setCaptureRoleId('role_0123456789abcdef0123456789abcdef');

  assert.deepEqual(await getConfigurationState(), { configured: false, missing: ['apiKey'] });
});

test('the default action/project status falls back to current and only accepts KD3 values', async (t) => {
  const { chrome, restore } = withFakeChrome();
  t.after(restore);

  assert.equal(await getDefaultStatus(), 'current', 'unset falls back rather than returning undefined');

  await setDefaultStatus('someday');
  assert.equal(await getDefaultStatus(), 'someday');

  // A value from an older build, or hand-edited storage, must not escape KD3.
  await chrome.storage.local.set({ [STORAGE_KEYS.defaultStatus]: 'waiting' });
  assert.equal(await getDefaultStatus(), 'current');
});

test('in-flight markers are keyed per capture, so overlapping captures cannot clear each other', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  await markInFlight({ id: 'cap-1', capture: capture('https://example.test/1'), startedAt: '2026-08-28T12:00:00.000Z' });
  await markInFlight({ id: 'cap-2', capture: capture('https://example.test/2'), startedAt: '2026-08-28T12:00:01.000Z' });

  assert.equal((await listInFlight()).length, 2);

  await clearInFlight('cap-1');

  const remaining = await listInFlight();
  assert.equal(remaining.length, 1, 'clearing the first leaves the second intact (KTD7)');
  assert.equal(remaining[0]?.id, 'cap-2');
});

test('listing in-flight markers ignores unrelated keys', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  await setApiKey('key-123');
  await writeDraft({ note: 'a draft' });
  await markInFlight({ id: 'cap-1', capture: capture(), startedAt: '2026-08-28T12:00:00.000Z' });

  const markers = await listInFlight();
  assert.equal(markers.length, 1, 'the API key and the draft are not mistaken for markers');
  assert.ok(
    Object.values(STORAGE_KEYS).every((key) => !key.startsWith(IN_FLIGHT_KEY_PREFIX)),
    'no fixed key value collides with the in-flight prefix',
  );
});

test('the popup draft round-trips and clears', async (t) => {
  const { restore } = withFakeChrome();
  t.after(restore);

  assert.equal(await readDraft(), undefined);

  await writeDraft({ roleId: 'role_abc', workType: 'action', note: 'half a thought' });
  assert.deepEqual(await readDraft(), { roleId: 'role_abc', workType: 'action', note: 'half a thought' });

  await clearDraft();
  assert.equal(await readDraft(), undefined);
});

test('enableTrustedContexts is a no-op on builds without setAccessLevel on local', async (t) => {
  const { restore } = withFakeChrome({ withSetAccessLevel: false });
  t.after(restore);

  // The guard is the whole point: an unguarded call throws and takes every
  // capture path with it on exactly the builds least able to report why.
  assert.doesNotThrow(() => enableTrustedContexts());
});

test('enableTrustedContexts calls through when the API is present', async (t) => {
  const { chrome, restore } = withFakeChrome();
  t.after(restore);

  let called: string | undefined;
  chrome.storage.local.setAccessLevel = async (options) => {
    called = options.accessLevel;
  };

  enableTrustedContexts();
  await Promise.resolve();

  assert.equal(called, 'TRUSTED_CONTEXTS');
});
