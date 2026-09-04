import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A guard for the workflow that removes the claim label on closure.
 *
 * `status:in-progress` only works as a cross-session claim signal while it is
 * trusted, and it stops being trusted once it is routinely stale. Sixteen
 * closed issues carried a live claim when #190 was measured — two thirds of the
 * label's population — because applying it is step one of a session and
 * removing it is the last step of a session that has already finished.
 *
 * So the removal is automated, and this pins the three facts that make the
 * automation real: it fires on closure, it may write labels, and it removes
 * *this* label. Each is asserted against the workflow text, because a workflow
 * cannot be unit-tested and a wrong trigger fails by never running — the silent
 * shape this repository has a solutions doc about.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/retire-claim-on-closure.yml';
const CLAIM = 'status:in-progress';

const workflow = async (): Promise<string> => readFile(join(root, WORKFLOW), 'utf8');

/**
 * The `on:` block alone.
 *
 * Scoped rather than matched whole-file, for the reason `review-workflow.test.ts`
 * gives: this workflow's header comment discusses closure at length, so a
 * whole-file search for "closed" would pass over a workflow whose trigger had
 * been changed to something else entirely.
 */
export function triggerBlock(source: string): string {
  const start = source.indexOf('\non:');
  if (start === -1) throw new Error(`${WORKFLOW} has no on: block`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\npermissions:/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The steps, so an assertion cannot be satisfied by prose above them. */
export function stepsBlock(source: string): string {
  const start = source.indexOf('    steps:');
  if (start === -1) throw new Error(`${WORKFLOW} has no steps:`);
  return source.slice(start);
}

test('it fires when an issue is closed', async () => {
  const trigger = triggerBlock(await workflow());

  assert.match(trigger, /issues:/);
  assert.match(trigger, /types:\s*\[closed\]/, 'a wrong trigger fails by never running');
});

test('it may write labels, and asks for nothing more', async () => {
  const source = await workflow();
  const permissions = source.slice(source.indexOf('\npermissions:'), source.indexOf('\nconcurrency:'));

  assert.match(permissions, /issues:\s*write/);
  assert.doesNotMatch(permissions, /contents:\s*write/, 'this workflow has no reason to write the tree');
  assert.doesNotMatch(permissions, /pull-requests:\s*write/);
});

test('it removes the claim label, and reads the result back', async () => {
  const steps = stepsBlock(await workflow());

  assert.match(steps, new RegExp(`--remove-label '${CLAIM}'`), 'must remove the claim label by name');
  // `gh issue edit` exits 0 on a label that was already absent, so the exit
  // code cannot distinguish "removed" from "no-op". The read-back is the
  // evidence; without it this is a gate that reports green having done nothing.
  assert.match(steps, /gh issue view/, 'must read the label back rather than trust the exit code');
  assert.match(steps, /::error::/, 'must fail loudly when the label survives the edit');
});

test('the trigger scan reads the on: block, not the whole file', async () => {
  // The red half. The header comment says "closure" repeatedly, so a whole-file
  // match would pass even if the trigger were changed to `workflow_dispatch` —
  // a workflow that never fires while its test stays green.
  const source = await workflow();
  const trigger = triggerBlock(source);

  assert.ok(trigger.length < source.length / 2, 'the trigger block must be a scoped slice');
  assert.ok(!trigger.includes('erodes'), 'the header comment must not be inside the scanned block');
  assert.deepEqual(triggerBlock('\non:\n  issues:\n    types: [closed]\npermissions:\n  issues: write\n').trim(),
    'on:\n  issues:\n    types: [closed]');
});

test('the guard detects a trigger that would never fire', () => {
  // Feed the scanner a workflow whose trigger has drifted. Without this, the
  // matcher could be loosened to something unconditional and every assertion
  // above would still pass.
  const drifted = '\non:\n  workflow_dispatch:\npermissions:\n  issues: write\n';

  assert.doesNotMatch(triggerBlock(drifted), /types:\s*\[closed\]/);
  assert.throws(() => triggerBlock('name: no trigger here\n'), /has no on: block/);
});
