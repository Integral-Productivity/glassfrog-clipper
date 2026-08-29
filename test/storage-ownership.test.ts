import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { IN_FLIGHT_KEY_PREFIX, STORAGE_KEYS } from '../src/storage.ts';

/**
 * A fitness function for U2's Definition of Done: "no file outside
 * src/storage.ts references a raw storage key."
 *
 * Stated as prose in the plan, this is the kind of constraint that decays the
 * first time someone reaches for `chrome.storage.local` directly because it is
 * two fewer keystrokes. Asserting it in the suite makes the decay loud.
 */

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const OWNER = 'storage.ts';

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(srcDir);
  return entries.filter((name) => name.endsWith('.ts') && name !== OWNER);
}

test('storage.ts is the only source file holding raw storage keys', async () => {
  const files = await sourceFiles();
  assert.ok(files.length > 0, 'the scan found source files to check');

  const keyLiterals = [...Object.values(STORAGE_KEYS), IN_FLIGHT_KEY_PREFIX];
  const offenders: string[] = [];

  for (const file of files) {
    const contents = await readFile(join(srcDir, file), 'utf8');
    for (const literal of keyLiterals) {
      if (contents.includes(literal)) offenders.push(`${file} contains the key "${literal}"`);
    }
  }

  assert.deepEqual(offenders, [], 'storage keys belong to src/storage.ts alone');
});

test('storage.ts is the only source file touching chrome.storage directly', async () => {
  const files = await sourceFiles();
  const offenders: string[] = [];

  for (const file of files) {
    const contents = await readFile(join(srcDir, file), 'utf8');
    // Comments may name the API; only real access counts.
    const stripped = contents
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/\bchrome\.storage\b/.test(stripped)) offenders.push(file);
  }

  assert.deepEqual(offenders, [], 'every read and write goes through src/storage.ts');
});
