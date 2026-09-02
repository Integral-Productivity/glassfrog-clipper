/**
 * Artifact checks for the built service-worker bundle.
 *
 * U1's failure mode was a build that reported success while emitting a bundle
 * no MV3 service worker can load. `npm run build` exiting 0 does not catch
 * that; only looking at the artifact does.
 *
 * Run after `npm run build`. Exits non-zero with a message naming the cause.
 */
import { readFile } from 'node:fs/promises';

const BUNDLE = 'dist/background.js';

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

const problems = [];
const source = await readFile(BUNDLE, 'utf8');

/**
 * The Safari manifest overlay is a build *input*, and `npm run build` copies the
 * whole of `public/` into `dist/`. Without this it rides along into the Chrome
 * bundle — harmless to Chrome, which ignores files the manifest does not name,
 * but it means the packaged extension carries a manifest describing a different
 * platform. `scripts/build-safari.mjs` already removes it from the Safari
 * bundle for the same reason; this is the other half of that.
 */
const { readdir } = await import('node:fs/promises');
const shipped = await readdir('dist');
if (shipped.includes('manifest.safari.json')) {
  problems.push(
    'dist/ ships manifest.safari.json, which is a build input for the Safari ' +
      'bundle and not part of the Chrome extension. Check the `build` script.',
  );
}

const bare = new Set();
for (const match of source.matchAll(BARE_IMPORT)) {
  bare.add(match[1] ?? match[2] ?? match[3]);
}
if (bare.size > 0) {
  problems.push(
    `${BUNDLE} imports bare specifiers: ${[...bare].join(', ')}. ` +
      'An MV3 service worker has no module resolver — check `noExternal` in tsup.config.ts.',
  );
}

const domGlobals = DOM_ONLY_GLOBALS.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
if (domGlobals.length > 0) {
  problems.push(
    `${BUNDLE} references DOM-only globals: ${domGlobals.join(', ')}. ` +
      'These are undefined in a service worker and fail registration at load.',
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

console.log(`${BUNDLE}: no bare imports, no DOM-only globals.`);
