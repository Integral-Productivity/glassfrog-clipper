/**
 * Characteristic: **loadability**. The built service worker must be one Chrome
 * can actually register, and small enough that registering it is not itself a
 * cost on the capture path.
 *
 * This is the graduation of `scripts/check-bundle.mjs`, which #69 flagged as an
 * ad-hoc check worth promoting rather than duplicating. That script survived
 * briefly as a shim over this module, so `ci.yml` needed no edit while sibling
 * sessions were changing it. #88 removed both the shim and ci.yml's duplicate
 * step once that had settled, leaving `npm run fitness:self` the only caller.
 * That was safe only because #194 had already made that caller's check
 * required, so this rule still blocks a merge rather than merely reporting one
 * (ADR 0012, ADR 0022).
 *
 * U1's failure mode is the reason any of this exists: a build that reported
 * success while emitting a bundle no MV3 service worker could load. `npm run
 * build` exiting 0 does not catch that. Only looking at the artifact does.
 */
import { readFile, readdir, stat } from 'node:fs/promises';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { fromRoot } from '../root.ts';

export const BUNDLE = 'dist/background.js';

const NAME = 'bundle-shape';
const CHARACTERISTIC = 'loadability — the service worker registers, and registers fast';

/**
 * Matches an import/require of a *bare* specifier — one not starting with `.`
 * or `/`. Deliberately not a search for the package name: esbuild leaves a
 * `// node_modules/...` path comment in the output, and the SDK carries its own
 * name in a User-Agent constant. Failing on those would be a red build with
 * nothing wrong, which is worse than no check at all.
 */
const BARE_IMPORT =
  /(?:^|[;\s])(?:import|export)[^;]{0,400}?from\s*["']([^."'/][^"']*)["']|\brequire\(\s*["']([^."'/][^"']*)["']\s*\)|\bimport\(\s*["']([^."'/][^"']*)["']\s*\)/g;

/**
 * An MV3 service worker has no DOM. A dependency reaching for these at module
 * scope fails registration with an error naming the bundle, not the dependency.
 */
const DOM_ONLY_GLOBALS = ['document', 'localStorage', 'sessionStorage', 'XMLHttpRequest'];

/**
 * 256 KiB, against ~190 KiB today — roughly a third of headroom.
 *
 * The number is a judgement, not a measurement, and it is deliberately loose
 * enough that ordinary growth never trips it. A budget that fires spuriously is
 * a budget somebody raises without reading, which is the same as not having one.
 * What it is sized to catch is a *dependency* landing in the worker, not a
 * feature: the cold-start cost is paid on the first keystroke after the worker
 * has been idle, which STRATEGY.md thresholds at p95 ≤ 2s.
 */
export const BUNDLE_BUDGET_BYTES = 256 * 1024;

/**
 * A build *input* that must never ship inside the Chrome bundle.
 *
 * `npm run build` copies the whole of `public/` into `dist/`, so the Safari
 * manifest overlay rides along unless something removes it. Harmless to Chrome,
 * which ignores files the manifest does not name — but it means the packaged
 * extension carries a manifest describing a different platform, which is the
 * kind of thing a store reviewer notices and a test does not.
 *
 * Arrived with the Apple targets (#66) as a rule inside `scripts/check-bundle.mjs`,
 * and moved here when that script became a shim over this module. The `build`
 * script deletes the file and this asserts it is gone: belt and suspenders, and
 * the assertion is the half that survives someone editing the build script.
 */
const BUILD_INPUTS_THAT_MUST_NOT_SHIP = ['manifest.safari.json'];

/** The pure rule, so it can be exercised against a fixture as well as the real bundle. */
export function bundleViolations(
  source: string,
  sizeBytes: number,
  shippedFiles: string[] = [],
): Violation[] {
  const violations: Violation[] = [];

  for (const input of BUILD_INPUTS_THAT_MUST_NOT_SHIP) {
    if (shippedFiles.includes(input)) {
      violations.push({
        where: `dist/${input}`,
        detail:
          'is a build input for another platform, not part of the Chrome extension. ' +
          'Check the `build` script in package.json.',
      });
    }
  }

  const bare = new Set<string>();
  for (const match of source.matchAll(BARE_IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) bare.add(specifier);
  }
  if (bare.size > 0) {
    violations.push({
      where: BUNDLE,
      detail:
        `imports bare specifiers: ${[...bare].sort().join(', ')}. An MV3 service worker ` +
        'has no module resolver — check `noExternal` in tsup.config.ts.',
    });
  }

  const domGlobals = DOM_ONLY_GLOBALS.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
  if (domGlobals.length > 0) {
    violations.push({
      where: BUNDLE,
      detail:
        `references DOM-only globals: ${domGlobals.join(', ')}. These are undefined in a ` +
        'service worker and fail registration at load.',
    });
  }

  if (sizeBytes > BUNDLE_BUDGET_BYTES) {
    violations.push({
      where: BUNDLE,
      detail:
        `is ${(sizeBytes / 1024).toFixed(0)} KiB, over the ${BUNDLE_BUDGET_BYTES / 1024} KiB budget. ` +
        'Cold-start cost lands on the first keystroke after idle. Trim it, or raise the budget ' +
        'in a commit that says what got bigger and why that is acceptable.',
    });
  }

  return violations;
}

export async function runBundleShapeCheck(): Promise<CheckResult> {
  let source: string;
  let sizeBytes: number;
  let shipped: string[];

  try {
    source = await readFile(fromRoot(BUNDLE), 'utf8');
    sizeBytes = (await stat(fromRoot(BUNDLE))).size;
    shipped = await readdir(fromRoot('dist'));
  } catch {
    // A missing bundle is a failure, never a skip. "Nothing to check" is how a
    // gate quietly stops gating — and the reusable runs this after a build, so
    // an absent artifact means the build did not produce what it claims to.
    return fail(NAME, CHARACTERISTIC, 'the built service worker is missing', [
      { where: BUNDLE, detail: 'not found — run `npm run build` before the fitness suite.' },
    ]);
  }

  const violations = bundleViolations(source, sizeBytes, shipped);

  return violations.length === 0
    ? pass(
        NAME,
        CHARACTERISTIC,
        `${BUNDLE} is ${(sizeBytes / 1024).toFixed(0)} KiB, with no bare imports and no DOM-only globals.`,
      )
    : fail(NAME, CHARACTERISTIC, 'the built service worker would not load, or is over budget', violations);
}
