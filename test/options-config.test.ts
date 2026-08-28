import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { installFakeChrome } from './support/chrome.ts';
import { attemptConfiguration, describePending } from '../src/config.ts';
import { fileHeldCapture, holdCapture } from '../src/pending.ts';
import type { CaptureWriter } from '../src/capture.ts';
import { getRoles, setApiKey, setCaptureRoleId, setRoles } from '../src/storage.ts';
import type { RoleSummary } from '../src/storage.ts';

const ROLES: RoleSummary[] = [
  { id: 'role_0123456789abcdef0123456789abcdef', name: 'Platform Engineering' },
  { id: 'role_fedcba9876543210fedcba9876543210', name: 'Coaching' },
];

const KEY = 'gfk_live_9f2b71c4e85d43aa8127';

function rejecting(status: number): (key: string) => Promise<RoleSummary[]> {
  return async () => {
    throw Object.assign(new Error('nope'), { status });
  };
}

test('a valid key resolves the roles that will populate the picker', async () => {
  const attempt = await attemptConfiguration(async () => ROLES, KEY);

  assert.equal(attempt.ok, true);
  assert.deepEqual(attempt.ok ? attempt.roles : [], ROLES);
});

test('R21: a rejected key says so plainly and yields no roles', async () => {
  const attempt = await attemptConfiguration(rejecting(401), KEY);

  assert.equal(attempt.ok, false);
  assert.equal(attempt.ok === false ? attempt.reason : undefined, 'rejected-key');
  assert.match(attempt.ok === false ? attempt.message : '', /wasn't accepted/i);
});

test("R21: a 403 is also treated as a key the practitioner must fix", async () => {
  const attempt = await attemptConfiguration(rejecting(403), KEY);
  assert.equal(attempt.ok === false ? attempt.reason : undefined, 'rejected-key');
});

test('R21 / A5: an account with no roles says so rather than rendering an empty dropdown', async () => {
  const attempt = await attemptConfiguration(async () => [], KEY);

  assert.equal(attempt.ok, false);
  assert.equal(attempt.ok === false ? attempt.reason : undefined, 'no-roles');
  assert.match(attempt.ok === false ? attempt.message : '', /no roles/i);
});

test('a blank key is its own outcome, not a rejected one', async () => {
  const attempt = await attemptConfiguration(async () => ROLES, '   ');

  assert.equal(attempt.ok === false ? attempt.reason : undefined, 'missing-key');
});

test('an unreachable GlassFrog is distinguished from a bad key', async () => {
  const attempt = await attemptConfiguration(rejecting(0), KEY);

  assert.equal(attempt.ok === false ? attempt.reason : undefined, 'unreachable');
  assert.notEqual(attempt.ok === false ? attempt.reason : undefined, 'rejected-key');
});

test('R12: a key echoed back in an error never reaches the message shown', async () => {
  const leaky = async () => {
    throw Object.assign(new Error(`bad token ${KEY}`), { status: 422 });
  };

  const attempt = await attemptConfiguration(leaky, KEY);

  assert.doesNotMatch(attempt.ok === false ? attempt.message : '', new RegExp(KEY));
});

test('a held capture is described by title, falling back to URL', () => {
  assert.equal(describePending('A page', 'https://example.test/'), 'A page');
  assert.equal(describePending('   ', 'https://example.test/'), 'https://example.test/');
  assert.equal(describePending('', ''), 'an untitled page');
});

test('AE1: fresh install to filed capture, without leaving the options page', async (t) => {
  const { restore } = installFakeChrome();
  t.after(restore);

  // The practitioner hits the shortcut before configuring anything.
  await holdCapture(
    { page: { url: 'https://example.test/p', title: 'A page', capturedAt: '2026-08-28T12:00:00.000Z' } },
    'cap-1',
  );

  // They paste a key; it validates and the roles are cached for the picker.
  const attempt = await attemptConfiguration(async () => ROLES, KEY);
  assert.equal(attempt.ok, true);
  await setApiKey(KEY);
  await setRoles(attempt.ok ? attempt.roles : []);

  // Saving only the key leaves configuration incomplete: nothing files yet.
  const calls: string[] = [];
  const writer: CaptureWriter = {
    createTension: async () => (calls.push('tension'), { id: 'i1' }),
    createAction: async () => (calls.push('action'), { id: 'i1' }),
    createProject: async () => (calls.push('project'), { id: 'i1' }),
  };
  assert.equal(await fileHeldCapture(writer), undefined);
  assert.deepEqual(calls, []);

  // They choose a role. Now it files.
  await setCaptureRoleId(ROLES[0]!.id);
  const outcome = await fileHeldCapture(writer);

  assert.equal(outcome?.status, 'filed');
  assert.deepEqual(calls, ['tension']);
  assert.deepEqual(await getRoles(), ROLES, 'the picker keeps its options for the popup (R2)');
});

/**
 * R7 requires page- and GlassFrog-derived strings render without interpreting
 * markup. Asserting that as a property of the source is stronger than asserting
 * it about one element: it holds for the options page, the popup, and anything
 * either grows later.
 */
test('R7: no source file assigns innerHTML or outerHTML', async () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (await readdir(srcDir)).filter((name) => name.endsWith('.ts'));
  assert.ok(files.length > 0);

  const offenders: string[] = [];
  for (const file of files) {
    const contents = await readFile(join(srcDir, file), 'utf8');
    const stripped = contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/\.(inner|outer)HTML\s*=/.test(stripped)) offenders.push(file);
    if (/insertAdjacentHTML|document\.write/.test(stripped)) offenders.push(`${file} (html insertion)`);
  }

  assert.deepEqual(offenders, [], 'page-derived text is rendered with textContent only');
});

/**
 * A capture whose title is markup must reach the DOM as text. The rendering
 * path uses textContent, so the guarantee is that the raw string survives
 * unchanged rather than being parsed — which is what this asserts of the value
 * that would be assigned.
 */
test('R7: a title carrying markup is described verbatim, not interpreted', () => {
  const hostile = '<img src=x onerror="alert(1)">';

  const described = describePending(hostile, 'https://example.test/');

  assert.equal(described, hostile, 'it stays a string; textContent is what renders it inert');
});
