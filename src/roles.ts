/**
 * How roles are named and which of them a given work type may be filed against.
 *
 * Both concerns are pure and live here rather than in the two pages that render
 * a picker: the popup and the options page would otherwise grow two drifting
 * copies, and neither page's `fillRoles` is reachable from a test — there is no
 * DOM harness in this suite. Keeping the decisions in a pure module is what
 * makes them testable at all.
 */
import type { RoleSummary } from './storage.ts';
import type { WorkType } from './types.ts';

/**
 * The last-resort way to tell two roles apart. Role ids are opaque 32-hex, so
 * a fragment is the only distinguishing thing left once names have failed.
 */
export function idFragment(id: string): string {
  return id.replace(/^role_/, '').slice(0, 8);
}

/**
 * A role's name is nullable in the v5 schema. An unnamed role would otherwise
 * render as a blank option the practitioner cannot tell apart from another one.
 */
export function displayName(name: string | null | undefined, id: string): string {
  const trimmed = name?.trim();
  return trimmed || `Untitled role (${idFragment(id)})`;
}

/**
 * A circle is a role that has subroles. `hasSubroles` is absent on role lists
 * cached before it was read, and absent reads as "not known to be a circle" —
 * which restores the pre-change behaviour of offering everything rather than
 * silently hiding roles from a practitioner whose cache is one save behind.
 */
export function isCircle(role: RoleSummary): boolean {
  return role.hasSubroles === true;
}

/**
 * Circles are not offered for actions or projects.
 *
 * This is a governance choice, not an API constraint, and it must stay one in
 * the reader's mind. The v5 API accepts a project on a circle — verified live
 * against `◎Coaching`, which holds current projects. In Holacracy a circle's
 * own projects and actions sit with its Circle Lead rather than with the circle,
 * so offering the circle invites filing work nobody holds. Removing this filter
 * because "the API allows it" would be reinstating the defect, not fixing one.
 *
 * Tensions are deliberately untouched: sensing a tension *about* a circle is
 * ordinary practice, and the live unprocessed queue is full of them.
 */
export function isSelectableFor(role: RoleSummary, workType: WorkType): boolean {
  return workType === 'tension' || !isCircle(role);
}

/** One entry in a role picker: what to show, and whether it can be chosen. */
export interface RoleOption {
  id: string;
  label: string;
  selectable: boolean;
}

/**
 * Builds the picker's entries for a work type.
 *
 * Names are qualified by parent circle only when they need it. Role names are
 * not unique — this account fills three called `Circle Lead` — and picking the
 * wrong one files silently against the wrong role, with nothing in the UI to
 * catch it. Qualifying unconditionally would be worse in the common case, so
 * a unique name stays bare.
 */
export function roleOptions(roles: RoleSummary[], workType: WorkType): RoleOption[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const nameCounts = new Map<string, number>();
  for (const role of roles) nameCounts.set(role.name, (nameCounts.get(role.name) ?? 0) + 1);

  return roles.map((role) => {
    const ambiguous = (nameCounts.get(role.name) ?? 0) > 1;
    const selectable = isSelectableFor(role, workType);
    const qualified = ambiguous ? qualify(role, byId) : role.name;
    return {
      id: role.id,
      // A disabled option with no explanation reads as a broken list. The
      // reason itself is stated once beside the picker, not in every row.
      label: selectable ? qualified : `${qualified} (circle)`,
      selectable,
    };
  });
}

/**
 * Adds whatever distinguishes this role from its same-named siblings.
 *
 * Every role the practitioner fills arrives in the same list, so most parents
 * resolve locally. The two that do not fall back to an id fragment rather than
 * a second network read — the same shape `displayName` already uses for a null
 * name, so the picker has one fallback style rather than two.
 */
function qualify(role: RoleSummary, byId: Map<string, RoleSummary>): string {
  const parentId = role.parentRoleId;
  // No parent id: the anchor role, or a list cached before parents were read.
  if (!parentId) return `${role.name} (${idFragment(role.id)})`;

  const parent = byId.get(parentId);
  // A sub-role whose circle the practitioner does not fill. The parent fragment
  // still separates two same-named roles, which is the whole job.
  return parent ? `${role.name} — ${parent.name}` : `${role.name} — parent ${idFragment(parentId)}`;
}

/**
 * What to say beside the popup's picker once a work type is chosen.
 *
 * A greyed-out option with no stated reason reads as a broken list, and a
 * selection the browser silently moved off a circle reads as nothing at all —
 * which is the failure mode R5 exists to prevent, arriving by a different door.
 * The practitioner is told, rather than the filing quietly going elsewhere.
 */
export function circleNotice(roles: RoleSummary[], workType: WorkType, roleId: string): string {
  if (workType === 'tension') return '';

  const reason =
    'Circles are not offered for actions and projects — in Holacracy that work sits with the Circle Lead rather than with the circle.';
  const chosen = roles.find((role) => role.id === roleId);

  return chosen && isCircle(chosen) ? `${chosen.name} is a circle, so it is no longer selected. ${reason}` : reason;
}

/**
 * What to add when the role saved as the capture default turns out to be a
 * circle. It is a legitimate choice — tensions file against circles all day —
 * but every action and project will need a different role in the popup, and
 * finding that out at filing time is finding out too late.
 */
export function captureRoleCaveat(roles: RoleSummary[], roleId: string): string {
  const role = roles.find((candidate) => candidate.id === roleId);
  if (!role || !isCircle(role)) return '';
  return ` ${role.name} is a circle: tensions will file against it, but actions and projects will need another role chosen in the popup.`;
}
