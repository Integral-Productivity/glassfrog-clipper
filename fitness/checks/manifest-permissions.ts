/**
 * Characteristic: **installability**. A publicly-installable extension is
 * granted permissions by a human reading a dialog, and every entry on that
 * dialog is a reason not to install.
 *
 * STRATEGY.md's Distribution & trust track states the stake plainly: "capture
 * that nobody grants browser access to captures nothing; trust is the adoption
 * gate." The Definition of Done makes the permission list a *stop condition*
 * rather than an implementation detail, which is only enforceable if something
 * fails when the list changes.
 *
 * The rule lives here and `test/manifest.test.ts` imports it, so the permission
 * surface is asserted by the unit suite that runs on every PR today AND
 * reported by the fitness gate — one implementation, two reporting surfaces.
 * See docs/adr/0010.
 *
 * Erosion here is slower than a broken build and more expensive: a widened
 * permission ships green, and the feedback arrives at Web Store review.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { fromRoot } from '../root.ts';

const NAME = 'manifest-permissions';
const CHARACTERISTIC = 'installability — the permission dialog stays small enough to accept';

/** Exactly what the Definition of Done allows. Sorted; compared as a set. */
export const ALLOWED_PERMISSIONS = [
  'activeTab',
  'alarms',
  'notifications',
  'scripting',
  'storage',
] as const;

/** A3: one origin, the only one the extension talks to. */
export const ALLOWED_HOST_PERMISSIONS = ['https://api.glassfrog.com/*'] as const;

/**
 * Origins that grant the whole web. Named individually because each reads as
 * innocuous in a diff, and any of them turns the dialog into the one nobody
 * accepts.
 */
const BLANKET_ORIGINS = ['<all_urls>', 'http://*/*', 'https://*/*', '*://*/*'];

interface Manifest {
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
}

/**
 * The pure rule. `usedInSource` is the set of `chrome.<api>` namespaces the code
 * actually reaches for, so the check runs in both directions: nothing declared
 * that is unused, nothing used that is undeclared.
 */
export function permissionViolations(manifest: Manifest, usedInSource: Set<string>): Violation[] {
  const violations: Violation[] = [];
  const declared = [...(manifest.permissions ?? [])].sort();
  const allowed = [...ALLOWED_PERMISSIONS].sort();

  for (const permission of declared) {
    if (!allowed.includes(permission as (typeof ALLOWED_PERMISSIONS)[number])) {
      violations.push({
        where: 'public/manifest.json',
        detail:
          `declares \`${permission}\`, which the Definition of Done does not allow. Adding a ` +
          'permission is a stop condition — raise it rather than widening the list here.',
      });
    }
  }

  for (const permission of allowed) {
    if (!declared.includes(permission)) {
      violations.push({
        where: 'public/manifest.json',
        detail:
          `no longer declares \`${permission}\`. Removing one is welcome, but the allowlist ` +
          'must shrink with it, or this check stops describing the shipped extension.',
      });
    }
  }

  // Dead breadth: a permission nobody uses is one the practitioner is asked to
  // grant for nothing. `activeTab` has no `chrome.activeTab` namespace, so it
  // is exempt from the usage direction.
  for (const permission of declared) {
    if (permission === 'activeTab') continue;
    if (!usedInSource.has(permission)) {
      violations.push({
        where: 'public/manifest.json',
        detail: `declares \`${permission}\` but no source file uses \`chrome.${permission}\`.`,
      });
    }
  }

  for (const used of usedInSource) {
    if (!declared.includes(used)) {
      violations.push({
        where: 'src/',
        detail: `uses \`chrome.${used}\` but the manifest does not declare it — this fails only at runtime, on the failure path.`,
      });
    }
  }

  const hosts = manifest.host_permissions ?? [];
  if (JSON.stringify(hosts) !== JSON.stringify([...ALLOWED_HOST_PERMISSIONS])) {
    violations.push({
      where: 'public/manifest.json',
      detail: `host_permissions is ${JSON.stringify(hosts)}; A3 confines it to ${JSON.stringify([...ALLOWED_HOST_PERMISSIONS])}.`,
    });
  }

  // Optional permissions land in the same dialog once requested, so they are
  // not a way around the allowlist.
  for (const [key, values] of [
    ['optional_permissions', manifest.optional_permissions ?? []],
    ['optional_host_permissions', manifest.optional_host_permissions ?? []],
  ] as const) {
    if (values.length > 0) {
      violations.push({
        where: 'public/manifest.json',
        detail: `declares \`${key}\`. Optional permissions reach the same dialog once requested; they are not a side door around the allowlist.`,
      });
    }
  }

  for (const origin of [...hosts, ...(manifest.optional_host_permissions ?? [])]) {
    if (BLANKET_ORIGINS.includes(origin)) {
      violations.push({
        where: 'public/manifest.json',
        detail: `requests \`${origin}\`, which grants the entire web.`,
      });
    }
  }

  return violations;
}

/** Which `chrome.<api>` namespaces src/ actually reaches for. */
export async function chromeApisUsedInSource(dir = 'src'): Promise<Set<string>> {
  const files = (await readdir(fromRoot(dir))).filter((name) => name.endsWith('.ts'));
  const source = (
    await Promise.all(files.map((file) => readFile(fromRoot(dir, file), 'utf8')))
  ).join('\n');

  const used = new Set<string>();
  for (const match of source.matchAll(/\bchrome\.([a-zA-Z]+)\./g)) {
    const namespace = match[1];
    // Namespaces that need no entry in `permissions`, so requiring one would
    // report a violation against a manifest that is already correct.
    //
    // `commands` is the subtle one and was a live false positive when this
    // check was first run: it is unlocked by the manifest's top-level
    // `commands` key, not by a permission, and `test/manifest.test.ts` already
    // asserts that key holds both capture flows' entries.
    if (
      namespace &&
      !['runtime', 'tabs', 'action', 'commands', 'i18n', 'extension'].includes(namespace)
    ) {
      used.add(namespace);
    }
  }
  return used;
}

export async function runManifestPermissionsCheck(): Promise<CheckResult> {
  const manifest: Manifest = JSON.parse(await readFile(fromRoot('public', 'manifest.json'), 'utf8'));
  const violations = permissionViolations(manifest, await chromeApisUsedInSource());

  return violations.length === 0
    ? pass(
        NAME,
        CHARACTERISTIC,
        `${(manifest.permissions ?? []).length} permissions, all on the allowlist and all used; one host origin.`,
      )
    : fail(NAME, CHARACTERISTIC, 'the permission surface has widened', violations);
}
