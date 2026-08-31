/**
 * The options page: the surface that makes configuration possible at all.
 *
 * R8 (key, capture role, default status), R21 (say plainly when configuration
 * cannot complete), and KD4's other half — a capture held here files the moment
 * configuration becomes valid.
 *
 * The page never writes to GlassFrog itself beyond KTD8's validation probe.
 * Filing goes through the service worker (KTD1), which reacts to configuration
 * changing rather than being told.
 */
import { attemptConfiguration, describePending } from './config.ts';
import { fetchRolesForKey } from './glassfrog.ts';
import { discardPendingCapture } from './pending.ts';
import { captureRoleCaveat, roleOptions } from './roles.ts';
import {
  type DefaultStatus,
  type RoleSummary,
  getCaptureRoleId,
  getDefaultStatus,
  onPendingCaptureChanged,
  readPendingCapture,
  setApiKey,
  setCaptureRoleId,
  setDefaultStatus,
  setRoles,
} from './storage.ts';

/* ------------------------------------------------------------------- DOM -- */

interface Elements {
  form: HTMLFormElement;
  apiKey: HTMLInputElement;
  role: HTMLSelectElement;
  status: HTMLSelectElement;
  save: HTMLButtonElement;
  message: HTMLElement;
  pending: HTMLElement;
  pendingText: HTMLElement;
  discard: HTMLButtonElement;
}

function elements(): Elements | undefined {
  const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
  const form = byId<HTMLFormElement>('config');
  const apiKey = byId<HTMLInputElement>('api-key');
  const role = byId<HTMLSelectElement>('role');
  const status = byId<HTMLSelectElement>('status');
  const save = byId<HTMLButtonElement>('save');
  const message = byId<HTMLElement>('message');
  const pending = byId<HTMLElement>('pending');
  const pendingText = byId<HTMLElement>('pending-text');
  const discard = byId<HTMLButtonElement>('discard');
  if (!form || !apiKey || !role || !status || !save || !message || !pending) return undefined;
  if (!pendingText || !discard) return undefined;
  return { form, apiKey, role, status, save, message, pending, pendingText, discard };
}

function say(el: Elements, text: string, tone: 'error' | 'ok' | 'idle'): void {
  // textContent, never innerHTML. This page holds the API key, and every string
  // reaching it is either page-derived or GlassFrog-derived (R7).
  el.message.textContent = text;
  el.message.dataset.tone = tone;
}

/**
 * The capture role is the default for every work type, tensions included, so
 * every role stays selectable here — the work-type-dependent filter belongs to
 * the popup, where a work type has actually been chosen. What this picker does
 * need is #30's qualification: three roles called `Circle Lead` are otherwise
 * indistinguishable, and choosing the wrong one misfiles every later capture.
 */
function fillRoles(el: Elements, roles: RoleSummary[], selected?: string): void {
  el.role.replaceChildren();
  for (const entry of roleOptions(roles, 'tension')) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    if (entry.id === selected) option.selected = true;
    el.role.append(option);
  }
  el.role.disabled = roles.length === 0;
}

/**
 * The whole block is hidden rather than emptied, because it now contains a
 * control as well as text: an empty `<span>` beside a live Discard button would
 * offer to discard nothing.
 */
async function showPending(el: Elements): Promise<void> {
  const pending = await readPendingCapture();
  if (pending.state !== 'current') {
    el.pendingText.textContent = '';
    el.pending.hidden = true;
    return;
  }
  const { page } = pending.pending.capture;
  el.pendingText.textContent = `Waiting to file: ${describePending(page.title, page.url)}`;
  el.pending.hidden = false;
  el.discard.disabled = false;
}

export function init(): void {
  const el = elements();
  if (!el) return;

  void showPending(el);
  void getDefaultStatus().then((status) => {
    el.status.value = status;
  });

  // AE9: openOptionsPage() may only *focus* an already-open page, in which case
  // the load-time read above never runs again. Without this listener a capture
  // arriving now would never appear, and AE9 would fail silently.
  onPendingCaptureChanged(() => void showPending(el));

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(el);
  });

  // The plan's `Pending --> None: practitioner discards` edge. Until this, every
  // exit from the slot was automatic, so a capture the practitioner had decided
  // against could only be dropped by waiting out the seven-day expiry.
  el.discard.addEventListener('click', () => {
    el.discard.disabled = true;
    void discardPendingCapture().then(() => showPending(el));
  });
}

async function save(el: Elements): Promise<void> {
  el.save.disabled = true;
  say(el, 'Checking that key with GlassFrog…', 'idle');

  const attempt = await attemptConfiguration(fetchRolesForKey, el.apiKey.value);

  if (!attempt.ok) {
    say(el, attempt.message, 'error');
    // A rejected key never populates the picker — offering roles from a key
    // GlassFrog refused would be inviting a second failure.
    if (attempt.reason !== 'unreachable') fillRoles(el, []);
    el.save.disabled = false;
    return;
  }

  await setApiKey(el.apiKey.value.trim());
  await setRoles(attempt.roles);
  fillRoles(el, attempt.roles, (await getCaptureRoleId()) ?? el.role.value);
  await setDefaultStatus(el.status.value === 'someday' ? 'someday' : ('current' satisfies DefaultStatus));

  const chosen = el.role.value;
  if (!chosen) {
    // The two-phase save: a valid key with no role yet is a real state, and
    // configuration stays incomplete until the role is picked, so nothing files.
    say(el, 'Key accepted. Now choose the role your captures should file against, then save again.', 'ok');
    el.save.disabled = false;
    return;
  }

  await setCaptureRoleId(chosen);
  // Saving a circle here is legitimate — tensions file against circles as a
  // matter of course — but every action and project will then need a different
  // role picked in the popup, and finding that out at filing time is too late.
  say(
    el,
    `Saved. Any capture waiting to be filed will go out now.${captureRoleCaveat(attempt.roles, chosen)}`,
    'ok',
  );
  el.save.disabled = false;
}

if (typeof document !== 'undefined') init();
