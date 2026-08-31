import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import { PROVENANCE_MARKER, EVIDENCE_FIELD_LIMIT } from '../src/compose.ts';
import { type CaptureWriter, fileCapture, pageContextFromTab } from '../src/capture.ts';
import {
  listInFlight,
  readPendingCapture,
  setCaptureRoleId,
  setDefaultStatus,
  writePendingCapture,
} from '../src/storage.ts';
import type { Capture } from '../src/types.ts';

const ROLE = 'role_0123456789abcdef0123456789abcdef';
const OTHER_ROLE = 'role_fedcba9876543210fedcba9876543210';

interface Recorded {
  method: 'tension' | 'action' | 'project';
  roleId: string;
  input: Record<string, unknown>;
}

/**
 * A fake behind the CaptureWriter port. The Verification Contract forbids
 * mocking GlassFrog at the network boundary; substituting the client behind a
 * narrow local interface is what it prescribes instead.
 */
function fakeWriter(options: { onCall?: () => Promise<void> } = {}): {
  writer: CaptureWriter;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const record = async (method: Recorded['method'], roleId: string, input: Record<string, unknown>) => {
    calls.push({ method, roleId, input });
    await options.onCall?.();
    return { id: `item-${calls.length}` };
  };
  return {
    calls,
    writer: {
      createTension: (roleId, input) => record('tension', roleId, { ...input }),
      createAction: (roleId, input) => record('action', roleId, { ...input }),
      createProject: (roleId, input) => record('project', roleId, { ...input }),
    },
  };
}

const PAGE_URL = 'https://example.test/page';

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    page: {
      url: PAGE_URL,
      title: 'A page',
      capturedAt: '2026-08-28T12:00:00.000Z',
    },
    ...overrides,
  };
}

test('a capture with no work type files as a tension and sends no status', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture(), 'cap-1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'tension');
  assert.equal(calls[0]?.roleId, ROLE);
  assert.equal('status' in (calls[0]?.input ?? {}), false, 'tension status is server-derived');
  assert.equal('label' in (calls[0]?.input ?? {}), false, 'and the API rejects label on create');
});

test('AE3: an action is filed with the configured default status', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);
  await setDefaultStatus('someday');

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture({ workType: 'action' }), 'cap-1');

  assert.equal(calls[0]?.method, 'action');
  assert.equal(calls[0]?.input.status, 'someday');
});

/**
 * The middle hop. compose() produces the link and the adapter puts it on the
 * wire; this is the one place that proves the capture path carries it between
 * the two rather than dropping it on the way through.
 */
test('a project reaches the writer with the page URL in link, and an action does not', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture({ workType: 'project' }), 'cap-1');
  await fileCapture(writer, capture({ workType: 'action' }), 'cap-2');

  assert.equal(calls[0]?.input.link, PAGE_URL);
  assert.equal('link' in (calls[1]?.input ?? {}), false, 'ActionInput has no link field to carry one');
});

test('AE4: a role named on the capture wins over the configured capture role', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture({ roleId: OTHER_ROLE }), 'cap-1');

  assert.equal(calls[0]?.roleId, OTHER_ROLE, 'R5: what the practitioner set is used as given');
});

test('filing without any role refuses rather than inventing one', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  const { writer, calls } = fakeWriter();
  await assert.rejects(() => fileCapture(writer, capture(), 'cap-1'), /capture role/i);
  assert.equal(calls.length, 0, 'no request is issued without a role');
});

test('KTD7: the in-flight marker is present during the request and absent after success', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  let duringRequest: number | undefined;
  const { writer } = fakeWriter({
    onCall: async () => {
      duringRequest = (await listInFlight()).length;
    },
  });

  await fileCapture(writer, capture(), 'cap-1');

  assert.equal(duringRequest, 1, 'the marker is written before the request goes out');
  assert.deepEqual(await listInFlight(), [], 'and cleared only once the item is accepted');
});

test('KTD7: two overlapping captures each own a marker, and the first does not clear the second', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  let releaseSecond: (() => void) | undefined;
  const secondInFlight = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });

  const slow = fakeWriter({ onCall: () => secondInFlight });
  const fast = fakeWriter();

  const second = fileCapture(slow.writer, capture(), 'cap-2');
  // Let the slow capture reach its marker-then-request point.
  await Promise.resolve();
  await Promise.resolve();

  await fileCapture(fast.writer, capture(), 'cap-1');

  const stillInFlight = await listInFlight();
  assert.deepEqual(
    stillInFlight.map((marker) => marker.id),
    ['cap-2'],
    'completing cap-1 left cap-2 marked; per-id keys are what prevent the clobber',
  );

  releaseSecond?.();
  await second;
  assert.deepEqual(await listInFlight(), []);
});

test('KTD7: a request that fails after the server may have accepted it leaves the marker standing', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  const { writer } = fakeWriter({
    onCall: async () => {
      // The POST landed; the response did not. This is precisely the ambiguity
      // KTD7 refuses to resolve by guessing.
      throw Object.assign(new Error('network error'), { status: 0 });
    },
  });

  const held = { id: 'cap-1', capture: capture(), capturedAt: new Date().toISOString() };
  await writePendingCapture(held);

  await assert.rejects(() => fileCapture(writer, capture(), 'cap-1'));

  assert.deepEqual(
    (await listInFlight()).map((marker) => marker.id),
    ['cap-1'],
    'the marker survives for U6 to surface — never auto-refiled',
  );
  assert.equal(
    (await readPendingCapture()).state,
    'current',
    'and the capture itself is preserved, not discarded (R10)',
  );
});

test('R16: a successful file clears the pending slot it came from', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  await writePendingCapture({ id: 'cap-1', capture: capture(), capturedAt: new Date().toISOString() });

  const { writer } = fakeWriter();
  await fileCapture(writer, capture(), 'cap-1');

  assert.equal((await readPendingCapture()).state, 'absent');
});

test('a capture filing successfully does not clear an unrelated held capture', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  await writePendingCapture({ id: 'cap-held', capture: capture(), capturedAt: new Date().toISOString() });

  const { writer } = fakeWriter();
  await fileCapture(writer, capture(), 'cap-different');

  const pending = await readPendingCapture();
  assert.equal(pending.state, 'current');
  assert.equal(pending.state === 'current' ? pending.pending.id : undefined, 'cap-held');
});

test('a multi-megabyte selection is truncated before it can reach storage', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  const huge = 'x'.repeat(3_000_000);
  const page = pageContextFromTab(
    { url: 'https://example.test/page', title: 'A page' } as chrome.tabs.Tab,
    huge,
  );

  assert.ok(
    (page.selection?.length ?? 0) <= EVIDENCE_FIELD_LIMIT,
    'the cap is applied at capture time, not only at compose time',
  );

  // And the bounded capture round-trips through the pending slot intact.
  await writePendingCapture({ id: 'cap-1', capture: { page }, capturedAt: new Date().toISOString() });
  const read = await readPendingCapture();
  assert.equal(read.state, 'current');
});

test('a tab with no selection yields a capture with no selection field at all', () => {
  const page = pageContextFromTab({ url: 'https://example.test/p', title: 'T' } as chrome.tabs.Tab);
  assert.equal('selection' in page, false);

  const whitespaceOnly = pageContextFromTab(
    { url: 'https://example.test/p', title: 'T' } as chrome.tabs.Tab,
    '   \n  ',
  );
  assert.equal('selection' in whitespaceOnly, false, 'a whitespace selection is no selection');
});

test('a tab missing url and title still produces a capture carrying the marker', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(ROLE);

  const page = pageContextFromTab({} as chrome.tabs.Tab);
  const { writer, calls } = fakeWriter();
  await fileCapture(writer, { page }, 'cap-1');

  assert.equal(calls[0]?.input.body, PROVENANCE_MARKER, 'R11 holds even with nothing to describe');
});
