import { pageContextFromTab } from './capture.ts';

/**
 * The zero-decision path: keyboard shortcut → filed. No popup, no confirm step.
 * STRATEGY.md's resist test rejects anything that puts a decision in here.
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'quick-capture') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const page = pageContextFromTab(tab);
  // TODO: hand off to the filing path once resolveWorkType is implemented.
  console.debug('[clipper] quick-capture', page);
});
