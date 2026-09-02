import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_HOST_PERMISSIONS,
  ALLOWED_PERMISSIONS,
  chromeApisUsedInSource,
  permissionViolations,
} from '../../fitness/checks/manifest-permissions.ts';

const USED = new Set(['storage', 'scripting', 'notifications', 'alarms']);

const good = {
  permissions: [...ALLOWED_PERMISSIONS],
  host_permissions: [...ALLOWED_HOST_PERMISSIONS],
};

test('the shipped permission surface is compliant', () => {
  assert.deepEqual(permissionViolations(good, USED), []);
});

test('a permission added to the manifest is caught', () => {
  const violations = permissionViolations({ ...good, permissions: [...good.permissions, 'tabs'] }, USED);
  assert.ok(violations.some((v) => /declares `tabs`/.test(v.detail)));
});

test('a permission removed from the manifest is caught too', () => {
  // Shrinking is welcome, but the allowlist has to shrink with it or this check
  // stops describing the extension that actually ships.
  const violations = permissionViolations({ ...good, permissions: ['storage'] }, new Set(['storage']));
  assert.ok(violations.some((v) => /no longer declares/.test(v.detail)));
});

test('a declared permission nothing uses is caught', () => {
  const violations = permissionViolations(good, new Set(['storage', 'scripting', 'notifications']));
  assert.ok(violations.some((v) => /declares `alarms` but no source file uses/.test(v.detail)));
});

test('a used permission nothing declares is caught', () => {
  const violations = permissionViolations(good, new Set([...USED, 'downloads']));
  assert.ok(violations.some((v) => /uses `chrome.downloads`/.test(v.detail)));
});

test('activeTab is exempt from the usage direction, having no namespace of its own', () => {
  // There is no `chrome.activeTab`, so requiring one would report a violation
  // against a manifest that is already correct.
  assert.deepEqual(permissionViolations(good, USED), []);
});

test('a blanket origin is caught', () => {
  for (const origin of ['<all_urls>', 'https://*/*', '*://*/*']) {
    const violations = permissionViolations({ ...good, host_permissions: [origin] }, USED);
    assert.ok(
      violations.some((v) => v.detail.includes('grants the entire web')),
      `${origin} should be caught as blanket`,
    );
  }
});

test('optional permissions are not a side door around the allowlist', () => {
  const violations = permissionViolations({ ...good, optional_permissions: ['tabs'] }, USED);
  assert.ok(violations.some((v) => /optional_permissions/.test(v.detail)));
});

test('the source scan finds the namespaces the extension really uses', async () => {
  const used = await chromeApisUsedInSource();
  for (const namespace of ['storage', 'scripting', 'notifications', 'alarms']) {
    assert.ok(used.has(namespace), `expected chrome.${namespace} to be found in src/`);
  }
  // `commands` is unlocked by the manifest's `commands` key rather than by a
  // permission. It was a live false positive when this check first ran, so its
  // exemption is pinned rather than left to be rediscovered.
  assert.ok(!used.has('commands'), 'chrome.commands needs no permissions entry');
  assert.ok(!used.has('runtime'), 'chrome.runtime needs no permissions entry');
});
