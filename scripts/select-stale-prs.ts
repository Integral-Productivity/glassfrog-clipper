import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Which open pull requests may be brought forward unattended.
 *
 * `main` runs with `strict_required_status_checks_policy` on (ADR 0012/0013),
 * so a pull request that falls behind cannot merge until something updates it.
 * Nothing did: auto-merge will not merge a behind branch, and no workflow
 * brought one forward, so an unattended pull request sat behind until a person
 * typed the command. Measured over 30 days, 46% of merged pull requests went
 * behind at least once and 16% five or more times (#126).
 *
 * The selection is the whole risk, which is why it is here rather than as `jq`
 * inside the workflow. Updating a branch **rewrites it** — `--rebase` replaces
 * every commit's SHA — so choosing the wrong pull request does not merely waste
 * a run, it force-pushes over somebody's branch. A pure function over the shape
 * `gh pr list --json` returns can be given fixtures and a red half; a filter
 * expression embedded in YAML cannot.
 *
 * TypeScript rather than `.mjs` so `test/update-pr-branches.test.ts` can import
 * it under `tsc --noEmit`, and run directly with
 * `node scripts/select-stale-prs.ts` the way `ci.yml` already runs
 * `scripts/check-adr-claims.ts`.
 */

/** One label, as `gh pr list --json labels` returns it. */
export interface PullRequestLabel {
  name?: string | null;
}

/** One `statusCheckRollup` entry: a check run reports `conclusion`, a legacy status reports `state`. */
export interface RollupEntry {
  conclusion?: string | null;
  state?: string | null;
}

/** The subset of `gh pr list --json …` this selection reads. */
export interface PullRequest {
  number: number;
  mergeStateStatus?: string | null;
  isDraft?: boolean;
  labels?: PullRequestLabel[];
  headRefName?: string | null;
  autoMergeRequest?: unknown;
  statusCheckRollup?: RollupEntry[];
}

/**
 * Labels that mean "a person is still holding this", checked case-insensitively.
 *
 * `hold-for-review` is named by #126 and is **not** in
 * `docs/agents/labels.json` today, so nothing carries it and this half of the
 * filter is currently inert. That is deliberate: honouring the name costs
 * nothing and makes the label work the day someone declares it, whereas adding
 * it to the manifest here would be a label-vocabulary change #126 did not ask
 * for. `ready-for-human` is included because it already means exactly this.
 */
export const HOLD_LABELS: readonly string[] = ['hold-for-review', 'ready-for-human'];

/** Head-branch prefix an automated session owns, and may therefore rebase. */
export const AGENT_BRANCH_PREFIX = 'claude/';

/**
 * Check conclusions that mean "do not touch this yet".
 *
 * A pull request whose own checks are failing gains nothing from being brought
 * forward — it still cannot merge — and rebasing it destroys the SHAs whose
 * logs someone may be reading. `PENDING` is not here: a run in flight is the
 * ordinary state of a fresh push, and refusing to ever update a pull request
 * with a queued check would make this workflow fire almost never.
 */
const BLOCKING_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STALE']);

const labelNames = (pr: PullRequest): string[] =>
  (pr.labels ?? []).map((label) => String(label?.name ?? '').toLowerCase());

/** Whether any check on the head commit has already resolved badly. */
export function hasFailingChecks(pr: PullRequest): boolean {
  return (pr.statusCheckRollup ?? []).some((check) =>
    BLOCKING_CONCLUSIONS.has(String(check?.conclusion ?? check?.state ?? '').toUpperCase()),
  );
}

/**
 * Why a pull request was not selected, or `null` if it was.
 *
 * Returning the reason rather than a boolean is what makes the workflow's log
 * worth reading: "skipped, draft" and "skipped, someone is holding it" are
 * different facts, and a run that selects nothing should say which.
 */
export function skipReason(pr: PullRequest): string | null {
  if (pr.mergeStateStatus !== 'BEHIND') return `not behind (${String(pr.mergeStateStatus)})`;
  if (pr.isDraft === true) return 'draft';

  const held = labelNames(pr).filter((name) => HOLD_LABELS.includes(name));
  if (held.length > 0) return `held by ${held.join(', ')}`;

  const autoMerge = pr.autoMergeRequest != null;
  const agentOwned = String(pr.headRefName ?? '').startsWith(AGENT_BRANCH_PREFIX);
  // Neither condition is about convenience. Updating rewrites the branch, so
  // this refuses to rebase anything that is not either finished-and-waiting
  // (auto-merge armed) or owned by an automated session in the first place.
  if (!autoMerge && !agentOwned) return 'no auto-merge and not an agent branch';

  if (hasFailingChecks(pr)) return 'checks are failing';

  return null;
}

/** The pull request numbers this workflow may update, lowest first. */
export function selectStalePrs(prs: PullRequest[]): number[] {
  return prs
    .filter((pr) => skipReason(pr) === null)
    .map((pr) => pr.number)
    .sort((a, b) => a - b);
}

/**
 * Entry point, guarded so importing this module runs nothing — the same shape
 * `fitness/self/cli.ts` uses, and for the same reason: a test spawns a
 * subprocess that imports a module and asserts its stdout is empty.
 *
 * Reads the `gh pr list --json` array on stdin, prints one line per skipped
 * pull request with its reason, and writes the selected numbers to the path
 * given as the first argument.
 */
function main(): void {
  const prs = JSON.parse(readFileSync(0, 'utf8')) as PullRequest[];

  for (const pr of prs) {
    const reason = skipReason(pr);
    if (reason !== null) console.log(`#${pr.number}: skipped — ${reason}`);
  }

  const selected = selectStalePrs(prs);
  console.log(`selected: ${selected.length > 0 ? selected.map((n) => `#${n}`).join(' ') : 'none'}`);

  const out = process.argv[2];
  if (out !== undefined) writeFileSync(out, selected.join('\n'));
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();
