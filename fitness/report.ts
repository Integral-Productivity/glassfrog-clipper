/**
 * The shape every fitness check reports in, and how a run is rendered.
 *
 * A check carries the architectural *characteristic* it defends, not just a
 * name. That is the whole point of docs/adr/0010: a check whose rationale lives
 * only in a commit message becomes a check nobody dares change, so the CI output
 * itself has to say what is being protected and why a red is worth reading.
 */

export interface Violation {
  /** Where the problem is — a path, a filename, a manifest key. */
  where: string;
  /** What is wrong, in terms a reader can act on without opening the check. */
  detail: string;
}

export interface CheckResult {
  /** Stable slug. Referenced by docs/adr/0010 and by the colocated test. */
  name: string;
  /** The architectural characteristic this check defends. */
  characteristic: string;
  compliant: boolean;
  /** One line, true whether the check passed or failed. */
  summary: string;
  violations: Violation[];
}

export function pass(
  name: string,
  characteristic: string,
  summary: string,
): CheckResult {
  return { name, characteristic, compliant: true, summary, violations: [] };
}

export function fail(
  name: string,
  characteristic: string,
  summary: string,
  violations: Violation[],
): CheckResult {
  // A "failure" with nothing to point at is a bug in the check, not a finding:
  // it would render as a red with no way to act on it.
  if (violations.length === 0) {
    throw new Error(`${name} reported a failure with no violations`);
  }
  return { name, characteristic, compliant: false, summary, violations };
}

/**
 * Markdown for stdout. The reusable pipes this into the GitHub step summary, so
 * it is read far more often on the red path than the green one — failures lead
 * and carry their detail inline rather than behind an artifact download.
 */
export function renderMarkdown(results: CheckResult[]): string {
  const failed = results.filter((result) => !result.compliant);
  const lines: string[] = [];

  lines.push(
    failed.length === 0
      ? `**${results.length} checks, all compliant.**`
      : `**${failed.length} of ${results.length} checks failed.**`,
  );
  lines.push('');

  for (const result of failed) {
    lines.push(`### ❌ ${result.name}`);
    lines.push('');
    lines.push(`_Characteristic: ${result.characteristic}_`);
    lines.push('');
    lines.push(result.summary);
    lines.push('');
    for (const violation of result.violations) {
      lines.push(`- \`${violation.where}\` — ${violation.detail}`);
    }
    lines.push('');
  }

  lines.push('| Check | Characteristic | Result |');
  lines.push('| --- | --- | --- |');
  for (const result of results) {
    lines.push(
      `| ${result.name} | ${result.characteristic} | ${result.compliant ? '✅' : '❌'} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
