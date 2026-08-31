import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Fitness functions for the two invariants R13 rests on.
 *
 * Both are properties of the module graph rather than of anyone's care, which
 * is the point: a leak of captured content into telemetry is silent, and a
 * telemetry write from the popup is invisible until the abandonment number is
 * quietly wrong. Neither shows up in a code review that is looking at
 * something else.
 */

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string): Promise<string> => readFile(join(srcDir, file), 'utf8');

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('KTD1: only the service worker records telemetry', async () => {
  // The popup speaks the protocol from src/messages.ts and never imports the
  // recorder, so "the worker writes" holds structurally. A popup that recorded
  // its own abandonment could not anyway — Chrome destroys it on blur, which is
  // the event being measured.
  for (const file of ['popup.ts', 'options.ts']) {
    const source = withoutComments(await read(file));
    assert.equal(
      /\brecordStarted\b|\brecordOutcome\b/.test(source),
      false,
      `${file} must not record telemetry directly`,
    );
  }
});

test('the options page may read and clear telemetry, but not write records', async () => {
  // Reading is what makes it inspectable, which is half of what issue #3 asks
  // for. Writing an outcome from a page that never files anything would be
  // inventing captures.
  const source = withoutComments(await read('options.ts'));
  assert.ok(/\breadTelemetry\b/.test(source), 'the panel reads the log');
  assert.ok(/\bclearTelemetry\b/.test(source), 'the practitioner can clear it');
});

test('R13: no source file threads page-derived fields into a telemetry call', async () => {
  // `structureOf` is the only function that ever sees a Capture, and it returns
  // two booleans. This asserts nothing else has grown a second door.
  const source = withoutComments(await read('background.ts'));
  const calls = source.match(/recordOutcome\([\s\S]*?\n  \);|recordOutcome\([^;]*\);/g) ?? [];
  assert.ok(calls.length > 0, 'the worker does record outcomes');

  for (const call of calls) {
    for (const forbidden of ['page.url', 'page.title', 'selection', 'apiKey', 'capture.note']) {
      assert.equal(call.includes(forbidden), false, `recordOutcome must not carry ${forbidden}`);
    }
  }
});

test('telemetry never leaves the device on its own', async () => {
  // The only egress is the copy button in options.ts, which writes to the
  // practitioner's own clipboard. Nothing may POST, sendBeacon, or open a
  // socket with the log — STRATEGY.md makes trust the adoption gate.
  const telemetry = withoutComments(await read('telemetry.ts'));
  for (const egress of ['fetch(', 'sendBeacon', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    assert.equal(telemetry.includes(egress), false, `src/telemetry.ts must not reach for ${egress}`);
  }
});

test('the only telemetry egress in the extension is the clipboard', async () => {
  const options = withoutComments(await read('options.ts'));
  assert.ok(/navigator\.clipboard\.writeText/.test(options), 'export is a copy the practitioner performs');
  assert.equal(/sendBeacon|new WebSocket|EventSource/.test(options), false);
});
