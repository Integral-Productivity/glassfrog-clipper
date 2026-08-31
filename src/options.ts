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
import { fetchRolesForKey, getQueueReader } from './glassfrog.ts';
import { captureMetrics } from './metrics.ts';
import { discardPendingCapture } from './pending.ts';
import { queueHealth, resolveQueueRoot } from './queue-health.ts';
import { type ReportSection, formatCaptureMetrics, formatQueueHealth } from './report.ts';
import { captureRoleCaveat, roleOptions } from './roles.ts';
import {
  type DefaultStatus,
  type RoleSummary,
  getCaptureRoleId,
  getDefaultStatus,
  getRoles,
  onPendingCaptureChanged,
  readPendingCapture,
  setApiKey,
  setCaptureRoleId,
  setDefaultStatus,
  setRoles,
} from './storage.ts';
import { clearTelemetry, readTelemetry } from './telemetry.ts';

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
  captureMetrics: HTMLElement;
  queueHealth: HTMLElement;
  queueMessage: HTMLElement;
  checkQueue: HTMLButtonElement;
  copyTelemetry: HTMLButtonElement;
  clearTelemetry: HTMLButtonElement;
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
  const captureMetrics = byId<HTMLElement>('capture-metrics');
  const queueHealth = byId<HTMLElement>('queue-health');
  const queueMessage = byId<HTMLElement>('queue-message');
  const checkQueue = byId<HTMLButtonElement>('check-queue');
  const copyTelemetry = byId<HTMLButtonElement>('copy-telemetry');
  const clearTelemetry = byId<HTMLButtonElement>('clear-telemetry');
  if (!pendingText || !discard) return undefined;
  if (!captureMetrics || !queueHealth || !queueMessage || !checkQueue || !copyTelemetry || !clearTelemetry) {
    return undefined;
  }
  return {
    form,
    apiKey,
    role,
    status,
    save,
    message,
    pending,
    pendingText,
    discard,
    captureMetrics,
    queueHealth,
    queueMessage,
    checkQueue,
    copyTelemetry,
    clearTelemetry,
  };
}

/* ----------------------------------------------------------- measurement -- */

/**
 * Renders a report section.
 *
 * textContent throughout. This page holds the API key, and a report that
 * interpolated GlassFrog-derived text into innerHTML would be the one place in
 * the extension where reading the queue could execute something (R7).
 */
function renderSection(host: HTMLElement, section: ReportSection): void {
  host.replaceChildren();

  const heading = document.createElement('h2');
  heading.textContent = section.title;

  const caption = document.createElement('p');
  caption.className = 'caption';
  caption.textContent = section.caption;

  const list = document.createElement('ul');
  for (const line of section.lines) {
    const item = document.createElement('li');
    if (line.verdict) item.dataset.verdict = line.verdict;

    const row = document.createElement('div');
    row.className = 'row';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = line.label;

    const figure = document.createElement('span');
    figure.className = 'figure';
    figure.textContent = line.value;

    row.append(name, figure);
    item.append(row);

    if (line.note) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = line.note;
      item.append(note);
    }
    list.append(item);
  }

  host.append(heading, caption, list);
}

/** The three telemetry metrics. A local read — this never touches the network. */
async function showCaptureMetrics(el: Elements): Promise<void> {
  renderSection(el.captureMetrics, formatCaptureMetrics(captureMetrics(await readTelemetry())));
}

/**
 * The fourth metric, behind a button.
 *
 * Deliberately not run on page load. It is the only read in the extension that
 * walks a circle tree, and a configuration page that fired a multi-page API
 * sweep every time it opened would spend the practitioner's rate limit on a
 * number they did not ask for.
 */
async function checkQueueHealth(el: Elements): Promise<void> {
  el.checkQueue.disabled = true;
  el.queueMessage.textContent = 'Reading the queue from GlassFrog…';

  try {
    const captureRoleId = await getCaptureRoleId();
    if (!captureRoleId) {
      el.queueMessage.textContent =
        'Choose a capture role first — queue health is measured from the circle it sits in.';
      return;
    }

    const rootRoleId = resolveQueueRoot(await getRoles(), captureRoleId);
    const records = await (await getQueueReader()).listCircleTree(rootRoleId);

    renderSection(el.queueHealth, formatQueueHealth(queueHealth(records, { rootRoleId })));
    el.queueMessage.textContent = '';
  } catch (error) {
    // The message is written here rather than echoed from the SDK, so no
    // redaction is needed for it to satisfy R12.
    el.queueHealth.replaceChildren();
    el.queueMessage.textContent =
      error instanceof Error && error.message.includes('No GlassFrog API key')
        ? 'Add an API key above, then check again.'
        : 'Could not read the queue from GlassFrog. Try again in a moment.';
  } finally {
    el.checkQueue.disabled = false;
  }
}

/**
 * The whole of egress, and it is a button.
 *
 * STRATEGY.md's Distribution & trust track makes trust the adoption gate, so
 * telemetry leaving the device is a deliberate act with a visible result, not a
 * setting that could be on without anyone noticing.
 */
async function copyTelemetry(el: Elements): Promise<void> {
  const log = await readTelemetry();
  try {
    await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    el.queueMessage.textContent = `Copied ${log.length} telemetry records to the clipboard.`;
  } catch {
    el.queueMessage.textContent = 'Could not reach the clipboard. Nothing was copied and nothing was sent.';
  }
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
  void showCaptureMetrics(el);
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

  el.checkQueue.addEventListener('click', () => void checkQueueHealth(el));
  el.copyTelemetry.addEventListener('click', () => void copyTelemetry(el));
  el.clearTelemetry.addEventListener('click', () => {
    void clearTelemetry().then(() => showCaptureMetrics(el));
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
