import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Which commit an authorship note should be copied from.
 *
 * The workflow used to read the note from `head.sha` and nowhere else. That is
 * correct right up until a branch is brought up to date: `gh pr update-branch`
 * and auto-merge's own update both create a **merge commit**, which becomes the
 * new `head.sha` and never carries a note. The note is on the authored commit
 * underneath it, intact and perfectly valid — and the workflow reported
 * "nothing to copy".
 *
 * PR #147 is the worked example: the note was on `495b548`, `head.sha` was the
 * merge commit `001a2377`, and `git diff 495b548^ 495b548` and
 * `git diff 371177a^ 371177a` were byte-identical at 13,444 bytes each. The
 * workflow's own correctness guard would have passed. It was skipped anyway,
 * and the note was repaired by hand afterwards — mechanically, because every
 * piece of information needed was present and the workflow could not reach it.
 *
 * So the selection widens to "any commit in the pull request that carries a
 * note", and narrows on the thing that actually establishes correctness: the
 * candidate's diff must be byte-identical to the squashed commit's diff. ADR
 * 0009 already said the commit count was "a cheap proxy" and the diff was "the
 * actual correctness guard"; this makes the code agree with it.
 */

/** One commit the note might be read from, as the workflow measures it. */
export interface Candidate {
  sha: string;
  /** Whether `git notes --ref=ai show <sha>` succeeds. */
  hasNote: boolean;
  /** Digest of `git diff <sha>^ <sha>`, or null when the commit is unreachable. */
  diffDigest: string | null;
}

export type Outcome =
  | { kind: 'carry'; sha: string }
  | { kind: 'none'; reason: string }
  | { kind: 'forfeit'; reason: string; candidates: string[] };

/**
 * Pick the commit whose note may be carried onto the squashed commit.
 *
 * Candidates are tried in order, so the caller puts `head.sha` first: on the
 * ordinary one-commit pull request that is the answer, and nothing else is read.
 *
 * The three outcomes are distinct on purpose. `none` means there was no note
 * anywhere — a healthy no-op on a hand-written change. `forfeit` means a note
 * existed and could not be carried, which is a **loss**, and the two look
 * identical in a log unless the code separates them. Making that visible is
 * half of what #163 asked for.
 */
export function selectNoteSource(candidates: Candidate[], mergeDiffDigest: string | null): Outcome {
  const withNotes = candidates.filter((candidate) => candidate.hasNote);

  if (withNotes.length === 0) {
    return { kind: 'none', reason: 'no commit in this pull request carries an authorship note' };
  }

  if (mergeDiffDigest === null) {
    return {
      kind: 'forfeit',
      reason: 'the squashed commit was unavailable, so no diff comparison was possible',
      candidates: withNotes.map((candidate) => candidate.sha),
    };
  }

  const match = withNotes.find((candidate) => candidate.diffDigest === mergeDiffDigest);
  if (match !== undefined) return { kind: 'carry', sha: match.sha };

  return {
    kind: 'forfeit',
    reason:
      'a note exists, but no commit in this pull request has a diff byte-identical to the squashed ' +
      "commit's, so its line ranges would not describe what landed",
    candidates: withNotes.map((candidate) => candidate.sha),
  };
}

/**
 * What the workflow should say about a commit count it no longer gates on.
 *
 * ADR 0023 keeps the count as an observation rather than a condition. Reporting
 * it is what lets the skipped/success ratio in #163 be re-measured without
 * reading every run's diff by hand.
 */
export function commitCountNote(commits: number): string {
  if (commits === 1) return 'single-commit pull request; the note transfer is the ordinary case';
  return `${commits}-commit pull request; carrying a note depends on the diff comparison alone`;
}

/**
 * Parse the measurement file the workflow writes.
 *
 * One line per candidate: `<sha> <true|false> <digest|->`. A flat format rather
 * than JSON because the producer is bash, and building JSON in a shell is where
 * quoting bugs live — the workflow observes, this module parses and decides.
 */
export function parseCandidates(text: string): Candidate[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = '', hasNote = 'false', digest = '-'] = line.split(/\s+/);
      return { sha, hasNote: hasNote === 'true', diffDigest: digest === '-' ? null : digest };
    });
}

function main(): void {
  // `--describe <n>` prints the commit-count observation. Otherwise
  // `--candidates <file> --merge-digest <digest>` prints one JSON line the
  // workflow parses, so the selection that ships is the selection under test.
  const argv = process.argv;
  const describe = argv.indexOf('--describe');
  if (describe !== -1) {
    console.log(commitCountNote(Number.parseInt(argv[describe + 1] ?? '0', 10) || 0));
    return;
  }

  const file = argv[argv.indexOf('--candidates') + 1];
  const digest = argv[argv.indexOf('--merge-digest') + 1];
  if (file === undefined) throw new Error('--candidates <file> is required');

  const candidates = parseCandidates(readFileSync(file, 'utf8'));
  const merge = digest === undefined || digest === '-' ? null : digest;
  console.log(JSON.stringify(selectNoteSource(candidates, merge)));
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();
