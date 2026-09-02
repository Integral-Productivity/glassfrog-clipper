import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// @ts-expect-error - plain ESM build script, deliberately untyped
import { mergeManifest } from '../scripts/manifest-merge.mjs';

/**
 * The Safari counterpart to manifest.test.ts.
 *
 * The Definition of Done makes the permission list a stop condition. A second
 * platform is exactly where that discipline goes quietly missing — a permission
 * nobody would add to Chrome gets added to "just the Safari one", and the
 * install-time trust STRATEGY.md's Distribution & trust track depends on is
 * spent without anyone deciding to spend it.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function manifests(): Promise<{ chrome: any; safari: any; overlay: any }> {
  const chrome = JSON.parse(await readFile(join(root, 'public', 'manifest.json'), 'utf8'));
  const overlay = JSON.parse(await readFile(join(root, 'public', 'manifest.safari.json'), 'utf8'));
  return { chrome, overlay, safari: mergeManifest(chrome, overlay) };
}

test('the Safari permission list is exactly what the Definition of Done allows', async () => {
  const { safari } = await manifests();

  assert.deepEqual(
    [...safari.permissions].sort(),
    ['activeTab', 'alarms', 'nativeMessaging', 'scripting', 'storage'],
    'adding a permission is a stop condition — raise it rather than widening this list',
  );
  assert.deepEqual(safari.host_permissions, ['https://api.glassfrog.com/*'], 'A3');
});

test('Safari is not asked for a permission it cannot honour', async () => {
  const { safari } = await manifests();
  // Safari implements no chrome.notifications. Declaring it would show the
  // practitioner an install warning in exchange for no capability at all.
  assert.ok(!safari.permissions.includes('notifications'));
});

test('nativeMessaging is declared because the notice chain actually uses it', async () => {
  const { safari } = await manifests();
  const source = (
    await Promise.all(
      (await readdir(join(root, 'src')))
        .filter((name) => name.endsWith('.ts'))
        .map((file) => readFile(join(root, 'src', file), 'utf8')),
    )
  ).join('\n');

  // The mirror of manifest.test.ts's "every permission the code relies on is
  // actually declared", run the other way: a permission with no caller is
  // trust spent for nothing, and should be removed rather than kept in case.
  assert.match(source, /sendNativeMessage/, 'nativeMessaging is declared but nothing calls it');
  assert.ok(safari.permissions.includes('nativeMessaging'));
});

test('the overlay changes only what genuinely differs between the platforms', async () => {
  const { overlay } = await manifests();

  // Every key here has to be justified in scripts/build-safari.mjs. Growing
  // this set is how two manifests become two products.
  assert.deepEqual(
    Object.keys(overlay).filter((key) => key !== '$comment').sort(),
    ['browser_specific_settings', 'minimum_chrome_version', 'permissions'],
  );
});

test('the two manifests cannot drift on anything shared', async () => {
  const { chrome, safari, overlay } = await manifests();

  // This is the whole reason the Safari manifest is an overlay rather than a
  // copy. A Safari build shipping last month's version, or a command the Chrome
  // build has renamed, is the divergence nobody notices until a practitioner
  // reports behaviour the code no longer has.
  const overridden = new Set(Object.keys(overlay));
  for (const key of Object.keys(chrome)) {
    if (overridden.has(key)) continue;
    assert.deepEqual(safari[key], chrome[key], `${key} drifted between the Chrome and Safari manifests`);
  }
});

test('the Safari build declares the floor its capabilities actually need', async () => {
  const { safari } = await manifests();
  // 18.0 is where MV3 service workers and `commands` are both dependable.
  // Lowering it silently would ship a build whose background context never
  // registers, which presents as "capture does nothing" with no error.
  assert.equal(safari.browser_specific_settings.safari.strict_min_version, '18.0');
  assert.equal(safari.minimum_chrome_version, undefined, 'meaningless to Safari; it warns on it');
});
