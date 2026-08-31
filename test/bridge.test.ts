import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import { adoptConfigurationFromApp, applyConfiguration, publishConfiguration } from '../src/bridge.ts';
import {
  getCaptureRoleId,
  getDefaultStatus,
  getRoles,
  isConfigured,
  setApiKey,
  setCaptureRoleId,
} from '../src/storage.ts';

/**
 * The two stores that have to agree.
 *
 * Safari gives the extension a `chrome.storage.local` the containing app cannot
 * read, and vice versa. These pin the two rules that keep them from fighting:
 * the app's copy is a mirror and never overwrites a configured extension, and a
 * partial configuration is refused outright rather than half-applied.
 */

const APP_CONFIGURATION = {
  apiKey: 'gf_live_key',
  captureRoleId: 'role_abc',
  defaultStatus: 'someday',
  roles: [{ id: 'role_abc', name: 'Product Owner' }],
};

test('nothing crosses the bridge on a host that has none', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'chrome' });
  try {
    assert.equal(await publishConfiguration(), false);
    assert.equal(await adoptConfigurationFromApp(), false);
    assert.equal(chrome.__nativeMessages.length, 0);
  } finally {
    restore();
  }
});

test('saving in the options page pushes what was stored, not what was typed', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    await setApiKey('gf_live_key');
    await setCaptureRoleId('role_abc');

    assert.equal(await publishConfiguration(), true);

    const sent = chrome.__nativeMessages[0]?.message as Record<string, unknown>;
    assert.equal(sent.kind, 'configure');
    assert.equal(sent.apiKey, 'gf_live_key');
    assert.equal(sent.captureRoleId, 'role_abc');
  } finally {
    restore();
  }
});

test('an extension with configuration does not ask the app for any', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    await setApiKey('mine');
    await setCaptureRoleId('role_mine');

    assert.equal(await adoptConfigurationFromApp(), false);
    assert.equal(chrome.__nativeMessages.length, 0, 'the app copy is a mirror, not a source of truth');
    assert.equal(await getCaptureRoleId(), 'role_mine', 'the capture role decides where every capture lands');
  } finally {
    restore();
  }
});

test('an unconfigured extension adopts what the app holds', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    chrome.runtime.sendNativeMessage = async () => ({
      delivered: true,
      configuration: APP_CONFIGURATION,
    });

    assert.equal(await adoptConfigurationFromApp(), true);
    assert.equal(await isConfigured(), true);
    assert.equal(await getCaptureRoleId(), 'role_abc');
    assert.equal(await getDefaultStatus(), 'someday');
    assert.deepEqual(await getRoles(), [{ id: 'role_abc', name: 'Product Owner' }]);
  } finally {
    restore();
  }
});

test('a partial configuration from the app is refused rather than half-applied', async () => {
  const { restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    // Half a configuration would move the extension into R21's two-phase state
    // silently — the practitioner sees a key they never entered.
    assert.equal(await applyConfiguration({ apiKey: 'k' }), false);
    assert.equal(await applyConfiguration({ captureRoleId: 'role_abc' }), false);
    assert.equal(await applyConfiguration({ apiKey: '  ', captureRoleId: 'role_abc' }), false);
    assert.equal(await isConfigured(), false);
  } finally {
    restore();
  }
});

test('an unnamed role arriving from the app stays distinguishable', async () => {
  const { restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    await applyConfiguration({
      apiKey: 'k',
      captureRoleId: 'role_abcdef0123456789',
      roles: [{ id: 'role_abcdef0123456789' }, { id: 'role_bbbbbbbb1111', name: '   ' }],
    });

    // Role ids are opaque hex, so a blank option is one the practitioner cannot
    // tell from another. The same fallback the SDK path uses.
    const roles = await getRoles();
    assert.equal(roles[0]?.name, 'Untitled role (abcdef01)');
    assert.equal(roles[1]?.name, 'Untitled role (bbbbbbbb)');
  } finally {
    restore();
  }
});

test('an app that cannot answer leaves the extension exactly as it was', async () => {
  const { restore } = installFakeChrome({ host: 'safari', nativeApp: 'throws' });
  try {
    assert.equal(await adoptConfigurationFromApp(), false);
    assert.equal(await isConfigured(), false);
  } finally {
    restore();
  }
});
