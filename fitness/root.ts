/**
 * The repo root, derived from this file's own location rather than from the
 * process's working directory.
 *
 * Every check reads real files. Resolving them against `cwd` works for `npm run
 * fitness:self` and for CI, and produces a confusing *red* the moment anyone
 * runs the CLI from a subdirectory — "dist/background.js not found" reported as
 * an architecture violation. A false red is cheaper than a false green, but it
 * is still the check lying about what it looked at.
 *
 * The same idiom the unit suite already uses.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A repo-relative path, resolved absolutely. */
export const fromRoot = (...segments: string[]): string => join(REPO_ROOT, ...segments);
