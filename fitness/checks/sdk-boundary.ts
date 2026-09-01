/**
 * Characteristic: **evolvability of the GlassFrog integration**.
 *
 * ADR 0002 chose the org's canonical client over raw `fetch`, on composition
 * over invention, and recorded the payoff explicitly: "a v5 API change is
 * absorbed by an SDK version bump rather than by edits in this repo." That
 * property holds only while every call really does go through the SDK, behind
 * the `CaptureWriter` port.
 *
 * This erodes differently from the other three. A stray `fetch` to
 * api.glassfrog.com works perfectly — until v5 changes, at which point the SDK
 * bump fixes every call site except the one that bypassed it, and the failure
 * surfaces far from its cause. Slow erosion, delayed cost, no red anywhere in
 * between. That combination is exactly what a fitness function is for.
 *
 * Two lines, because the boundary has two sides:
 *
 *   1. Only `src/glassfrog.ts` imports the SDK. Everything above it talks to the
 *      port, which is also what lets the whole capture path be tested without
 *      resolving the SDK at all.
 *   2. Nothing anywhere puts GlassFrog on the wire by hand.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { fromRoot } from '../root.ts';

const NAME = 'sdk-boundary';
const CHARACTERISTIC = 'evolvability — a v5 change is an SDK bump, not a sweep of this repo';

/** The one module allowed to know GlassFrog's method names. */
export const ADAPTER = 'src/glassfrog.ts';

const SDK_PACKAGE = '@integral-productivity/glassfrog';

/** A hand-rolled HTTP call aimed at GlassFrog, however it is spelled. */
const DIRECT_HTTP =
  /\b(?:fetch|XMLHttpRequest|axios)\b[^\n]{0,200}?(?:api\.glassfrog\.com|glassfrog\.com\/api)/;

/**
 * The GlassFrog host, read from the manifest rather than repeated here.
 *
 * `public/manifest.json` already declares the one origin this extension may
 * reach, and `manifest-permissions` pins it to exactly that value. Hardcoding it
 * a second time would put the same constant in two places, so a change to the
 * origin would move the boundary without moving the check that guards it.
 *
 * Searched for as a plain substring, not a regex: this is a grep over a `.ts`
 * file, not a check on a URL. There is nothing to anchor, and an unanchored host
 * *pattern* is what CodeQL's `js/regex/missing-regexp-anchor` warns about —
 * correctly, in the context that rule is written for.
 */
async function glassfrogHost(): Promise<string> {
  const manifest = JSON.parse(await readFile(fromRoot('public', 'manifest.json'), 'utf8'));
  const [origin] = manifest.host_permissions ?? [];
  if (typeof origin !== 'string') {
    throw new Error('public/manifest.json declares no host_permissions to derive the boundary from');
  }
  return new URL(origin.replace(/\/\*$/, '')).hostname;
}

/** The pure rule over one file, so a fixture can exercise the red path. */
export function boundaryViolations(path: string, source: string, host: string): Violation[] {
  const violations: Violation[] = [];
  const isAdapter = path === ADAPTER;

  if (!isAdapter && new RegExp(`from\\s*['"]${SDK_PACKAGE}`).test(source)) {
    violations.push({
      where: path,
      detail:
        `imports ${SDK_PACKAGE} directly. Everything above ${ADAPTER} talks to the ` +
        'CaptureWriter port — that seam is what lets the capture path be tested without the SDK.',
    });
  }

  if (!isAdapter && DIRECT_HTTP.test(source)) {
    violations.push({
      where: path,
      detail:
        'puts GlassFrog on the wire directly. A raw call works until v5 changes, and then the ' +
        `SDK bump fixes every call site except this one. Route it through ${ADAPTER}.`,
    });
  }

  // The origin outside the adapter is not automatically wrong — the manifest's
  // host_permissions names it too — but in a source file it is the strongest
  // available signal that a second client is being grown.
  if (!isAdapter && source.includes(host) && !DIRECT_HTTP.test(source)) {
    violations.push({
      where: path,
      detail:
        `names api.glassfrog.com outside ${ADAPTER}. The base URL is the SDK's to own; ` +
        'a second place that knows it is a second client waiting to happen.',
    });
  }

  return violations;
}

export async function runSdkBoundaryCheck(): Promise<CheckResult> {
  const files = (await readdir(fromRoot('src'))).filter((name) => name.endsWith('.ts'));
  const violations: Violation[] = [];
  const host = await glassfrogHost();

  for (const file of files) {
    const path = join('src', file);
    violations.push(...boundaryViolations(path, await readFile(fromRoot(path), 'utf8'), host));
  }

  // The adapter existing at all is part of the invariant: if it were deleted or
  // renamed, every file would pass the rules above while the boundary was gone.
  const adapterSource = await readFile(fromRoot(ADAPTER), 'utf8').catch(() => '');
  if (!new RegExp(`from\\s*['"]${SDK_PACKAGE}`).test(adapterSource)) {
    violations.push({
      where: ADAPTER,
      detail:
        `no longer imports ${SDK_PACKAGE}. Either the adapter moved — update ADAPTER here — ` +
        'or the SDK is gone, which is an ADR 0002 decision being reversed rather than a refactor.',
    });
  }

  return violations.length === 0
    ? pass(NAME, CHARACTERISTIC, `${files.length} source files; only ${ADAPTER} knows GlassFrog.`)
    : fail(NAME, CHARACTERISTIC, 'the SDK boundary has been bypassed', violations);
}
