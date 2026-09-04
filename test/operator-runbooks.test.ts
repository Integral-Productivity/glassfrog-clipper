import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MINIMUM_STEPS,
  errandProblems,
  hasAgentBlock,
  markdownReport,
  nonCompliantErrands,
  runbookSteps,
  sectionUnder,
} from '../scripts/operator-runbooks.ts';

/**
 * Red-then-green for the operator-errand runbook convention.
 *
 * `docs/agents/operator-runbooks.md` obliges an `operator-errand` issue to
 * carry an executable runbook and a block telling an agent to walk the operator
 * through it. Nothing checked it, and the document said so — a convention with
 * an artifact and no enforcement, which is #46's observation recurring one
 * document over.
 *
 * The rules are pure over an issue body, so every fixture here is a string and
 * nothing needs a token. The half that needs the API lives in
 * `scripts/check-operator-runbooks.ts` and runs on a schedule.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Shaped after #164, which `operator-runbooks.md` names as the worked example. */
const compliant = [
  'Blocker for #105.',
  '',
  '## For agents picking this up',
  '',
  '**Do not attempt these steps.** Your job is to walk the operator through the',
  'runbook below, one step at a time.',
  '',
  '## Runbook',
  '',
  '1. **Choose the local part.** `chrome-store@` is the proposal.',
  '2. **Turn off automatic licensing** before creating the user.',
  '3. **Verify it can sign in** in a clean browser profile.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] Address exists as a user',
].join('\n');

test('a compliant errand is accepted', () => {
  assert.equal(errandProblems({ number: 164, title: 'Create the identity', body: compliant }), null);
  assert.equal(runbookSteps(compliant).length, 3);
  assert.equal(hasAgentBlock(compliant), true);
});

test('the guard detects an errand with no runbook', () => {
  // The red half, and the live case: #104, #60 and #64 all carry the label
  // after #198 and none carries a runbook.
  const body = '## What\n\nTake the four screenshots.\n\n## Acceptance criteria\n\n- [ ] Done\n';
  const problem = errandProblems({ number: 104, title: 'Take the screenshots', body });

  assert.notEqual(problem, null);
  assert.deepEqual(problem?.missing, [
    'no `## Runbook` heading',
    'no block telling an agent to walk the operator through it',
  ]);
});

test('a Runbook heading alone is not a runbook', () => {
  // The issue says a heading is checkable and gameable. Structure is the point:
  // a runbook is an ordered list, and one that is not ordered is a description.
  const prose = [
    '## For agents picking this up',
    'Walk the operator through it.',
    '',
    '## Runbook',
    '',
    'Ask the operator to open the admin console and figure it out.',
  ].join('\n');

  assert.deepEqual(runbookSteps(prose), []);
  assert.match(errandProblems({ number: 1, title: 't', body: prose })?.missing[0] ?? '', /0 numbered step/);
});

test('a one-step runbook is a sentence, not an ordered list', () => {
  const single = '## For agents\nWalk them through it.\n\n## Runbook\n\n1. Do the thing.\n';

  assert.equal(runbookSteps(single).length, 1);
  assert.ok(MINIMUM_STEPS > 1);
  assert.match(errandProblems({ number: 2, title: 't', body: single })?.missing[0] ?? '', /at least 2/);
});

test('the agent block is recognised by heading or by instruction', () => {
  const steps = '\n\n## Runbook\n\n1. One.\n2. Two.\n';

  // #164's shape: a heading naming agents.
  assert.equal(hasAgentBlock('## For agents picking this up\nAnything.' + steps), true);
  // The instruction the convention actually cares about, wherever it appears.
  assert.equal(hasAgentBlock('An agent should walk the operator through this.' + steps), true);
  // Merely containing the word is not enough.
  assert.equal(hasAgentBlock('This is agentic work.' + steps), false);
});

test('the section scan stops at the next heading', () => {
  // Without this, "## Runbook" would swallow the Acceptance criteria below it
  // and a checklist of `- [ ]` items could never be mistaken for steps — but a
  // *numbered* list in a later section would be counted as runbook steps.
  const body = '## Runbook\n\n1. One.\n\n## Notes\n\n2. Not a step.\n';

  assert.equal(runbookSteps(body).length, 1);
  assert.equal(sectionUnder(body, /notes/i)?.includes('Not a step'), true);
  assert.equal(sectionUnder(body, /nothing here/i), null);
});

test('the guard detects a classifier that stopped refusing anything', () => {
  // The red half for the aggregate. Each case above pins one rule; this pins
  // that the set-level function still separates them, so a classifier that
  // returned [] unconditionally cannot pass.
  const bad = [
    { number: 60, title: 'Verify the panel', body: 'No runbook here.' },
    { number: 64, title: 'Run the gate', body: '## Runbook\n\nProse only.\n' },
  ];
  const good = [{ number: 164, title: 'Create the identity', body: compliant }];

  assert.equal(nonCompliantErrands(bad).length, 2);
  assert.deepEqual(nonCompliantErrands(good), []);
  assert.deepEqual(nonCompliantErrands([...bad, ...good]).map((p) => p.number), [60, 64]);
});

test('the report names each issue and what it is missing', () => {
  const report = markdownReport(nonCompliantErrands([{ number: 60, title: 'Verify the panel', body: '' }]), 3);

  assert.match(report, /1 of 3 open/);
  assert.match(report, /\*\*#60\*\* — Verify the panel/);
  assert.match(report, /no `## Runbook` heading/);
});

test('the convention document names this mechanism', async () => {
  // operator-runbooks.md pointed at #196 as the enforcement gap. A fix that
  // left that pointer in place would leave the document describing a gap that
  // had been closed — the drift this whole issue is about.
  const doc = await readFile(join(root, 'docs', 'agents', 'operator-runbooks.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## Where this is enforced'));

  assert.match(section, /operator-runbook-drift\.yml/, 'the document must name the workflow');
  assert.doesNotMatch(section, /Nowhere automatically/, 'the "no enforcement" claim must be gone');
});
