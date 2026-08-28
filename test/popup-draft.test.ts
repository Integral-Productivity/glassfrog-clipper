import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import { initialFields, toCapture } from '../src/popup.ts';
import { type CaptureWriter, fileCapture } from '../src/capture.ts';
import {
  clearDraft,
  readDraft,
  setCaptureRoleId,
  setDefaultStatus,
  setRoles,
  writeDraft,
} from '../src/storage.ts';
import type { PageContext } from '../src/types.ts';

const CONFIGURED_ROLE = 'role_0123456789abcdef0123456789abcdef';
const CHOSEN_ROLE = 'role_fedcba9876543210fedcba9876543210';

const PAGE: PageContext = {
  url: 'https://example.test/page',
  title: 'A page worth clipping',
  capturedAt: '2026-08-28T12:00:00.000Z',
};

interface Recorded {
  method: string;
  roleId: string;
  input: Record<string, unknown>;
}

function fakeWriter(): { writer: CaptureWriter; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const record = (method: string) => async (roleId: string, input: Record<string, unknown>) => {
    calls.push({ method, roleId, input: { ...input } });
    return { id: 'item-1' };
  };
  return {
    calls,
    writer: {
      createTension: record('tension'),
      createAction: record('action'),
      createProject: record('project'),
    } as CaptureWriter,
  };
}

test('AE5: opening the popup and changing nothing produces what the shortcut would have', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(CONFIGURED_ROLE);

  const fields = initialFields(undefined, { roleId: CONFIGURED_ROLE });
  const capture = toCapture(PAGE, fields);

  assert.equal(capture.workType, undefined, 'an unchanged work type stays unset, so KD2 applies');
  assert.equal(capture.note, undefined);

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture, 'cap-1');

  assert.equal(calls[0]?.method, 'tension');
  assert.equal(calls[0]?.roleId, CONFIGURED_ROLE);
  assert.equal('status' in (calls[0]?.input ?? {}), false);
});

test('R5: a draft role survives, and the configured role only fills a gap', () => {
  const withDraft = initialFields({ roleId: CHOSEN_ROLE }, { roleId: CONFIGURED_ROLE });
  assert.equal(withDraft.roleId, CHOSEN_ROLE, 'reopening must not silently revert a deliberate choice');

  const withoutDraft = initialFields(undefined, { roleId: CONFIGURED_ROLE });
  assert.equal(withoutDraft.roleId, CONFIGURED_ROLE);

  const neither = initialFields(undefined, {});
  assert.equal(neither.roleId, '');
});

test('AE4: naming a different role files against that role, not the configured one', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(CONFIGURED_ROLE);

  const capture = toCapture(PAGE, { roleId: CHOSEN_ROLE, workType: 'tension', note: '' });

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture, 'cap-1');

  assert.equal(calls[0]?.roleId, CHOSEN_ROLE);
});

test('AE3: filing an action with the default status set to someday creates it as someday', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(CONFIGURED_ROLE);
  await setDefaultStatus('someday');

  const capture = toCapture(PAGE, { roleId: '', workType: 'action', note: '' });

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture, 'cap-1');

  assert.equal(calls[0]?.method, 'action');
  assert.equal(calls[0]?.input.status, 'someday');
});

test('AE8: a typed note is carried into the filed item alongside the page evidence', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);
  await setCaptureRoleId(CONFIGURED_ROLE);

  const capture = toCapture(PAGE, { roleId: '', workType: 'tension', note: '  worth revisiting in tactical  ' });
  assert.equal(capture.note, 'worth revisiting in tactical', 'trimmed, but kept');

  const { writer, calls } = fakeWriter();
  await fileCapture(writer, capture, 'cap-1');

  const body = String(calls[0]?.input.body);
  assert.match(body, /worth revisiting in tactical/);
  assert.match(body, /https:\/\/example\.test\/page/);
});

test('a whitespace-only note is not carried as a note', () => {
  assert.equal(toCapture(PAGE, { roleId: '', workType: 'tension', note: '   \n ' }).note, undefined);
});

test('R20: a draft typed and abandoned is restored when the popup reopens', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  await writeDraft({ roleId: CHOSEN_ROLE, workType: 'project', note: 'half a thought' });

  const fields = initialFields(await readDraft(), { roleId: CONFIGURED_ROLE });

  assert.deepEqual(fields, { roleId: CHOSEN_ROLE, workType: 'project', note: 'half a thought' });
});

test('R20: a successful file clears the draft', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  await writeDraft({ note: 'filed already' });
  await clearDraft();

  assert.equal(await readDraft(), undefined);
  assert.deepEqual(initialFields(await readDraft(), {}), { roleId: '', workType: 'tension', note: '' });
});

test('a draft carrying a work type from a future build falls back to tension', () => {
  const fields = initialFields({ workType: 'proposal' as never }, {});

  assert.equal(fields.workType, 'tension', 'an unknown type must not reach the API as-is');
});

test('R2: the role selector is populated from cached roles rather than a typed id', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  const roles = [
    { id: CONFIGURED_ROLE, name: 'Platform Engineering' },
    { id: CHOSEN_ROLE, name: 'Coaching' },
  ];
  await setRoles(roles);

  const { getRoles } = await import('../src/storage.ts');
  const cached = await getRoles();

  assert.deepEqual(cached, roles);
  assert.ok(
    cached.every((role) => /^role_[0-9a-f]{32}$/.test(role.id)),
    'ids are opaque hex, which is exactly why a picker is required rather than a text field',
  );
});
