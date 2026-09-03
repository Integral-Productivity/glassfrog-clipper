/**
 * Characteristic: **confidentiality of the operational accounts this project
 * runs on**, now that the repository is public.
 *
 * ADR 0016 and 0017 decide who publishes this extension and what that identity
 * costs. Those are arguments, and they belong in the open. What does not is the
 * *inventory*: the exact address of the Chrome Web Store owner, the licence it
 * holds, the organizational unit it sits in, where its mail is routed, and where
 * its password is kept. Together those describe one credential-bearing account
 * whose email address Google will never let us change — a phishing target
 * rather than a design rationale.
 *
 * The failure this guards is not a leak of secrets; `credential-confinement`
 * covers the API key, and no token has ever been committed here. It is the
 * slower one: a runbook written while the repository was private, still being
 * appended to after it went public, accreting one operational detail at a time
 * until the tree describes how to impersonate the publisher. Nothing goes red
 * when that happens, which is why it is a check.
 *
 * The rule is deliberately narrow, because a broad one gets suppressed. Any
 * address on a company domain must be one the project has decided to publish —
 * the contact addresses in `CONTRIBUTING.md`, `PRIVACY.md` and `package.json`
 * are exactly that, and stay. A new one is a stop condition: either it is a
 * contact point, in which case add it here with a reason, or it is inventory,
 * in which case it should not be in the tree at all.
 *
 * WHAT THIS CANNOT SEE. Commit messages, issue bodies, and pull request
 * descriptions are outside the worktree, so they are outside this check. The
 * address redacted from these docs still stands in this branch's earlier
 * commits and in the issues that tracked the work. This is a forward-looking
 * control over what `main` carries; it is not an erasure, and ADR 0017 says so
 * in the same words rather than letting the green here imply otherwise.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { fromRoot } from '../root.ts';

const NAME = 'account-disclosure';
const CHARACTERISTIC =
  'confidentiality — operational account identifiers stay out of the public tree';

/** Domains whose addresses are operational unless explicitly published. */
const COMPANY_DOMAINS = ['integralproductivity.com'];

/**
 * Addresses the project has decided to publish, each with the reason it is a
 * contact point rather than inventory. Adding a row is a deliberate act; that
 * is the whole mechanism.
 */
export const PUBLISHED_CONTACTS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    'kraigparkinson@integralproductivity.com',
    'the maintainer contact published in CONTRIBUTING.md, PRIVACY.md and package.json',
  ],
]);

const ADDRESS = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** The pure rule over one file's text, so a fixture can exercise the red path. */
export function disclosureViolations(path: string, source: string): Violation[] {
  const violations: Violation[] = [];

  for (const match of source.match(ADDRESS) ?? []) {
    const address = match.toLowerCase();
    if (!COMPANY_DOMAINS.some((domain) => address.endsWith(`@${domain}`))) continue;
    if (PUBLISHED_CONTACTS.has(address)) continue;

    violations.push({
      where: path,
      detail:
        `records \`${match}\`, an operational address on a company domain. ` +
        'Name the shape rather than the address, or — if this is a contact point the project ' +
        'means to publish — add it to PUBLISHED_CONTACTS with the reason.',
    });
  }

  return violations;
}

/** Text the check reads. Binary and generated trees carry no runbooks. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-safari', 'release', 'coverage']);
const TEXT = /\.(md|ts|tsx|js|mjs|json|ya?ml|sh|py|html|css|txt)$/;

async function textFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(fromRoot('.'), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const relative = join(entry.parentPath, entry.name).replace(`${fromRoot('.')}/`, '');
    if (relative.split('/').some((segment) => SKIP_DIRS.has(segment))) continue;
    if (relative === 'package-lock.json') continue;
    // The check's own source states the rule using the addresses it forbids.
    if (relative === join('fitness', 'checks', 'account-disclosure.ts')) continue;
    if (relative === join('test', 'account-disclosure.test.ts')) continue;
    if (!TEXT.test(relative)) continue;
    found.push(relative);
  }
  return found;
}

export async function runAccountDisclosureCheck(): Promise<CheckResult> {
  const violations: Violation[] = [];
  const files = await textFiles();

  for (const path of files) {
    violations.push(...disclosureViolations(path, await readFile(fromRoot(path), 'utf8')));
  }

  return violations.length === 0
    ? pass(
        NAME,
        CHARACTERISTIC,
        `${files.length} text file(s) carry no company-domain address beyond the ` +
          `${PUBLISHED_CONTACTS.size} published contact(s).`,
      )
    : fail(NAME, CHARACTERISTIC, 'an operational account address is in the public tree', violations);
}
