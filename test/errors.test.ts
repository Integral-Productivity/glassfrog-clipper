import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './support/chrome.ts';
import { classifyFailure, redact } from '../src/errors.ts';
import {
  BADGE_CLEAR_ALARM,
  QUICK_CAPTURE_COMMAND,
  clearBadge,
  confirmSuccess,
  reportUnboundShortcut,
  surfaceFailure,
} from '../src/notify.ts';

const API_KEY = 'gfk_live_9f2b71c4e85d43aa8127';

function apiError(status: number, message = 'request failed'): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

test('KTD9: a TypeError from id validation is an unusable role, not a transient failure', () => {
  const failure = classifyFailure(new TypeError('roleId: must match role_<32 hex>'));

  assert.equal(failure.kind, 'unusable-role');
  assert.equal(failure.reconfigure, true, 'R18: retrying this can never succeed');
});

test('KTD9: a structurally-TypeError error classifies even when instanceof fails', () => {
  // A TypeError crossing a message boundary arrives intact but loses its
  // prototype; misclassifying it as transient would advise a useless retry.
  const crossRealm = { name: 'TypeError', message: 'roleId: invalid' };

  assert.equal(classifyFailure(crossRealm).kind, 'unusable-role');
});

test('KTD9: 403 on the role path is an unusable role; status 0 is transient', () => {
  const forbidden = classifyFailure(apiError(403));
  assert.equal(forbidden.kind, 'unusable-role');
  assert.equal(forbidden.reconfigure, true);

  const offline = classifyFailure(apiError(0));
  assert.equal(offline.kind, 'network');
  assert.equal(offline.reconfigure, false, 'preserve-and-retry, not reconfigure');
});

test('KTD9: the four classes stay distinguishable', () => {
  const kinds = [403, 429, 422, 0].map((status) => classifyFailure(apiError(status)).kind);

  assert.deepEqual(kinds, ['unusable-role', 'rate-limited', 'invalid-payload', 'network']);
  assert.equal(new Set(kinds).size, 4, 'each failure class produces a distinguishable message');
});

test('a rejected API key routes to reconfigure rather than retry', () => {
  const failure = classifyFailure(apiError(401));

  assert.equal(failure.reconfigure, true);
  assert.match(failure.message, /options/i, 'it names where to go');
});

test('an unrecognised failure is preserved and surfaced rather than guessed at', () => {
  const failure = classifyFailure(apiError(503, 'upstream exploded'));

  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.reconfigure, false);
  assert.match(failure.message, /upstream exploded/);
});

test('R12: no classified message carries the API key, even when the error echoes it', () => {
  const leaky = apiError(422, `rejected request with X-Auth-Token: ${API_KEY}`);

  const failure = classifyFailure(leaky, { apiKey: API_KEY });

  assert.doesNotMatch(failure.message, new RegExp(API_KEY), 'the key is scrubbed before it can be shown');
  assert.match(failure.message, /\[redacted\]/);
});

test('R12: redaction leaves ordinary text alone and ignores implausible keys', () => {
  assert.equal(redact('nothing secret here', API_KEY), 'nothing secret here');
  // A short "key" would match far too much; scrubbing on it would corrupt text.
  assert.equal(redact('an error about a role', 'role'), 'an error about a role');
});

test('AE7: a successful capture confirms on the badge without opening a window', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await confirmSuccess();

  assert.equal(chrome.__badge.text, '✓');
  assert.equal(chrome.__badge.color, '#2ea064');
  assert.equal(chrome.__notifications.length, 0, 'success raises no notification');
  assert.equal(chrome.__focusTaken, false, 'R14: focus never leaves the active tab');
  assert.ok(
    chrome.__alarms.has(BADGE_CLEAR_ALARM),
    'the badge is cleared on an alarm, since the worker may be dead before a timer fires',
  );
});

test('clearing the badge empties it', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await confirmSuccess();
  await clearBadge();

  assert.equal(chrome.__badge.text, '');
});

test('AE6: a failure is surfaced as a notification carrying the classified message', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  const failure = classifyFailure(apiError(0), { apiKey: API_KEY });
  await surfaceFailure(failure);

  assert.equal(chrome.__notifications.length, 1);
  const surfaced = chrome.__notifications[0];
  assert.equal(surfaced?.options.message, failure.message);
  assert.match(surfaced?.options.title ?? '', /not filed/i);
  assert.equal(chrome.__focusTaken, false);
});

test('a reconfigure failure is titled differently from a transient one', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  await surfaceFailure(classifyFailure(new TypeError('roleId: invalid')));
  await surfaceFailure(classifyFailure(apiError(429)));

  const titles = chrome.__notifications.map((n) => n.options.title);
  assert.equal(new Set(titles).size, 2, 'R18 is legible from the notification alone');
});

test('R12: nothing surfaced to the practitioner contains the API key', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  for (const status of [401, 403, 422, 429, 0, 503]) {
    await surfaceFailure(classifyFailure(apiError(status, `boom ${API_KEY}`), { apiKey: API_KEY }));
  }

  const everythingSurfaced = JSON.stringify(chrome.__notifications);
  assert.doesNotMatch(everythingSurfaced, new RegExp(API_KEY));
});

test('R22: an unbound capture shortcut is reported at startup', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  chrome.__manifestCommands = { [QUICK_CAPTURE_COMMAND]: {} };
  chrome.__boundCommands = [{ name: QUICK_CAPTURE_COMMAND, shortcut: '' }];

  assert.equal(await reportUnboundShortcut(), true);
  assert.equal(chrome.__notifications.length, 1);
  assert.match(chrome.__notifications[0]?.options.message ?? '', /chrome:\/\/extensions\/shortcuts/);
});

test('R22: a bound shortcut reports nothing', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  chrome.__manifestCommands = { [QUICK_CAPTURE_COMMAND]: {} };
  chrome.__boundCommands = [{ name: QUICK_CAPTURE_COMMAND, shortcut: 'Command+Shift+K' }];

  assert.equal(await reportUnboundShortcut(), false);
  assert.equal(chrome.__notifications.length, 0);
});

test('R22: a command missing entirely from getAll is treated as unbound', async (t) => {
  const { chrome, restore } = installFakeChrome();
  t.after(restore);

  chrome.__manifestCommands = { [QUICK_CAPTURE_COMMAND]: {} };
  chrome.__boundCommands = [];

  assert.equal(await reportUnboundShortcut(), true);
});
