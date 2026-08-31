/**
 * Reconciles docs/agents/labels.json against the repository's live GitHub
 * labels.
 *
 * Why this is a script and not a test: #46 asked for label drift to be
 * surfaced automatically, and #43's ADR guard could not be the model for it.
 * That guard reads the filesystem, so it runs inside `npm test` on every PR
 * including forks. Labels live behind the GitHub API, so the same check inside
 * `npm test` would fail red on a fork and on any clone without a token —
 * punishing contributors for an account they do not have. So the split is:
 *
 *   docs ↔ manifest   offline, in `npm test`, blocks the PR  (label-manifest.test.ts)
 *   manifest ↔ GitHub online, on a schedule, raises an issue (this script)
 *
 * The manifest is the written source of truth. GitHub is applied from it.
 *
 * Usage:
 *   node scripts/check-labels.mjs                 report drift, exit 1 if any
 *   node scripts/check-labels.mjs --report out.md also write a markdown body
 *   node scripts/check-labels.mjs --apply         create/edit GitHub to match
 *
 * Needs `gh` authenticated with a token carrying `issues: write` for --apply,
 * and read access otherwise.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

const MANIFEST = 'docs/agents/labels.json';
const GROUPS = ['states', 'markers', 'tracks', 'other'];

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const reportPath = args[args.indexOf('--report') + 1] ?? null;

/**
 * Flattens the manifest's four groups into one list, remembering which group
 * each label came from so a report can say *what kind* of label drifted —
 * "a state is missing" reads very differently from "a Dependabot label is".
 */
export function manifestLabels(manifest) {
  return GROUPS.flatMap((group) =>
    manifest[group].map((label) => ({ ...label, group, color: label.color.toLowerCase() })),
  );
}

/**
 * GitHub stores label colours case-insensitively but returns them verbatim, so
 * the live set genuinely mixes `0E8A16` and `0e8a16` for the same colour. Left
 * unnormalised, this check would report drift on `status:in-progress` on every
 * run, for a difference that cannot be fixed. A check that is permanently red
 * gets muted, which is worse than not having one.
 */
function normalise(label) {
  return { name: label.name, description: label.description ?? '', color: label.color.toLowerCase() };
}

async function liveLabels(repo) {
  const { stdout } = await run('gh', [
    'label',
    'list',
    '--repo',
    repo,
    '--limit',
    '200',
    '--json',
    'name,description,color',
  ]);
  return JSON.parse(stdout).map(normalise);
}

/**
 * The whole comparison, as a pure function so the tests can exercise it
 * without a network or a token.
 *
 * `extra` is deliberately not something --apply will fix. Removing a label
 * from GitHub strips it off every issue that carries it, and that data is not
 * recoverable from the manifest. So an unexpected label is reported for a
 * person to resolve deliberately — either by adding it to the manifest, or by
 * deleting it themselves knowing what it is attached to. This is also why
 * "labels follow doc" could not be the whole answer to #46: apply alone is
 * blind to a label added in the GitHub UI.
 */
export function diffLabels(wanted, live) {
  const liveByName = new Map(live.map((label) => [label.name, label]));
  const wantedNames = new Set(wanted.map((label) => label.name));

  const missing = [];
  const changed = [];

  for (const want of wanted) {
    const have = liveByName.get(want.name);
    if (have === undefined) {
      missing.push(want);
      continue;
    }
    const fields = ['description', 'color'].filter((field) => have[field] !== want[field]);
    if (fields.length > 0) changed.push({ ...want, was: have, fields });
  }

  const extra = live.filter((label) => !wantedNames.has(label.name));

  return { missing, changed, extra };
}

function markdownReport(repo, { missing, changed, extra }) {
  const lines = [
    `The live labels on \`${repo}\` no longer match`,
    `[\`${MANIFEST}\`](https://github.com/${repo}/blob/main/${MANIFEST}),`,
    'which is the source of truth for this repository\'s label set.',
    '',
    'This issue is maintained by `.github/workflows/label-drift.yml`. It closes',
    'itself once the two agree again — do not close it by hand while drift stands.',
    '',
  ];

  if (missing.length > 0) {
    lines.push('## In the manifest, absent from GitHub', '');
    for (const label of missing) lines.push(`- \`${label.name}\` (${label.group}) — “${label.description}”`);
    lines.push('', 'Fix: run the workflow with **apply** checked.', '');
  }

  if (changed.length > 0) {
    lines.push('## Present on GitHub, but different', '');
    for (const label of changed) {
      lines.push(`- \`${label.name}\` (${label.group}) — differs in ${label.fields.join(' and ')}`);
      for (const field of label.fields) {
        lines.push(`  - manifest: \`${label[field]}\``);
        lines.push(`  - live: \`${label.was[field]}\``);
      }
    }
    lines.push(
      '',
      'Fix: if the manifest is right, run the workflow with **apply** checked. If the',
      'live value is right, edit the manifest and `docs/agents/triage-labels.md` together —',
      '`npm test` fails if you change only one.',
      '',
    );
  }

  if (extra.length > 0) {
    lines.push('## On GitHub, absent from the manifest', '');
    for (const label of extra) lines.push(`- \`${label.name}\` — “${label.description}”`);
    lines.push(
      '',
      'Apply cannot resolve these. Deleting a label strips it off every issue carrying',
      'it, and that is not recoverable from the manifest. Decide deliberately: either',
      'add it to the manifest and to `docs/agents/triage-labels.md`, or delete it by hand',
      'after checking what it is attached to:',
      '',
      '```',
      `gh issue list --repo ${repo} --state all --label "<name>"`,
      '```',
      '',
    );
  }

  return lines.join('\n');
}

async function applyLabels(repo, { missing, changed }) {
  for (const label of missing) {
    await run('gh', [
      'label',
      'create',
      label.name,
      '--repo',
      repo,
      '--description',
      label.description,
      '--color',
      label.color,
    ]);
    console.log(`created ${label.name}`);
  }
  for (const label of changed) {
    await run('gh', [
      'label',
      'edit',
      label.name,
      '--repo',
      repo,
      '--description',
      label.description,
      '--color',
      label.color,
    ]);
    console.log(`edited ${label.name} (${label.fields.join(', ')})`);
  }
}

/**
 * Guarded so that importing this module for its pure functions does not shell
 * out to `gh`. Without the guard, `label-manifest.test.ts` — the offline half
 * of the check, whose whole point is needing no token — would reach the network
 * on every `npm test`.
 */
async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const repo = manifest.repo;
  const wanted = manifestLabels(manifest);
  const diff = diffLabels(wanted, await liveLabels(repo));
  const drifted = diff.missing.length + diff.changed.length + diff.extra.length;

  if (apply) {
    if (diff.missing.length + diff.changed.length === 0) {
      console.log('Nothing to apply.');
    } else {
      await applyLabels(repo, diff);
    }
    if (diff.extra.length > 0) {
      // Applied and still not clean: say so rather than reporting success, or the
      // run reads as "drift resolved" when the unresolvable half is untouched.
      for (const label of diff.extra) {
        console.error(`::error::\`${label.name}\` is on GitHub but not in ${MANIFEST}; apply cannot remove it safely.`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  if (reportPath !== null) await writeFile(reportPath, markdownReport(repo, diff), 'utf8');

  if (drifted === 0) {
    console.log(`${wanted.length} labels: ${MANIFEST} and ${repo} agree.`);
    process.exit(0);
  }

  for (const label of diff.missing) console.error(`::error::missing on GitHub: ${label.name}`);
  for (const label of diff.changed) {
    console.error(`::error::differs on GitHub: ${label.name} (${label.fields.join(', ')})`);
  }
  for (const label of diff.extra) console.error(`::error::not in the manifest: ${label.name}`);
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
