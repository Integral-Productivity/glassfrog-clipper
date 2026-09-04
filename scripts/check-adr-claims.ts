/**
 * The network half of the open-PR ADR claim scan. The rules it applies are in
 * fitness/checks/adr-claims.ts, where they are pure and exercised against
 * fixtures; this file only fetches and reports.
 *
 * Run in the `verify` job rather than as a job of its own, because ADR 0012
 * turns on `main` requiring exactly one status check. A second required context
 * is the thing that decision warns against; a second *step* inside the one
 * required job is not.
 *
 * WHERE THIS FAILS OPEN, AND WHY THAT IS ALLOWED. A fork's `GITHUB_TOKEN` cannot
 * list pull requests, and a run outside a pull-request context has no subject.
 * Both exit 0 with a notice rather than a red. Everywhere else in this repo that
 * would be a bug — a guard that skips silently is how a fitness function rots —
 * so the exception needs its reason stated: this is the *suspenders*. The belt
 * is `adr-numbering.ts` running on the merged tree with
 * `strict_required_status_checks_policy` on, and the belt does not depend on a
 * token or on this file. Failing open here loses an early, legible warning. It
 * does not let a duplicate reach `main`.
 */
import {
  claimedAdrNumbers,
  collidingClaims,
  describeCollisions,
  pullRequestNumber,
  type AdrClaim,
  type ChangedFile,
} from './adr-claims.ts';
import { repoSlug } from './repo-slug.ts';

const SLUG = process.env.GITHUB_REPOSITORY ?? repoSlug();
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

/** GitHub caps a page at 100. Passing that is a signal, not a limit to hide. */
const PAGE = 100;

function notice(message: string): void {
  console.log(`::notice::${message}`);
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`);
  return (await response.json()) as T;
}

/**
 * The pull request this run is about. `--pr N` wins so the scan can be
 * reproduced by hand; otherwise the number comes from the event payload, which
 * is absent on a push to `main`.
 */
async function subjectNumber(): Promise<number | undefined> {
  const flag = process.argv.indexOf('--pr');
  if (flag !== -1) {
    const fromFlag = pullRequestNumber(process.argv[flag + 1]);
    if (fromFlag !== undefined) return fromFlag;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined) return undefined;

  const { readFile } = await import('node:fs/promises');
  // `as` on a JSON.parse is a compile-time claim about a runtime `any`. The
  // field is read as `unknown` and validated, rather than trusted because it
  // was declared.
  const event = JSON.parse(await readFile(eventPath, 'utf8')) as { pull_request?: { number?: unknown } };
  return pullRequestNumber(event.pull_request?.number);
}

async function claimsFor(pullRequest: number): Promise<AdrClaim> {
  // Validated at the sink rather than only at each source. Both callers already
  // hold a checked number — `subjectNumber()` validates, and the listing's
  // numbers come from the API — but this is the one function that puts a value
  // into a request path, so it is the one place a new caller cannot route
  // around. A guard on every source is a guard someone forgets to add to the
  // next source.
  const number = pullRequestNumber(pullRequest);
  if (number === undefined) {
    throw new Error(`refusing to request files for a non-pull-request-number: ${JSON.stringify(pullRequest)}`);
  }

  const files = await api<ChangedFile[]>(`/repos/${SLUG}/pulls/${number}/files?per_page=${PAGE}`);
  return { pullRequest: number, numbers: claimedAdrNumbers(files) };
}

async function main(): Promise<void> {
  const subject = await subjectNumber();
  if (subject === undefined) {
    notice('Not a pull-request run — no ADR claim to scan for.');
    return;
  }
  if (TOKEN === undefined) {
    notice('No token available to list open pull requests — ADR claim scan skipped. The merged-tree guard in test/adr-numbering.test.ts still applies.');
    return;
  }

  let open: Array<{ number: number; draft: boolean }>;
  try {
    open = await api(`/repos/${SLUG}/pulls?state=open&per_page=${PAGE}`);
  } catch (error) {
    notice(`Could not list open pull requests (${String(error)}) — ADR claim scan skipped. The merged-tree guard still applies.`);
    return;
  }

  if (open.length === PAGE) {
    notice(`Read the first ${PAGE} open pull requests; any beyond that were not scanned.`);
  }

  const subjectClaim = await claimsFor(subject);
  if (subjectClaim.numbers.length === 0) {
    console.log('This pull request claims no ADR number.');
    return;
  }

  // Drafts are included deliberately. #66 was a draft when it collided with #61,
  // and a draft's file paths claim a number exactly as hard as a ready one's do.
  const others = await Promise.all(
    open.filter((pull) => pull.number !== subject).map((pull) => claimsFor(pull.number)),
  );

  const collisions = collidingClaims(subjectClaim, others);
  if (collisions.length === 0) {
    console.log(`ADR ${subjectClaim.numbers.join(', ')} claimed by this pull request alone.`);
    return;
  }

  for (const line of describeCollisions(collisions).split('\n')) console.log(`::error::${line}`);
  process.exitCode = 1;
}

await main();
