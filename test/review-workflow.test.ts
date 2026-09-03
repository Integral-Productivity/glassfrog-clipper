import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { fromRoot } from '../fitness/root.ts';

/**
 * Guards the three properties that make the Claude review check honest.
 *
 * Issue #108: this workflow ran on every pull request from PR #78 onward,
 * concluded green every time, and posted nothing anywhere in the repo — about
 * $4.30 of model spend against zero readable output, one run doing the full
 * five-agent fan-out for four and a half minutes in silence.
 *
 * The cause was one absent flag. Upstream commit e4f68203 (2025-12-15) made
 * no-comment the default for `/code-review`, and this workflow passed the bare
 * command. Every run obeyed that instruction exactly. Nothing was broken — the
 * reviewer was being told to keep its findings to itself.
 *
 * That is the same shape as the #115 masking incident guarded in
 * `workflow-contexts.test.ts`: a gate reporting success for work it did not
 * deliver. It is the harder version, though. #115 had a real exit code being
 * thrown away by a missing `pipefail`. Here there is no signal to salvage —
 * only the absence of an artifact — so the guard has to assert on the absence
 * itself.
 *
 * Deliberately NOT asserted: the exact wording of upstream's clean-pass
 * comment. That string lives in `anthropics/claude-code`, and pinning it would
 * turn an upstream copy edit into a red suite here for no defect. These tests
 * pin only what this repository controls.
 */

const WORKFLOW = '.github/workflows/claude-code-review.yml';

const workflow = async (): Promise<string> => readFile(fromRoot(WORKFLOW), 'utf8');

/**
 * The `prompt:` block scalar's contents, and nothing else in the file.
 *
 * Scoping matters more here than it looks. The header comment quotes the same
 * phrases these tests search for, so a whole-file `assert.match` would keep
 * passing after someone deleted the prompt text it is meant to protect —
 * a guard reporting success for work it did not check, which is the exact
 * defect this PR exists to close. Read from the raw source rather than a YAML
 * parse to stay dependency-free, matching `workflow-contexts.test.ts`.
 */
const promptBlock = (source: string): string => {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^\s*prompt:\s*\|/.test(line));
  const header = lines[start];
  assert.ok(header !== undefined, `no \`prompt: |\` block in ${WORKFLOW} — the review is driven by that prompt, so its absence is not a test-fixture problem.`);

  const indent = header.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  return body.join('\n');
};

test('the review prompt passes --comment, or the reviewer posts nothing at all', async () => {
  // `commands/code-review.md` step 7: "If `--comment` argument was NOT
  // provided, stop here. Do not post any GitHub comments." Without the flag a
  // complete, correct, expensive review reaches a terminal nobody reads.
  //
  // The reference between the command and the flag is matched loosely on
  // purpose: it interpolates `${{ github.repository }}`, which contains
  // spaces, so a `\S+` here silently never matches.
  const prompt = promptBlock(await workflow());

  assert.match(
    prompt,
    /\/code-review:code-review[^\n]*\s--comment(?:\s|$)/m,
    'the prompt no longer passes --comment to /code-review:code-review. Upstream defaults to terminal-only output, so dropping the flag restores issue #108 exactly: the review runs, costs money, and posts nothing while the check reports green.',
  );
});

test('the review prompt tells the eligibility agent not to skip Claude-authored PRs', async () => {
  // Step 1 dispatches a Haiku agent that stops early on an "automated pull
  // request". Every PR here is Claude-authored on a `claude/*` branch, which is
  // the convention auto-merge keys on. Upstream opposes that bullet with only a
  // bare note, and the run evidence in #114 shows the note winning about half
  // the time — coverage as a coin flip. The prompt states the convention
  // explicitly so the agent is not guessing from prose.
  const prompt = promptBlock(await workflow());

  assert.match(
    prompt,
    /automated pull request/i,
    'the prompt no longer addresses the eligibility check. Without it the reviewer skips Claude-authored PRs non-deterministically — which, in this repo, is every PR (issue #114).',
  );
});

test('the job asserts a review artifact exists, so a silent run fails red', async () => {
  // The belt above makes the reviewer speak on the paths we know about. This is
  // the suspenders: whatever the cause, a run that ends having left nothing
  // readable on the PR must not conclude green.
  //
  // It asserts "this PR carries a review", not "this run produced one" —
  // step 1 also bails once Claude has already commented, so a per-run
  // assertion would fail red on every synchronize push to a healthy PR.
  const source = await workflow();

  assert.match(
    source,
    /Assert the review left an artifact on this PR/,
    'the emission assertion step is gone. Without it a reviewer that bails, breaks, or cannot post reports the same green check as one that reviewed the diff and found nothing — the defect issue #108 was opened about.',
  );

  assert.match(
    source,
    /claude-review-silence-notice/,
    'the silence notice lost its HTML marker. The marker is what excludes this step’s own failure comments from the artifact count; without it the first silent run posts a notice as github-actions[bot] and the next run counts that notice as a review, passing green on the strength of its own error message.',
  );
});

test('the structural-skip carve-out is scoped to this workflow file alone', async () => {
  // `anthropics/claude-code-action` refuses to run when this file differs from
  // the copy on the default branch, so a PR editing it gets no review however
  // the job is configured. Failing red there would be a FALSE red — the exact
  // mirror of the false green in #108 — so the assertion reports it green with
  // an explanation on the PR instead.
  //
  // The danger is that the escape widens. An exemption keyed on anything
  // broader than "this pull request edits this exact file" becomes a way for a
  // silent reviewer to pass, which is the defect coming back through the door
  // marked exit.
  const source = await workflow();

  assert.match(
    source,
    /SELF:\s*\.github\/workflows\/claude-code-review\.yml/,
    'the carve-out no longer names this workflow file explicitly. It must key on this exact path — the action self-skips only when THIS file differs from the default branch, so any broader condition exempts runs that had no excuse to be silent.',
  );

  assert.match(
    source,
    /gh pr diff[^\n]*--name-only[^\n]*\n?[^\n]*grep -qxF "\$SELF"/,
    'the carve-out no longer matches the changed-file list exactly (`grep -qxF`). A substring or pattern match would exempt any PR touching a path that merely contains this one, turning a narrow structural exemption into a general escape from the assertion.',
  );
});
