/**
 * Steps for the domain layer.
 *
 * Every one of these drives `submit()` — the single entry point in
 * src/background.ts where the configured/unconfigured branch and the failure
 * classification live. That is deliberate: `submit()` is the outermost function
 * with no browser vocabulary in its signature, so it is exactly the seam a
 * second platform's driver binds to. Steps that need the browser surface live
 * in chrome-surface.steps.ts and drive `quickCapture()` instead.
 */
import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';

import { HEADLINE_LIMIT, PROVENANCE_MARKER } from '../../src/compose.ts';
import { fileHeldCapture, reviewOnStartup } from '../../src/pending.ts';
import {
  PENDING_CAPTURE_TTL_MS,
  listInFlight,
  readPendingCapture,
  setApiKey,
  setCaptureRoleId,
  writePendingCapture,
} from '../../src/storage.ts';
import type { Capture, WorkType } from '../../src/types.ts';
import { installFakeChrome } from '../../test/support/chrome.ts';
import { PAGE_URL, type ClipperWorld } from '../support/world.ts';

/**
 * `src/background.ts` registers its listeners and calls `enableTrustedContexts()`
 * at module evaluation, so `globalThis.chrome` must exist before it is imported.
 * Static imports are hoisted above every statement here, so the fake is installed
 * first and the module pulled in dynamically after it — the same idiom
 * test/background.test.ts uses, for the same reason.
 *
 * The Before hook replaces this throwaway fake with a fresh one per scenario;
 * this one exists only so the module can be loaded at all.
 */
installFakeChrome();
const { submit } = await import('../../src/background.ts');
await new Promise((resolve) => setImmediate(resolve));

const API_KEY = 'test-key-not-a-real-one';
const CAPTURE_ROLE = 'role_0123456789abcdef0123456789abcdef';
const NAMED_ROLE = 'role_fedcba9876543210fedcba9876543210';

let captureCounter = 0;
const nextCaptureId = (): string => `scenario-capture-${(captureCounter += 1)}`;

function pageCapture(title: string, extra: Partial<Capture> = {}): Capture {
  return {
    page: { url: PAGE_URL, title, capturedAt: '2026-09-01T12:00:00.000Z' },
    ...extra,
  };
}

/**
 * Fires the capture and settles it.
 *
 * A scenario that has armed a never-returning write cannot await `submit()` —
 * that is the whole point of the state it is describing. It is started and
 * abandoned, then the loop is yielded to so the in-flight marker (written
 * before the request goes out) has actually landed in storage.
 */
async function runSubmit(world: ClipperWorld, capture: Capture): Promise<void> {
  const writerFor = async () => world.writer();

  if (world.writeFailure === 'never-returns') {
    void submit(capture, nextCaptureId(), writerFor);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    world.outcome = { state: 'none' };
    return;
  }

  const outcome = await submit(capture, nextCaptureId(), writerFor);
  world.outcome =
    outcome.status === 'filed'
      ? { state: 'filed', item: { ...(outcome.itemId ? { id: outcome.itemId } : {}) } }
      : outcome.status === 'held'
        ? { state: 'held', replacedPending: outcome.replacedPending }
        : { state: 'failed', error: outcome.failure };
}

/* ------------------------------------------------------------------ given -- */

Given('the capture role is configured', async function (this: ClipperWorld) {
  await setApiKey(API_KEY);
  await setCaptureRoleId(CAPTURE_ROLE);
});

// The API key is set and the role is not: "unconfigured" is a set of specific
// gaps, not a boolean, and this scenario is about the role-shaped one.
Given('no capture role is configured', async function (this: ClipperWorld) {
  await setApiKey(API_KEY);
});

Given('the GlassFrog write never returns', function (this: ClipperWorld) {
  this.writeFailure = 'never-returns';
});

Given(
  'a pending capture was made {int} days ago',
  async function (this: ClipperWorld, days: number) {
    const capturedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await writePendingCapture({
      id: 'aged-capture',
      capture: pageCapture('Something sensed a while ago'),
      capturedAt,
    });
    assert.ok(
      days * 24 * 60 * 60 * 1000 > PENDING_CAPTURE_TTL_MS,
      'the scenario only means something if the age is past the TTL',
    );
  },
);

/* ------------------------------------------------------------------- when -- */

When('the practitioner clips the page {string}', async function (this: ClipperWorld, title: string) {
  await runSubmit(this, pageCapture(title));
});

// Same action, stated in the past tense because a later step is the subject.
Given(
  'the practitioner has clipped the page {string}',
  async function (this: ClipperWorld, title: string) {
    await runSubmit(this, pageCapture(title));
  },
);

When(
  'the practitioner clips the page {string} and chooses {word}',
  async function (this: ClipperWorld, title: string, workType: string) {
    await runSubmit(this, pageCapture(title, { workType: workType as WorkType }));
  },
);

When(
  'the practitioner clips the page {string} naming a different role',
  async function (this: ClipperWorld, title: string) {
    await runSubmit(this, pageCapture(title, { roleId: NAMED_ROLE }));
  },
);

When(
  'the practitioner clips the page {string} with the note {string}',
  async function (this: ClipperWorld, title: string, note: string) {
    await runSubmit(this, pageCapture(title, { note }));
  },
);

When(
  'the practitioner clips the page {string} having selected {string}',
  async function (this: ClipperWorld, title: string, selection: string) {
    const capture = pageCapture(title);
    capture.page.selection = selection;
    await runSubmit(this, capture);
  },
);

When(
  'the practitioner clips a page whose title is {int} characters long',
  async function (this: ClipperWorld, length: number) {
    await runSubmit(this, pageCapture('t'.repeat(length)));
  },
);

When(
  'the capture role is configured and the held capture is retried',
  async function (this: ClipperWorld) {
    await setCaptureRoleId(CAPTURE_ROLE);
    await fileHeldCapture(this.writer());
  },
);

When('the extension reviews what it is holding', async function (this: ClipperWorld) {
  await reviewOnStartup();
});

/* ------------------------------------------------------------------- then -- */

Then('one item is filed', function (this: ClipperWorld) {
  assert.equal(this.filed.length, 1, `expected one filed item, found ${this.filed.length}`);
});

Then('nothing is filed', function (this: ClipperWorld) {
  assert.deepEqual(this.filed, [], 'nothing should have reached GlassFrog');
});

Then('it is filed as a {word}', function (this: ClipperWorld, kind: string) {
  assert.equal(this.onlyFiled().kind, kind);
});

Then('it is filed against the capture role', function (this: ClipperWorld) {
  assert.equal(this.onlyFiled().roleId, CAPTURE_ROLE);
});

Then('it is filed against the named role', function (this: ClipperWorld) {
  assert.equal(this.onlyFiled().roleId, NAMED_ROLE);
});

Then('it is not filed against the capture role', function (this: ClipperWorld) {
  assert.notEqual(this.onlyFiled().roleId, CAPTURE_ROLE);
});

Then('the headline carries the provenance marker', function (this: ClipperWorld) {
  const headline = this.headlineOf(this.onlyFiled());
  assert.ok(
    headline.startsWith(PROVENANCE_MARKER),
    `the marker must lead the headline, not merely appear in it — got ${JSON.stringify(headline.slice(0, 80))}`,
  );
});

Then('the headline ends with {string}', function (this: ClipperWorld, tail: string) {
  assert.ok(
    this.headlineOf(this.onlyFiled()).endsWith(tail),
    `expected the headline to end with ${JSON.stringify(tail)}`,
  );
});

Then('the headline is at most {int} characters', function (this: ClipperWorld, limit: number) {
  const headline = this.headlineOf(this.onlyFiled());
  assert.ok(Array.from(headline).length <= limit, `headline was ${headline.length} characters`);
  assert.equal(limit, HEADLINE_LIMIT, 'the scenario should state the limit the code enforces');
});

Then('the detail begins with {string}', function (this: ClipperWorld, head: string) {
  assert.ok(
    this.detailOf(this.onlyFiled()).startsWith(head),
    'the practitioner’s own words come before the evidence the machine gathered',
  );
});

Then('the detail contains {string}', function (this: ClipperWorld, needle: string) {
  assert.ok(this.detailOf(this.onlyFiled()).includes(needle));
});

Then('the detail contains the page address', function (this: ClipperWorld) {
  // Compared field-by-field rather than as a substring of the whole block. The
  // evidence fields are joined by a blank line, so this asserts the URL IS one
  // of them — a substring check would also pass on a URL that merely had this
  // one as a prefix, which is both a weaker assertion and the shape CodeQL
  // flags as incomplete URL sanitization.
  const fields = this.detailOf(this.onlyFiled()).split('\n\n');
  assert.ok(
    fields.includes(PAGE_URL),
    `expected the page address as an evidence field, got ${JSON.stringify(fields)}`,
  );
});

Then('the project links to the page', function (this: ClipperWorld) {
  const item = this.onlyFiled();
  assert.equal(item.kind, 'project');
  assert.equal(item.input.link, PAGE_URL);
});

Then('the capture is held as a pending capture', async function (this: ClipperWorld) {
  assert.equal(this.outcome.state, 'held');
  const pending = await readPendingCapture();
  assert.equal(pending.state, 'current');
});

Then('no pending capture remains', async function (this: ClipperWorld) {
  const pending = await readPendingCapture();
  assert.equal(pending.state, 'absent');
});

Then('the practitioner is told the earlier capture was replaced', function (this: ClipperWorld) {
  assert.equal(this.outcome.state, 'held');
  assert.ok(
    this.outcome.state === 'held' && this.outcome.replacedPending,
    'a silent replacement is the failure this reports against',
  );
});

Then('the held capture is {string}', async function (this: ClipperWorld, title: string) {
  const pending = await readPendingCapture();
  assert.equal(pending.state, 'current');
  assert.equal(pending.state === 'current' ? pending.pending.capture.page.title : undefined, title);
});

Then('nothing is left outstanding', async function (this: ClipperWorld) {
  assert.deepEqual(await listInFlight(), []);
});

Then('one capture is left outstanding', async function (this: ClipperWorld) {
  assert.equal((await listInFlight()).length, 1);
});
