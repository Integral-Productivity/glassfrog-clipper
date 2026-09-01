/**
 * Steps for the Chrome surface layer.
 *
 * These drive `quickCapture()` — the function that reads the active tab — where
 * the domain steps drive `submit()`, which takes an already-assembled capture.
 * That split is the two layers made mechanical: if a step here can be written
 * against `submit()`, it belongs in the domain layer instead.
 *
 * Read the boundary note at the top of features/surface/chrome.feature before
 * trusting a green run here. It exercises `test/support/chrome.ts`, a fake, so
 * it can only prove that our encoded assumptions about Chrome are still held by
 * the code — never that Chrome behaves as assumed.
 */
import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';

import { EVIDENCE_FIELD_LIMIT } from '../../src/compose.ts';
import { installFakeChrome } from '../../test/support/chrome.ts';
import type { ClipperWorld } from '../support/world.ts';

// See the note in capture.steps.ts: background.ts needs `chrome` to exist at
// module evaluation, so the fake goes up before the dynamic import.
installFakeChrome();
const { quickCapture } = await import('../../src/background.ts');
await new Promise((resolve) => setImmediate(resolve));

const TAB_URL = 'https://example.test/the-page';

/** An ordinary readable tab, which most of these scenarios start from. */
function readableTab(): chrome.tabs.Tab {
  return { id: 1, url: TAB_URL, title: 'A page worth clipping' } as chrome.tabs.Tab;
}

/**
 * Wraps the fake's executeScript so the read is recorded in the world's event
 * log. Ordering is the only thing one of these scenarios is about, and it is
 * unobservable without this.
 */
function recordSelectionReads(world: ClipperWorld): void {
  const inner = world.chrome.scripting.executeScript.bind(world.chrome.scripting);
  world.chrome.scripting.executeScript = async (injection) => {
    world.events.push('selection-read');
    return inner(injection);
  };
}

Given('the page has the selection {string}', function (this: ClipperWorld, selection: string) {
  this.chrome.__tabs = [readableTab()];
  this.chrome.__selection = selection;
  recordSelectionReads(this);
});

Given('the page has a selection of {int} characters', function (this: ClipperWorld, length: number) {
  this.chrome.__tabs = [readableTab()];
  this.chrome.__selection = 's'.repeat(length);
  recordSelectionReads(this);
});

// A page may refuse injection outright — a CSP, a restricted origin. The URL
// and title are still worth filing, so this must not read as a capture failure.
Given('the page forbids script injection', function (this: ClipperWorld) {
  this.chrome.__tabs = [readableTab()];
  this.chrome.scripting.executeScript = async () => {
    throw new Error('Cannot access contents of the page');
  };
});

// chrome:// pages and the Web Store deny activeTab, so no URL ever arrives.
Given('the active tab cannot be read', function (this: ClipperWorld) {
  this.chrome.__tabs = [{ id: 1 } as chrome.tabs.Tab];
});

When('the practitioner triggers a quick capture', async function (this: ClipperWorld) {
  await quickCapture(async () => this.writer());
});

Then(
  'the selection was read before anything was sent to GlassFrog',
  function (this: ClipperWorld) {
    const read = this.events.indexOf('selection-read');
    const wrote = this.events.indexOf('write');
    assert.notEqual(read, -1, 'the selection was never read at all');
    assert.notEqual(wrote, -1, 'nothing was ever written');
    assert.ok(
      read < wrote,
      `activeTab is revoked on navigation, so the read must precede the write — got ${this.events.join(' → ')}`,
    );
  },
);

Then(
  'the filed evidence is bounded to {int} characters per page field',
  function (this: ClipperWorld, limit: number) {
    assert.equal(
      limit,
      EVIDENCE_FIELD_LIMIT,
      'the scenario should state the limit the code actually enforces',
    );
    // The evidence block joins each page-derived field with a blank line, and
    // the cap is per field rather than over the whole item.
    for (const field of this.detailOf(this.onlyFiled()).split('\n\n')) {
      assert.ok(
        Array.from(field).length <= limit,
        `a page field reached ${Array.from(field).length} characters`,
      );
    }
  },
);
