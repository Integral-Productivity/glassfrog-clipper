import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type ChangedFile,
  claimedAdrNumbers,
  collidingClaims,
  describeCollisions,
} from '../scripts/adr-claims.ts';

/**
 * A fitness function for ADR numbers claimed by pull requests that are still
 * open — the collision `fitness/checks/adr-numbering.ts` can only report once both branches
 * have met.
 *
 * The scenario is #83, reproduced from the real pull requests. On 2026-09-02
 * #61 added `docs/adr/0007-telemetry-…md` and #66 added
 * `docs/adr/0007-the-apple-build-…md`. `docs/adr/` on `main` ended at 0006, so
 * neither author picked a taken number, and neither number appeared in a title
 * or body where the pre-claim search of the day would have found it.
 *
 * These rules are pure so the red half of every one of them can be exercised
 * here against a fixture rather than against the forge. The network half lives
 * in scripts/check-adr-claims.ts.
 */

const added = (filename: string): ChangedFile => ({ filename, status: 'added' });

test('a pull request claims the ADR numbers in the paths it adds', () => {
  assert.deepEqual(
    claimedAdrNumbers([
      added('docs/adr/0007-telemetry-is-local-only-and-allowlisted-at-the-write-boundary.md'),
      added('src/telemetry.ts'),
      added('test/telemetry.test.ts'),
    ]),
    ['0007'],
  );
});

test('the two pull requests of #83 are reported as colliding', () => {
  // The real case, in the shape the forge reports it.
  const sixtyOne = {
    pullRequest: 61,
    numbers: claimedAdrNumbers([added('docs/adr/0007-telemetry-is-local-only-and-allowlisted-at-the-write-boundary.md')]),
  };
  const sixtySix = {
    pullRequest: 66,
    numbers: claimedAdrNumbers([added('docs/adr/0007-the-apple-build-shares-this-repo-and-this-capture-path.md')]),
  };

  assert.deepEqual(collidingClaims(sixtyOne, [sixtySix]), [{ number: '0007', pullRequests: [61, 66] }]);
});

test('a deleted ADR path is a release of the number, not a claim on it', () => {
  // The load-bearing case. The renumber that RESOLVES a collision deletes
  // 0007-*.md and adds 0008-*.md in one pull request — exactly what commit
  // 3e926b4 did on #66. If `removed` counted as a claim, this check would go red
  // on the branch that had just fixed the problem, and the only way to ship
  // would be to switch the check off.
  assert.deepEqual(
    claimedAdrNumbers([
      { filename: 'docs/adr/0007-the-apple-build-shares-this-repo-and-this-capture-path.md', status: 'removed' },
      added('docs/adr/0008-the-apple-build-shares-this-repo-and-this-capture-path.md'),
    ]),
    ['0008'],
  );
});

test('editing an ADR that already exists is not a claim on its number', () => {
  // Found by running the scan against the live repository rather than by
  // reasoning about it. PR #100 came back claiming 0011, which it does not: it
  // edits the 0011 already on `main`. Without this, two pull requests that both
  // touch an existing ADR are reported as a numbering collision — which is not
  // one, because the number is already taken on the base and no duplicate file
  // can result.
  assert.deepEqual(
    claimedAdrNumbers([
      {
        filename: 'docs/adr/0011-behaviour-is-specified-at-the-domain-with-a-thin-platform-surface-layer.md',
        status: 'modified',
      },
    ]),
    [],
  );
});

test('a renumber that GitHub reports as a rename claims only the new number', () => {
  // `git mv` at 100% similarity is reported as `renamed` rather than as an
  // add/remove pair — which is how #42's renumber appeared. The number moved
  // away from must not be counted, or the fix reads as the collision again.
  assert.deepEqual(
    claimedAdrNumbers([
      { filename: 'docs/adr/0008-the-apple-build-shares-this-repo-and-this-capture-path.md', status: 'renamed' },
    ]),
    ['0008'],
  );
});

test('a pull request does not collide with itself', () => {
  // A caller that forgets to filter the subject out of the open-PR listing would
  // otherwise be told, confidently, that the number it is adding is taken — by
  // itself. Unfixable by the author, and indistinguishable from a real report.
  const subject = { pullRequest: 61, numbers: ['0007'] };

  assert.deepEqual(collidingClaims(subject, [subject]), []);
});

test('a collision between two other pull requests is not this run’s problem', () => {
  // Reporting it would put a red on a branch with nothing to fix, which is the
  // fastest way to teach people that this check can be ignored.
  assert.deepEqual(
    collidingClaims({ pullRequest: 90, numbers: ['0012'] }, [
      { pullRequest: 61, numbers: ['0007'] },
      { pullRequest: 66, numbers: ['0007'] },
    ]),
    [],
  );
});

test('distinct numbers on concurrent pull requests are not a collision', () => {
  // The ordinary case, and it must stay green: two ADRs in flight at once is
  // normal and fine as long as they took different slots.
  assert.deepEqual(
    collidingClaims({ pullRequest: 61, numbers: ['0007'] }, [{ pullRequest: 66, numbers: ['0008'] }]),
    [],
  );
});

test('every pull request claiming a number is named, not just the first', () => {
  // Three-way collisions are rarer but not hypothetical — #86 claimed both 0010
  // and 0011 while #83 was open. A message naming one other branch would send
  // the author to renumber into a slot the third had already taken.
  assert.deepEqual(
    collidingClaims({ pullRequest: 61, numbers: ['0007'] }, [
      { pullRequest: 90, numbers: ['0007'] },
      { pullRequest: 66, numbers: ['0007'] },
    ]),
    [{ number: '0007', pullRequests: [61, 66, 90] }],
  );
});

test('paths that are not numbered ADRs claim nothing', () => {
  // A guard that cries wolf on `docs/adr/README.md` gets disabled. Matches the
  // skip in `duplicateAdrNumbers`.
  assert.deepEqual(
    claimedAdrNumbers([
      added('docs/adr/README.md'),
      added('docs/adr/template.md'),
      added('docs/solutions/0007-not-an-adr.md'),
      added('README.md'),
    ]),
    [],
  );
});

test('the failure message names the other branch and the rule for resolving it', () => {
  // The message is the whole product of this check — a red that does not say
  // which branch to move, or by what rule, costs more than it saves.
  const message = describeCollisions([{ number: '0007', pullRequests: [61, 66] }]);

  assert.match(message, /ADR 0007/);
  assert.match(message, /#61, #66/);
  assert.match(message, /opened first keeps the number/);
});

test('no collisions renders as no message', () => {
  assert.equal(describeCollisions([]), '');
});
