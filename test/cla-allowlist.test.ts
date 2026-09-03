import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * No CLA allowlist entry may contain a glob.
 *
 * `contributor-assistant/github-action` compiles a `*` pattern to an
 * **unanchored** regex — `checkAllowList.ts` does `escapeRegExp(pattern)`,
 * splits on the escaped `*`, joins with `.*`, and calls `RegExp.test`. There is
 * no `^` and no `$`. So `bot*` does not mean "logins starting with bot"; it
 * means "logins containing bot anywhere".
 *
 * This repository shipped `bot*` from the day the workflow was written, which
 * silently exempted `abbott`, `robotics-inc` and `sabotage-labs` — real,
 * ordinary logins — from the agreement. Nobody would have seen it: an
 * over-broad allowlist produces no failure at all. It is the inverse of #179,
 * where the workflow never ran, and it hides the same way. The CLA exists so
 * one party can license the whole work; a contributor who never signs because
 * their name contains three particular letters defeats that quietly.
 *
 * A pattern cannot be anchored from configuration, so the rule is structural:
 * enumerate the accounts, never glob them. An entry that needs a wildcard needs
 * a change to the action instead.
 *
 * See ADR 0020, and docs/solutions/workflow-issues/ for how the CLA gate's
 * earlier failures were found.
 */

const WORKFLOW = '.github/workflows/cla.yml';

/** Logins that must never be exempt: ordinary names that a glob might swallow. */
const MUST_SIGN = ['abbott', 'robotics-inc', 'sabotage-labs', 'talbot', 'alice', 'Botond'];

/**
 * Parsed `allowlist:` entries, trimmed, in declaration order.
 *
 * The narrowing sits on the capture group rather than the match, because
 * `noUncheckedIndexedAccess` types group 1 as possibly undefined and a non-null
 * match does not prove the group was filled. Same shape as the typecheck #165
 * hit; kept explicit so it reads as deliberate.
 */
export const allowlistEntries = (source: string): string[] | undefined => {
  const declared = source.match(/^\s+allowlist:\s*(.+?)\s*$/m)?.[1];

  return declared
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/**
 * The action's own matcher, reproduced. Deliberately a copy of the upstream
 * behaviour — including the missing anchors — because the point is to test what
 * the action will actually do, not what it ought to do.
 */
export const actionWouldExempt = (patterns: string[], login: string): boolean =>
  patterns.some((pattern) =>
    pattern.includes('*')
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('\\*').join('.*')).test(login)
      : pattern === login,
  );

test('the CLA workflow declares an allowlist', async () => {
  assert.ok(
    allowlistEntries(await readFile(WORKFLOW, 'utf8'))?.length,
    `no \`allowlist:\` found in ${WORKFLOW} — this guard would pass while checking nothing`,
  );
});

test('no allowlist entry is a glob', async () => {
  const entries = allowlistEntries(await readFile(WORKFLOW, 'utf8')) ?? [];

  assert.deepEqual(
    entries.filter((entry) => entry.includes('*')),
    [],
    'the action compiles a glob to an unanchored regex, so it exempts every login merely ' +
      'containing the pattern. Enumerate the accounts instead. See docs/adr/0020.',
  );
});

test('no ordinary contributor is silently exempt', async () => {
  const entries = allowlistEntries(await readFile(WORKFLOW, 'utf8')) ?? [];

  for (const login of MUST_SIGN) {
    assert.equal(
      actionWouldExempt(entries, login),
      false,
      `'${login}' would be exempted from the CLA by ${WORKFLOW}'s allowlist without ever signing, ` +
        'and nothing would go red. See docs/adr/0020.',
    );
  }
});

test('the guard catches the pattern this repository actually shipped', () => {
  // The red half, kept in the suite. `bot*` was live from the workflow's first
  // commit until ADR 0020; without this, the matcher above could return false
  // unconditionally and every test here would pass forever.
  assert.equal(actionWouldExempt(['bot*'], 'abbott'), true);
  assert.equal(actionWouldExempt(['bot*'], 'dependabot[bot]'), true);
  assert.equal(actionWouldExempt(['kraigparkinson'], 'kraigparkinson2'), false);
});

test('the accounts that must stay exempt still are', async () => {
  const entries = allowlistEntries(await readFile(WORKFLOW, 'utf8')) ?? [];

  for (const login of ['kraigparkinson', 'claude', 'dependabot[bot]']) {
    assert.equal(
      actionWouldExempt(entries, login),
      true,
      `'${login}' is no longer exempt. Dropping a bot or the AI committer from the allowlist ` +
        'blocks every pull request it authors, because that account cannot sign. See docs/adr/0020.',
    );
  }
});
