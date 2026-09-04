import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  type Candidate,
  commitCountNote,
  parseCandidates,
  selectNoteSource,
} from '../scripts/authorship-note-source.ts';

/**
 * A guard for the one workflow whose failure mode is losing something silently.
 *
 * `ai-authorship-notes.yml` had no test at all — the ADR and the workflow, and
 * nothing else. Half of every run it has ever had was skipped, and a skipped run
 * is indistinguishable from a healthy no-op at a glance, so the loss was never
 * counted (#163).
 *
 * The selection is a pure function here and the workflow calls it, which is what
 * makes these fixtures evidence about production rather than about a second copy
 * of the rule.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/ai-authorship-notes.yml';

const workflow = async (): Promise<string> => readFile(join(root, WORKFLOW), 'utf8');

/** The steps, so an assertion cannot be satisfied by the header comment above them. */
export function stepsBlock(source: string): string {
  const at = source.indexOf('    steps:');
  if (at === -1) throw new Error(`${WORKFLOW} has no steps:`);
  return source.slice(at);
}

const candidate = (sha: string, hasNote: boolean, diffDigest: string | null): Candidate => ({
  sha,
  hasNote,
  diffDigest,
});

test('the ordinary one-commit pull request carries from head', () => {
  const outcome = selectNoteSource([candidate('authored', true, 'D')], 'D');

  assert.deepEqual(outcome, { kind: 'carry', sha: 'authored' });
});

test('PR #147: head is a merge commit with no note, the authored commit underneath has one', () => {
  // The worked example from #163, and the case the old workflow could not reach.
  // Note on 495b548; head.sha 001a2377 is an update-branch merge commit; the two
  // diffs were byte-identical at 13,444 bytes each, so the correctness guard
  // would have passed. It reported "nothing to copy" and the note was repaired
  // by hand afterwards.
  const outcome = selectNoteSource(
    [candidate('001a2377', false, 'merge-diff'), candidate('495b548', true, 'identical')],
    'identical',
  );

  assert.deepEqual(outcome, { kind: 'carry', sha: '495b548' });
});

test('head wins when both carry a note, so the ordinary case reads nothing else', () => {
  const outcome = selectNoteSource([candidate('head', true, 'D'), candidate('older', true, 'D')], 'D');

  assert.deepEqual(outcome, { kind: 'carry', sha: 'head' });
});

test('a note that cannot be carried is a forfeit, not a no-op', () => {
  // The distinction #163 asked for. These two used to look identical in a log,
  // which is why the loss was never counted.
  const forfeit = selectNoteSource([candidate('authored', true, 'one-thing')], 'something-else');
  const none = selectNoteSource([candidate('authored', false, 'D')], 'D');

  assert.equal(forfeit.kind, 'forfeit');
  assert.deepEqual(forfeit.kind === 'forfeit' ? forfeit.candidates : [], ['authored']);
  assert.match(forfeit.kind === 'forfeit' ? forfeit.reason : '', /byte-identical/);

  assert.equal(none.kind, 'none');
});

test('an unreachable squashed commit forfeits rather than carrying blind', () => {
  const outcome = selectNoteSource([candidate('authored', true, 'D')], null);

  assert.equal(outcome.kind, 'forfeit');
  assert.match(outcome.kind === 'forfeit' ? outcome.reason : '', /no diff comparison was possible/);
});

test('the guard detects a selector that stopped checking the diff', () => {
  // The red half. Without it, `selectNoteSource` could return the first
  // note-bearing candidate unconditionally and every test above but this one
  // would still pass — publishing attribution whose line ranges describe
  // nothing, which ADR 0009 says is worse than publishing none.
  const mismatched = selectNoteSource([candidate('authored', true, 'not-the-merge-diff')], 'merge-diff');

  assert.notEqual(mismatched.kind, 'carry', 'a diff mismatch must never be carried');
  assert.notDeepEqual(mismatched, { kind: 'carry', sha: 'authored' });
});

test('the candidate file is parsed as the workflow writes it', () => {
  const parsed = parseCandidates('001a2377 false -\n495b548 true abc123\n\n');

  assert.deepEqual(parsed, [
    { sha: '001a2377', hasNote: false, diffDigest: null },
    { sha: '495b548', hasNote: true, diffDigest: 'abc123' },
  ]);
  assert.deepEqual(parseCandidates(''), [], 'an empty measurement must parse to no candidates');
});

test('the commit count is reported, not gated on', () => {
  assert.match(commitCountNote(1), /single-commit/);
  assert.match(commitCountNote(4), /4-commit/);
  assert.match(commitCountNote(4), /diff comparison alone/);
});

test('the workflow gates on the diff and calls the tested selector', async () => {
  const source = await workflow();
  const steps = stepsBlock(source);
  const jobCondition = source.slice(source.indexOf('  copy-note:'), source.indexOf('    runs-on:'));

  // The whole of ADR 0023 in three assertions.
  assert.doesNotMatch(
    jobCondition,
    /pull_request\.commits/,
    'a job-level commit gate skips every step, so the forfeit it causes cannot be reported',
  );
  assert.match(steps, /authorship-note-source\.ts/, 'the workflow must use the tested selector');
  assert.match(steps, /::warning::.*forfeited/i, 'a forfeited note must be announced, not silent');
});
