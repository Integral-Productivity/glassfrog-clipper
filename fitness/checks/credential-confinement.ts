/**
 * Characteristic: **confidentiality of the practitioner's GlassFrog key**.
 *
 * ADR 0002 accepted a real risk knowingly: a v5 API key sits in
 * `chrome.storage.local`, because brokering it through a hosted service would
 * put a network hop between the keystroke and the filed item. The mitigation it
 * named — scope `host_permissions`, never log the key — only holds while the
 * key stays inside the service worker.
 *
 * The way that quietly stops being true is page-world code. This extension has
 * no content script, but `src/capture.ts` injects a function into the page via
 * `chrome.scripting.executeScript` to read the selection. A closure that
 * captured the key, or an `args` array that carried it, would hand the key to
 * every page the practitioner clips — and nothing would fail, no test would go
 * red, and the extension would look exactly the same.
 *
 * Two invariants, because the leak has two doors:
 *
 *   1. Injected functions reference nothing credential-bearing, and are passed
 *      no arguments at all.
 *   2. The manifest declares no `content_scripts`. Adding one creates a second
 *      page-world scope with a lifetime we do not control, so it is a stop
 *      condition to be argued for, exactly as a new permission is.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { fromRoot } from '../root.ts';

const NAME = 'credential-confinement';
const CHARACTERISTIC = 'confidentiality — the API key never leaves the service worker';

/**
 * Identifiers that carry, fetch, or unlock the key. Matched as whole words
 * inside injected function bodies.
 *
 * Deliberately broad: `chrome.storage` is here even though only some of it
 * holds the key, because there is no legitimate reason for injected page-world
 * code to touch extension storage at all, and a narrow list is one refactor
 * away from missing the thing it was written for.
 */
const CREDENTIAL_IDENTIFIERS = [
  'apiKey',
  'API_KEY',
  'getApiKey',
  'setApiKey',
  'getClient',
  'createClient',
  'getWriter',
  'STORAGE_KEYS',
  'chrome\\.storage',
  'NODE_AUTH_TOKEN',
];

/**
 * Extracts the object literal passed to each `executeScript(` call.
 *
 * Brace-balanced rather than regex-matched: an injected function contains
 * braces of its own, and a non-greedy regex stops at the first one, silently
 * checking a fragment instead of the whole injection. A check that reads half
 * its input is worse than no check, because it reports green.
 */
export function injectionLiterals(source: string): string[] {
  const literals: string[] = [];
  const CALL = /executeScript\s*\(\s*\{/g;

  for (const match of source.matchAll(CALL)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          literals.push(source.slice(open, i + 1));
          break;
        }
      }
    }
  }

  return literals;
}

/** The pure rule over one file's source, so a fixture can exercise the red path. */
export function injectionViolations(path: string, source: string): Violation[] {
  const violations: Violation[] = [];

  for (const literal of injectionLiterals(source)) {
    for (const identifier of CREDENTIAL_IDENTIFIERS) {
      if (new RegExp(`\\b${identifier}\\b`).test(literal)) {
        violations.push({
          where: path,
          detail:
            `injects page-world code referencing \`${identifier.replace('\\.', '.')}\`. ` +
            'Anything reachable from an injected function is reachable by every page clipped.',
        });
      }
    }

    // `args` is the supported way to pass values into an injected function, so
    // it is the supported way to leak one. There is no case in this extension
    // that needs it; if one arrives, it should arrive with an argument.
    if (/(^|[\s,{])args\s*:/.test(literal)) {
      violations.push({
        where: path,
        detail:
          'passes `args` to an injected function. Injected code takes no arguments here — ' +
          'raise the case rather than widening this, since `args` is how a credential travels.',
      });
    }
  }

  return violations;
}

/** The pure rule over the manifest. */
export function manifestScopeViolations(manifest: Record<string, unknown>): Violation[] {
  if (!('content_scripts' in manifest)) return [];
  return [
    {
      where: 'public/manifest.json',
      detail:
        'declares `content_scripts`. That is a second page-world scope with a lifetime the ' +
        'extension does not control — a stop condition, like a new permission, not a detail.',
    },
  ];
}

export async function runCredentialConfinementCheck(): Promise<CheckResult> {
  const violations: Violation[] = [];

  const files = (await readdir(fromRoot('src'))).filter((name) => name.endsWith('.ts'));
  let injections = 0;

  for (const file of files) {
    const path = join('src', file);
    const source = await readFile(fromRoot(path), 'utf8');
    injections += injectionLiterals(source).length;
    violations.push(...injectionViolations(path, source));
  }

  const manifest = JSON.parse(await readFile(fromRoot('public', 'manifest.json'), 'utf8'));
  violations.push(...manifestScopeViolations(manifest));

  return violations.length === 0
    ? pass(
        NAME,
        CHARACTERISTIC,
        `${injections} injected function(s) reference no credential, and the manifest declares no content scripts.`,
      )
    : fail(NAME, CHARACTERISTIC, 'the API key is reachable from page-world scope', violations);
}
