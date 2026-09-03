import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * A trailing slash in `.gitignore` makes a pattern directory-only, and git does
 * not consider a symlink a directory. So `node_modules/` ignores a real
 * `node_modules` and silently fails to ignore a symlinked one:
 *
 *   symlink   -> git check-ignore: exit 1, no output -> `?? node_modules`
 *   real dir  -> git check-ignore: .gitignore:1:node_modules/
 *
 * That gap was live on 2026-09-02 (#171). It matters here more than in most
 * repositories because `npm ci` needs a `read:packages` token, so the practical
 * way to run `npm run typecheck` or `npm test` inside a `.claude/worktrees/*`
 * worktree is to point at the main clone's already-installed tree:
 *
 *   ln -s ~/GitHub/glassfrog-clipper-chrome-extension/node_modules node_modules
 *
 * The residue is an untracked symlink holding an absolute path into one
 * machine's home directory, one `git add -A` away from being committed — next
 * to a hazard this repository has already been bitten by, where `git add -A`
 * after a half-failed `checkout -b` committed a sibling session's diff.
 *
 * WHY THIS ASSERTS FILE CONTENT RATHER THAN BEHAVIOUR. The faithful test would
 * create a symlink and run `git check-ignore` on it. That writes into the
 * working tree of whatever checkout runs the suite, and leaves debris if it
 * fails part-way — a guard against stray untracked files should not create
 * stray untracked files. The pattern text is the whole mechanism here, so
 * asserting the text loses nothing: there is no path by which these patterns
 * are correct and still carry a slash.
 *
 * The apple entries are deliberately out of scope. They name build output
 * nested deep inside a directory tree nobody symlinks, and a double-star path
 * segment composes with a trailing slash differently from a top-level name.
 */

/** Generated or vendored content a developer might plausibly symlink to a shared copy. */
const SYMLINKABLE = ['node_modules', 'dist', 'dist-safari', 'release'];

test('no symlinkable ignore pattern is narrowed by a trailing slash', async () => {
  const lines = (await readFile(new URL('../.gitignore', import.meta.url), 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  const narrowed = SYMLINKABLE.filter((name) => lines.includes(`${name}/`));

  assert.deepEqual(
    narrowed,
    [],
    `.gitignore lists ${narrowed.map((n) => `"${n}/"`).join(', ')} with a trailing slash, ` +
      'which matches a directory but not a symlink of the same name. Drop the slash.',
  );
});

test('every symlinkable name is still ignored in some form', async () => {
  const lines = (await readFile(new URL('../.gitignore', import.meta.url), 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  const missing = SYMLINKABLE.filter(
    (name) => !lines.includes(name) && !lines.includes(`${name}/`),
  );

  assert.deepEqual(
    missing,
    [],
    `.gitignore no longer ignores ${missing.join(', ')} at all — the slash-stripping fix for ` +
      '#171 must not become a deletion. Removing the entry would pass the other test in this file.',
  );
});
