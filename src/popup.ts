/**
 * The structured path: the same capture, more of it revealed.
 *
 * Per STRATEGY.md this is one path with more surface, not a second flow — so it
 * reads the same tab the shortcut would (captureActiveTab) and files through the
 * same service worker (KTD1). The popup never writes to GlassFrog itself: Chrome
 * destroys a popup on blur with no way to prevent it, so a popup-owned fetch
 * would lose captures the practitioner had already committed to.
 *
 * R20 is the reason for most of the machinery here. A popup that discards what
 * you typed the moment you glance away is one the practitioner stops trusting
 * with anything longer than a word.
 */
import { captureActiveTab } from './capture.ts';
import { FILE_CAPTURE, type FileCaptureOutcome, type FileCaptureRequest } from './messages.ts';
import { takeUnseenNotice } from './notify.ts';
import { holdCapture } from './pending.ts';
import { circleNotice, roleOptions } from './roles.ts';
import {
  type PopupDraft,
  type RoleSummary,
  clearDraft,
  getCaptureRoleId,
  getConfigurationState,
  getRoles,
  readDraft,
  writeDraft,
} from './storage.ts';
import type { Capture, PageContext, WorkType } from './types.ts';

export interface PopupFields {
  roleId: string;
  workType: WorkType;
  note: string;
}

const WORK_TYPES: readonly WorkType[] = ['tension', 'action', 'project'];

function isWorkType(value: unknown): value is WorkType {
  return typeof value === 'string' && (WORK_TYPES as readonly string[]).includes(value);
}

/**
 * R5 and R20 in one function: a value the practitioner set survives, and a
 * configured default only ever fills a gap.
 *
 * The precedence matters more than it looks. Letting the configured role win
 * would mean reopening the popup silently reverts a role the practitioner chose
 * deliberately — filing the capture against the wrong role while showing them
 * the right one.
 */
export function initialFields(
  draft: PopupDraft | undefined,
  defaults: { roleId?: string },
): PopupFields {
  return {
    roleId: draft?.roleId ?? defaults.roleId ?? '',
    workType: isWorkType(draft?.workType) ? draft.workType : 'tension',
    note: draft?.note ?? '',
  };
}

/** What actually gets sent. An unset work type stays unset, so KD2 applies. */
export function toCapture(page: PageContext, fields: PopupFields): Capture {
  return {
    page,
    ...(fields.note.trim() ? { note: fields.note.trim() } : {}),
    ...(fields.workType !== 'tension' ? { workType: fields.workType } : {}),
    ...(fields.roleId ? { roleId: fields.roleId } : {}),
  };
}

export function newCaptureId(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------- DOM -- */

interface Elements {
  form: HTMLFormElement;
  role: HTMLSelectElement;
  roleNote: HTMLElement;
  workType: HTMLSelectElement;
  note: HTMLTextAreaElement;
  page: HTMLElement;
  message: HTMLElement;
  file: HTMLButtonElement;
}

const currentWorkType = (el: Elements): WorkType =>
  isWorkType(el.workType.value) ? el.workType.value : 'tension';

function elements(): Elements | undefined {
  const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
  const form = byId<HTMLFormElement>('capture');
  const role = byId<HTMLSelectElement>('role');
  const roleNote = byId<HTMLElement>('role-note');
  const workType = byId<HTMLSelectElement>('work-type');
  const note = byId<HTMLTextAreaElement>('note');
  const page = byId<HTMLElement>('page');
  const message = byId<HTMLElement>('message');
  const file = byId<HTMLButtonElement>('file');
  if (!form || !role || !roleNote || !workType || !note || !page || !message || !file) return undefined;
  return { form, role, roleNote, workType, note, page, message, file };
}

/**
 * Rebuilds the picker for the current work type.
 *
 * A circle is rendered disabled rather than dropped: a practitioner who expects
 * to see one needs to learn it is not selectable, not that the list is broken.
 */
function fillRoles(el: Elements, roles: RoleSummary[], selected: string, workType: WorkType): void {
  el.role.replaceChildren();
  for (const entry of roleOptions(roles, workType)) {
    const option = document.createElement('option');
    option.value = entry.id;
    // textContent: role names come from GlassFrog and are not ours to trust (R7).
    option.textContent = entry.label;
    option.disabled = !entry.selectable;
    if (entry.id === selected && entry.selectable) option.selected = true;
    el.role.append(option);
  }
}

async function start(): Promise<void> {
  const el = elements();
  if (!el) return;

  const page = await captureActiveTab();
  if (!page) {
    el.message.textContent = 'Chrome does not allow extensions to read this tab.';
    el.file.disabled = true;
    return;
  }

  // R7: page-derived text, rendered as text.
  el.page.textContent = page.title || page.url;

  const state = await getConfigurationState();
  if (!state.configured) {
    // R9: the same routing the shortcut does. Rendering an empty form over an
    // unconfigured extension would waste whatever the practitioner then typed.
    await holdCapture({ page }, newCaptureId());
    window.close();
    return;
  }

  // Where a notice had nowhere else to go — Safari with no reachable containing
  // app — this is where the practitioner finally learns a previous capture did
  // not file. Shown before anything they type here, because it may change what
  // they do next (R18: an unusable role wants reconfiguring, not a retry).
  const unseen = await takeUnseenNotice();
  if (unseen) el.message.textContent = `${unseen.title}: ${unseen.message}`;

  const [draft, roles, configuredRole] = await Promise.all([
    readDraft(),
    getRoles(),
    getCaptureRoleId(),
  ]);
  const fields = initialFields(draft, { roleId: configuredRole ?? undefined });

  el.workType.value = fields.workType;
  el.note.value = fields.note;

  // Which roles may be filed against depends on the work type, so the picker is
  // rebuilt whenever that changes rather than filled once at load.
  const renderRoles = (): void => {
    const workType = currentWorkType(el);
    const wanted = el.role.value || fields.roleId;
    fillRoles(el, roles, wanted, workType);
    el.roleNote.textContent = circleNotice(roles, workType, wanted);
  };
  renderRoles();

  const persist = (): void => {
    void writeDraft({
      roleId: el.role.value,
      workType: currentWorkType(el),
      note: el.note.value,
    });
  };
  // Every change, not just submit — the popup can be destroyed on blur at any
  // moment, and there is no event that reliably precedes it.
  el.role.addEventListener('change', persist);
  el.workType.addEventListener('change', () => {
    renderRoles();
    persist();
  });
  el.note.addEventListener('input', persist);

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void file(el, page);
  });
}

async function file(el: Elements, page: PageContext): Promise<void> {
  el.file.disabled = true;
  el.message.textContent = 'Filing…';

  const capture = toCapture(page, {
    roleId: el.role.value,
    workType: currentWorkType(el),
    note: el.note.value,
  });

  const request: FileCaptureRequest = { type: FILE_CAPTURE, captureId: newCaptureId(), capture };

  try {
    // Best-effort: the popup may well be gone before this resolves, which KTD1
    // treats as expected. The worker still finishes the write either way.
    const outcome = (await chrome.runtime.sendMessage(request)) as FileCaptureOutcome | undefined;
    if (outcome?.status === 'filed') {
      await clearDraft();
      window.close();
      return;
    }
    el.message.textContent =
      outcome?.status === 'failed' ? outcome.failure.message : 'Filed, or still filing — check GlassFrog.';
  } catch {
    el.message.textContent = 'The extension could not be reached. Your draft is saved.';
  }
  el.file.disabled = false;
}

if (typeof document !== 'undefined') void start();
