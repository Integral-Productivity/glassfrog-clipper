/**
 * Characteristic: **navigability of the decision record**, defended one step
 * earlier than `adr-numbering.ts` defends it.
 *
 * These two files are siblings and it matters which gap each one closes.
 *
 * `adr-numbering.ts` runs on the merged tree — head plus base — so it sees
 * `main`'s ADRs and fails the pull request that would land a duplicate. That is
 * the belt, and #83 confirmed it works *provided* the tree it ran against is
 * current. `strict_required_status_checks_policy` is what keeps it current; see
 * `REQUIRE_UP_TO_DATE_BRANCHES` in test/branch-protection.test.ts.
 *
 * What neither of those can do is tell you about a collision before it is a
 * merge conflict of numbers. On 2026-09-02 PRs #61 and #66 both carried a
 * `docs/adr/0007-*.md`. Each was correct on its own; `docs/adr/` on `main` ended
 * at 0006, so a directory listing showed 0007 free, and neither PR named the
 * number anywhere a title or body search would index it — it existed only in a
 * file path. The belt would have caught whichever merged second, in the form of
 * a red on a branch its author thought was finished, with a renumber to do.
 *
 * This check reads the claim out of the one place it actually lives — the paths
 * a pull request changes — and reports it while both branches are still open and
 * cheap to move. That is the whole of its job. It deliberately does NOT look at
 * `main`: the belt already covers that, and a second reporter of the same fact
 * is a second thing to disagree.
 *
 * WHY THIS IS NOT IN `fitness/checks/`. It was, briefly, on the reasoning that it
 * belongs beside its sibling. `test/fitness/suite.test.ts` rejected that, and was
 * right to: every file in that directory must be registered in `CHECKS` and run
 * by the offline self-compliance gate, precisely so a check cannot quietly stop
 * being run. This one asks a question about the state of a remote forge, so it
 * can never be offline or deterministic, and registering it would have meant
 * putting a network call inside the gate — or adding an exemption that blunts the
 * guard for every future check too. The rules below stay pure and testable; the
 * network lives in scripts/check-adr-claims.ts, a step in the `verify` job.
 */

/** A pull request's changed files, in the shape `GET /pulls/{n}/files` returns. */
export interface ChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
}

export interface AdrClaim {
  pullRequest: number;
  numbers: string[];
}

export interface ClaimCollision {
  number: string;
  /** Every open pull request claiming it, including the subject, sorted. */
  pullRequests: number[];
}

const ADR_PATH = /^docs\/adr\/(\d{4})-.+\.md$/;

/**
 * The statuses that bring a path into existence that was not on the base branch.
 *
 * A *claim* is the creation of a numbered path, not any touch of one. That
 * distinction is the whole correctness of this check, and it was found by
 * running the scan against the live repository rather than by reasoning about
 * it: PR #100 came back claiming `0011`, which it does not — it edits the 0011
 * already on `main`. Counting `modified` would report every pair of pull
 * requests that happened to edit the same existing ADR as a numbering
 * collision, which is not one. Two branches cannot duplicate a number that is
 * already taken on the base; at worst they conflict, and git says so.
 *
 * `removed` is excluded for the mirror-image reason, and it is the most
 * load-bearing exclusion here. A renumber — the very commit that *resolves* a
 * collision — deletes `0007-*.md` and adds `0008-*.md` in one pull request, as
 * commit 3e926b4 did on #66. Counting the deletion as a claim would make the fix
 * indistinguishable from the problem, so this check would go red on the branch
 * that had just done the right thing, and the only way to ship would be to
 * switch it off.
 *
 * `renamed` is counted at its new path only. GitHub reports the old one
 * separately as `previous_filename`, which is deliberately not read: a rename
 * away from a number releases it rather than claiming it.
 */
const CREATES_A_PATH: ReadonlySet<ChangedFile['status']> = new Set(['added', 'renamed', 'copied']);

/**
 * The ADR numbers a pull request newly claims, from the paths it creates.
 *
 * Paths that carry no `NNNN-` prefix are skipped, matching `duplicateAdrNumbers`
 * in fitness/checks/adr-numbering.ts — a README in `docs/adr/` claims nothing.
 */
export function claimedAdrNumbers(files: ChangedFile[]): string[] {
  const numbers = new Set<string>();

  for (const { filename, status } of files) {
    if (!CREATES_A_PATH.has(status)) continue;
    const number = ADR_PATH.exec(filename)?.[1];
    if (number !== undefined) numbers.add(number);
  }

  return [...numbers].sort();
}

/**
 * Every number the subject pull request claims that another open pull request
 * also claims.
 *
 * Scoped to the subject on purpose. A collision between two pull requests that
 * are both somebody else's is not this run's business, and reporting it would
 * put a red on a branch with nothing to fix — the fastest way to teach people
 * that this check's failures can be ignored.
 *
 * Both sides of a real collision go red, and either one renumbering clears both.
 * That is intended: the check cannot know which branch is cheaper to move, and
 * guessing would be worse than saying so. The failure message names the other
 * pull request so a human can apply the rule #83 settled — the one opened first
 * keeps the number.
 */
export function collidingClaims(subject: AdrClaim, others: AdrClaim[]): ClaimCollision[] {
  const claimants = new Map<string, Set<number>>();

  for (const number of subject.numbers) claimants.set(number, new Set([subject.pullRequest]));

  for (const other of others) {
    // A pull request cannot collide with itself. Without this, a caller that
    // fails to filter the subject out of the listing gets a confident report
    // that every ADR it adds is already taken — by itself.
    if (other.pullRequest === subject.pullRequest) continue;

    for (const number of other.numbers) {
      claimants.get(number)?.add(other.pullRequest);
    }
  }

  return [...claimants.entries()]
    .filter(([, pullRequests]) => pullRequests.size > 1)
    .map(([number, pullRequests]) => ({ number, pullRequests: [...pullRequests].sort((a, b) => a - b) }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

/**
 * A pull request number, or `undefined` if the input is not one.
 *
 * Exists because of a real asymmetry CodeQL found in the caller, not a
 * hypothetical one. `scripts/check-adr-claims.ts` read the subject PR from two
 * places: `--pr N`, which it validated with `Number.isInteger`, and the Actions
 * event payload, which it did not. The payload arrives through
 * `JSON.parse(...) as { pull_request?: { number?: number } }`, and that cast
 * reads like a check while being none — it is a compile-time assertion over a
 * value that is `any` at runtime. Nothing stopped a non-numeric `number` field
 * from reaching a request path, and `"1/../../orgs/evil"` is a string that
 * template interpolation is perfectly happy to substitute.
 *
 * The event file is written by the Actions runner, so this was not exploitable
 * as it stood. That is a reason the risk was low; it is not a reason for one
 * path to be validated and the other not. The asymmetry is the defect — it stays
 * true right up until someone reuses the function somewhere the input is not
 * the runner's.
 *
 * Rejects non-integers, non-positives, and the strings that coerce quietly:
 * `Number('')` and `Number(' ')` are both `0`, and `Number(null)` is `0`, so a
 * bare `Number(x)` with an `Number.isInteger` check would accept all three.
 */
export function pullRequestNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  // `Number('')`, `Number('  ')` and `Number('\n')` are 0, not NaN.
  if (typeof value === 'string' && value.trim() === '') return undefined;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** The failure text, kept beside the rule so the message is testable too. */
export function describeCollisions(collisions: ClaimCollision[]): string {
  return collisions
    .map(({ number, pullRequests }) => {
      const others = pullRequests.join(', #');
      return `ADR ${number} is claimed by more than one open pull request: #${others}. The one opened first keeps the number; the other renumbers to the next free slot — filename and heading both — and updates any references. See #83.`;
    })
    .join('\n');
}
