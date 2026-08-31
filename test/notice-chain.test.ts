import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import { reportUnboundShortcut, surfaceFailure, surfaceNotice } from '../src/notify.ts';
import { readNotice } from '../src/storage.ts';

/**
 * KTD2 assumed one notification surface because Chrome has one. Safari has
 * none, so the notice has to find its own way out — `chrome.notifications`,
 * then the containing app, then storage.
 *
 * What these tests protect is the *ordering* and the *floor*. The floor is the
 * one that matters: a background quick-capture that failed with nowhere to
 * report it is R18's worst case, where the practitioner believes an item was
 * filed and it was not. There must be no host on which a notice is simply
 * dropped.
 */

const FAILURE = {
  kind: 'unusable-role',
  message: 'GlassFrog would not file to that role. Open the extension options to choose another.',
  reconfigure: true,
  // A rejected role names its own rejection: nothing was written, so there is
  // no ambiguity for the practitioner to resolve.
  mayHaveFiled: false,
} as const;

test('on Chrome the notice goes out as a system notification', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'chrome' });
  try {
    await surfaceFailure(FAILURE);

    assert.equal(chrome.__notifications.length, 1);
    assert.equal(chrome.__notifications[0]?.options.message, FAILURE.message);
    assert.equal(chrome.__nativeMessages.length, 0, 'Chrome has no containing app to fall back to');

    const recorded = await readNotice();
    assert.equal(recorded?.deliveredBy, 'notifications');
  } finally {
    restore();
  }
});

test('on Safari the notice goes to the containing app instead', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    await surfaceFailure(FAILURE);

    assert.equal(chrome.__nativeMessages.length, 1);
    const sent = chrome.__nativeMessages[0]?.message as Record<string, unknown>;
    assert.equal(sent.kind, 'notice');
    assert.equal(sent.message, FAILURE.message);

    const recorded = await readNotice();
    assert.equal(recorded?.deliveredBy, 'native');
  } finally {
    restore();
  }
});

test('a notice is still recorded when nothing can deliver it', async () => {
  // Safari with the containing app never launched, or removed. This is the
  // floor: no system notification, no app, and the notice must not evaporate.
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'absent' });
  try {
    await surfaceFailure(FAILURE);

    assert.equal(chrome.__notifications.length, 0);
    assert.equal(chrome.__nativeMessages.length, 0);

    const recorded = await readNotice();
    assert.equal(recorded?.deliveredBy, 'stored', 'the notice survives for a surface to render');
    assert.equal(recorded?.message, FAILURE.message);
    assert.equal(recorded?.title, 'Capture needs attention');
  } finally {
    restore();
  }
});

test('an app that declines the notice falls through to storage rather than reporting success', async () => {
  const { restore } = installFakeChrome({ host: 'safari', nativeApp: 'declines' });
  try {
    await surfaceFailure(FAILURE);
    // The bridge answered, but said it did not deliver — notification
    // permission denied in the app, most likely. Treating a reachable app as a
    // delivered notice would be the silent failure this chain exists to avoid.
    assert.equal((await readNotice())?.deliveredBy, 'stored');
  } finally {
    restore();
  }
});

test('a throwing native host falls through to storage', async () => {
  const { restore } = installFakeChrome({ host: 'safari', nativeApp: 'throws' });
  try {
    await surfaceFailure(FAILURE);
    assert.equal((await readNotice())?.deliveredBy, 'stored');
  } finally {
    restore();
  }
});

test('the recorded notice is overwritten, never accumulated', async () => {
  // KD1 rejects an inbox, and an unread pile of notices is one. KTD3 makes the
  // same choice for the pending capture, for the same reason.
  const { restore } = installFakeChrome({ host: 'safari', nativeApp: 'absent' });
  try {
    await surfaceNotice('First', 'one', 'clipper/a');
    await surfaceNotice('Second', 'two', 'clipper/b');

    const recorded = await readNotice();
    assert.equal(recorded?.title, 'Second');
  } finally {
    restore();
  }
});

test('R12 holds through the chain: nothing carries the API key to the containing app', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    await surfaceFailure(FAILURE);
    const serialised = JSON.stringify(chrome.__nativeMessages);
    // The classifier has already redacted; this asserts the *transport* adds
    // nothing back. The native bridge is a new egress point R12 did not have.
    assert.ok(!/X-Auth-Token/i.test(serialised));
    assert.ok(!/apiKey/i.test(serialised));
  } finally {
    restore();
  }
});

test('R22 stays quiet on a host that cannot bind shortcuts at all', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'safari', nativeApp: 'delivers' });
  try {
    chrome.__manifestCommands = { 'quick-capture': {} };
    chrome.__boundCommands = [];

    assert.equal(await reportUnboundShortcut(), false);
    assert.equal(
      chrome.__nativeMessages.length,
      0,
      'raising this every startup on iOS trains the practitioner to ignore it',
    );
  } finally {
    restore();
  }
});

test('R22 still fires on a host that can bind shortcuts and did not', async () => {
  const { chrome, restore } = installFakeChrome({ host: 'chrome' });
  try {
    chrome.__manifestCommands = { 'quick-capture': {} };
    chrome.__boundCommands = [];

    assert.equal(await reportUnboundShortcut(), true);
    assert.equal(chrome.__notifications.length, 1);
  } finally {
    restore();
  }
});
