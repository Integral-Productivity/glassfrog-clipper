/**
 * Whether an `operator-errand` issue carries what the convention obliges.
 *
 * `docs/agents/operator-runbooks.md` says an issue labelled `operator-errand`
 * must carry an executable runbook and a block telling an agent to walk the
 * operator through it. Nothing checked that, and the document said so itself:
 * "Nowhere automatically, today."
 *
 * That is #46's observation recurring against a new document — a convention with
 * an artifact and no enforcement — and the failure is the silent kind. An errand
 * filed without a runbook produces no red signal anywhere, so the convention
 * decays and the first sign is a future session re-deriving mechanics that #166
 * existed to stop being re-derived.
 *
 * The rules are pure functions over an issue body so they can be exercised
 * against fixtures offline. Only `check-operator-runbooks.ts` talks to GitHub.
 */

/** The parts of an issue this check reads. */
export interface Errand {
  number: number;
  title: string;
  body: string | null;
}

/** What an errand is missing, in the words its report will use. */
export interface ErrandProblem {
  number: number;
  title: string;
  missing: string[];
}

/**
 * The body under a heading, up to the next heading of the same or higher level.
 *
 * Scoped rather than whole-body, because the whole point is structure: an issue
 * that merely mentions the word "runbook" in prose has not got one.
 */
export function sectionUnder(body: string, headingPattern: RegExp): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^#{2,3}\s/.test(line) && headingPattern.test(line));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * The numbered steps under a `## Runbook` heading.
 *
 * A heading alone is checkable and gameable — the issue says so. Matching on
 * structure costs little more and means something: a runbook is an ordered list
 * of things to do, and one that is not ordered is a description.
 */
export function runbookSteps(body: string): string[] {
  const section = sectionUnder(body, /\brunbook\b/i);
  if (section === null) return [];
  return section.split('\n').filter((line) => /^\s*\d+\.\s+\S/.test(line));
}

/** The fewest numbered steps that make an ordered list rather than a sentence. */
export const MINIMUM_STEPS = 2;

/**
 * Whether the body carries a block addressed to agents.
 *
 * Two accepted shapes, because pinning one heading string would make the check
 * a spelling test. #164 — the worked example the convention names — uses a
 * heading, so a heading mentioning agents counts; and the instruction the
 * convention actually cares about is that an agent *walks the operator through*
 * rather than attempting the steps or handing the issue back, so that phrasing
 * counts wherever it appears.
 */
export function hasAgentBlock(body: string): boolean {
  const headingMentionsAgents = body
    .split('\n')
    .some((line) => /^#{2,3}\s/.test(line) && /\bagents?\b/i.test(line));

  return headingMentionsAgents || /walk (?:the )?operator through/i.test(body);
}

/** Everything the convention obliges, or an empty list when the errand is compliant. */
export function errandProblems(errand: Errand): ErrandProblem | null {
  const body = errand.body ?? '';
  const missing: string[] = [];

  const steps = runbookSteps(body);
  if (sectionUnder(body, /\brunbook\b/i) === null) {
    missing.push('no `## Runbook` heading');
  } else if (steps.length < MINIMUM_STEPS) {
    missing.push(`a Runbook heading with ${steps.length} numbered step(s); an ordered list needs at least ${MINIMUM_STEPS}`);
  }

  if (!hasAgentBlock(body)) {
    missing.push('no block telling an agent to walk the operator through it');
  }

  return missing.length === 0 ? null : { number: errand.number, title: errand.title, missing };
}

/** Every non-compliant errand, lowest number first. */
export function nonCompliantErrands(errands: Errand[]): ErrandProblem[] {
  return errands
    .flatMap((errand) => {
      const problem = errandProblems(errand);
      return problem === null ? [] : [problem];
    })
    .sort((a, b) => a.number - b.number);
}

/** The standing issue's body. Rewritten in place each run, the way label-drift does it. */
export function markdownReport(problems: ErrandProblem[], scanned: number): string {
  const lines = [
    `${problems.length} of ${scanned} open \`operator-errand\` issue(s) do not carry what`,
    '[`docs/agents/operator-runbooks.md`](../blob/main/docs/agents/operator-runbooks.md) obliges.',
    '',
  ];

  for (const problem of problems) {
    lines.push(`- **#${problem.number}** — ${problem.title}`);
    for (const missing of problem.missing) lines.push(`  - ${missing}`);
  }

  lines.push(
    '',
    'A runbook is numbered, in order, and specific enough to follow without',
    're-deriving anything. Where the mechanics have not been researched, say so in',
    'the step rather than writing a plausible one — a confidently wrong step costs',
    'the operator the errand, and sometimes something that cannot be taken back.',
  );

  return lines.join('\n');
}
