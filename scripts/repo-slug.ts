import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Which repository this is, read from the one place that has to hold it anyway.
 *
 * Not a test file: importing a test file re-runs its tests, so a constant that
 * two suites and a CI script all need lives here instead. See
 * `test/repo-identity.test.ts` for why the copies that remain are cross-checked.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pull `owner/name` out of a git remote URL. Handles the HTTPS form this repo
 * uses (`git+https://github.com/owner/name.git`) and the SSH form
 * (`git@github.com:owner/name.git`), with or without the `.git` suffix.
 */
export function slugFromRepositoryUrl(url: string): string {
  // `noUncheckedIndexedAccess` types a capture group as possibly undefined, so
  // the group is narrowed rather than the match — a non-null match does not by
  // itself prove group 1 was filled.
  const slug = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1];
  if (slug === undefined) throw new Error(`cannot read a GitHub slug out of ${url}`);
  return slug;
}

/** The slug `package.json` declares. */
export function repoSlug(): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    repository: { url: string };
  };
  return slugFromRepositoryUrl(pkg.repository.url);
}
