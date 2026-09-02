/**
 * Assembles the Safari web-extension bundle in dist-safari/.
 *
 * The compiled JavaScript is identical to the Chrome build — one tsup run
 * produces both, because `src/platform.ts` detects capabilities at runtime
 * rather than at build time. What differs is the manifest, and only in the
 * three ways the overlay records:
 *
 *   minimum_chrome_version  removed  — meaningless to Safari, which warns on it.
 *   browser_specific_settings added  — Safari's own floor. 18.0 is where MV3
 *                                      service workers and `commands` are both
 *                                      dependable.
 *   permissions             replaced — `notifications` is dropped because Safari
 *                                      implements none, and asking for a
 *                                      permission that can do nothing spends
 *                                      install-time trust for no capability
 *                                      (STRATEGY.md, Distribution & trust).
 *                                      `nativeMessaging` is added because it is
 *                                      how the notice reaches the containing
 *                                      app instead — see src/notify.ts.
 *
 * Run after `tsup`, which is what `npm run build:safari` does.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { mergeManifest } from './manifest-merge.mjs';

const PUBLIC = 'public';
const COMPILED = 'dist';
const OUT = 'dist-safari';
const OVERLAY = 'manifest.safari.json';

const base = JSON.parse(await readFile(join(PUBLIC, 'manifest.json'), 'utf8'));
const overlay = JSON.parse(await readFile(join(PUBLIC, OVERLAY), 'utf8'));
const manifest = mergeManifest(base, overlay);

await mkdir(OUT, { recursive: true });
// Start from a clean directory: a stale bundle left from a previous build is
// indistinguishable from a current one once Xcode has copied it into the app.
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(PUBLIC, OUT, { recursive: true });
// The compiled JavaScript is byte-identical to the Chrome build — one tsup run
// serves both, because platform.ts branches at runtime, not at build time.
await cp(COMPILED, OUT, { recursive: true });
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
// The overlay is a build input, not a shipped asset. Leaving a second
// manifest-shaped file in the bundle puts it in front of Safari's validator.
await rm(join(OUT, OVERLAY), { force: true });

console.log(`Safari bundle assembled in ${OUT}/`);
console.log(`  permissions: ${manifest.permissions.join(', ')}`);
