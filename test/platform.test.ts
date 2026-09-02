import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import {
  browserKind,
  hasCommands,
  hasNativeMessaging,
  hasNotifications,
  sendNative,
} from '../src/platform.ts';

/**
 * These pin the *capability detection*, not the platform names.
 *
 * The value of src/platform.ts is that a capability Safari ships later starts
 * working with no code change. A test that asserted "on Safari, do X" would
 * quietly become wrong at that moment while still passing; these assert what is
 * observable — a method is there, or it is not.
 */

test('the extension host is read from the scheme its resources are served from', () => {
  const chrome = installFakeChrome({ host: 'chrome' });
  try {
    assert.equal(browserKind(), 'chrome');
  } finally {
    chrome.restore();
  }

  const safari = installFakeChrome({ host: 'safari' });
  try {
    assert.equal(browserKind(), 'safari');
  } finally {
    safari.restore();
  }
});

test('an unrecognised host is reported as unknown rather than guessed at', () => {
  const previous = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = undefined;
  try {
    // Nothing on the capture path branches on this, which is exactly why an
    // honest 'unknown' is safe: it degrades to capability checks, which are
    // still accurate.
    assert.equal(browserKind(), 'unknown');
  } finally {
    (globalThis as { chrome?: unknown }).chrome = previous;
  }
});

test('notifications are detected as absent on Safari and present on Chrome', () => {
  const chrome = installFakeChrome({ host: 'chrome' });
  try {
    assert.equal(hasNotifications(), true);
  } finally {
    chrome.restore();
  }

  const safari = installFakeChrome({ host: 'safari' });
  try {
    assert.equal(hasNotifications(), false, 'Safari implements no chrome.notifications');
  } finally {
    safari.restore();
  }
});

test('the shortcut check is disabled on Safari even though commands exists', () => {
  // The fake keeps `chrome.commands` present under Safari on purpose. Safari on
  // iOS reports an empty command list whether or not anything is wrong, which is
  // indistinguishable from R22's real case — a shortcut another extension took.
  // Suppressing by platform is therefore correct here and capability detection
  // alone is not enough.
  const safari = installFakeChrome({ host: 'safari' });
  try {
    assert.equal(typeof globalThis.chrome.commands.getAll, 'function');
    assert.equal(hasCommands(), false);
  } finally {
    safari.restore();
  }
});

test('native messaging is absent until a containing app can answer', () => {
  const none = installFakeChrome({ host: 'safari', nativeApp: 'absent' });
  try {
    assert.equal(hasNativeMessaging(), false);
  } finally {
    none.restore();
  }

  const app = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    assert.equal(hasNativeMessaging(), true);
  } finally {
    app.restore();
  }
});

test('sendNative returns undefined rather than throwing when there is no app', async () => {
  const none = installFakeChrome({ host: 'safari', nativeApp: 'absent' });
  try {
    assert.equal(await sendNative({ kind: 'notice' }), undefined);
  } finally {
    none.restore();
  }
});

test('sendNative swallows a throwing host so a failed notice cannot become a second failure', async () => {
  const broken = installFakeChrome({ host: 'safari', nativeApp: 'throws' });
  try {
    // The only caller is on the failure path. A throw here would replace a
    // reportable problem with an unreported one.
    assert.equal(await sendNative({ kind: 'notice' }), undefined);
    assert.equal(broken.chrome.__nativeMessages.length, 1, 'the attempt still happened');
  } finally {
    broken.restore();
  }
});

test('sendNative passes the message through to the containing app', async () => {
  const app = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    const reply = await sendNative<{ delivered?: boolean }>({ kind: 'notice', id: 'x' });
    assert.deepEqual(reply, { delivered: true });
    assert.deepEqual(app.chrome.__nativeMessages[0]?.message, { kind: 'notice', id: 'x' });
  } finally {
    app.restore();
  }
});
