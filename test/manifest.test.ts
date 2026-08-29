import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The Definition of Done makes the permission list a *stop condition*, not an
 * implementation detail: "Any addition is a stop condition." A test is the only
 * thing that makes that reviewable — a permission added quietly in a large diff
 * is exactly the change nobody catches, and it is the one that costs adoption
 * under the Distribution & trust track.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function manifest(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(root, 'public', 'manifest.json'), 'utf8'));
}

test('the permission list is exactly what the Definition of Done allows', async () => {
  const { permissions, host_permissions } = await manifest();

  assert.deepEqual(
    [...permissions].sort(),
    ['activeTab', 'alarms', 'notifications', 'scripting', 'storage'],
    'adding a permission is a stop condition — raise it rather than widening this list',
  );
  assert.deepEqual(host_permissions, ['https://api.glassfrog.com/*'], 'A3');
});

test('every permission the code relies on is actually declared', async () => {
  const { permissions } = await manifest();
  const { readdir } = await import('node:fs/promises');
  const srcDir = join(root, 'src');
  const files = (await readdir(srcDir)).filter((name) => name.endsWith('.ts'));

  const source = (
    await Promise.all(files.map((file) => readFile(join(srcDir, file), 'utf8')))
  ).join('\n');

  // chrome.scripting.executeScript throws without `scripting`;
  // notifications.create and alarms.create likewise. A missing declaration
  // fails only at runtime, on the failure path, where nobody is watching.
  const used: Array<[string, RegExp]> = [
    ['scripting', /\bchrome\.scripting\./],
    ['notifications', /\bchrome\.notifications\./],
    ['alarms', /\bchrome\.alarms\./],
    ['storage', /\bchrome\.storage\./],
  ];

  for (const [permission, pattern] of used) {
    if (pattern.test(source)) {
      assert.ok(permissions.includes(permission), `code uses chrome.${permission} but does not declare it`);
    }
  }
});

test('the manifest declares the two commands both capture flows need', async () => {
  const { commands } = await manifest();

  assert.ok(commands['quick-capture'], 'F1');
  // KTD4: _execute_action does not fire onCommand and cannot be quick-capture,
  // but without it the structured path is mouse-only.
  assert.ok(commands['_execute_action'], 'F2 / KTD4');
});

test('the manifest points at surfaces that exist', async () => {
  const { access } = await import('node:fs/promises');
  const m = await manifest();

  for (const asset of [m.options_ui.page, m.action.default_popup, m.icons['128'], m.background.service_worker.replace('.js', '')]) {
    if (asset.endsWith('.html') || asset.endsWith('.png')) {
      await access(join(root, 'public', asset));
    }
  }
});
