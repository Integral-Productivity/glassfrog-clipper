# AGENTS.md

Orientation for an agent working in this repository.

This file exists because agent tooling looks for `AGENTS.md` by name, and
because a pointer in a README does not reach it. [README.md](README.md) already
names every artifact below and is the map for a person who opens the
repository; this file deliberately does not restate it. What is here is the
half a README has no reason to carry: **how the two knowledge stores are shaped
so you can search them**, and **which recorded decisions constrain the shape of
the change you are about to make** rather than its content.

Informational, not a pre-flight checklist. Nothing here needs reading before
every task — it is here so you know what exists and can judge for yourself when
it is worth opening.

## Knowledge stores

### `docs/solutions/` — what this project has already worked out

Documented solutions to past problems: bugs, best practices, and workflow
patterns, written one document per learning and grounded against the tree as it
stood that day. Relevant when implementing or debugging in an area a past
session has already been through, and when a conclusion feels settled but was
never actually checked against the system it describes.

The corpus grows on its own — `/compound-engineering:ce-compound` adds to it
whenever a session solves something non-trivial — so it is described here by
its structure, never by its size.

**Shape.** One subdirectory per category (`best-practices/`,
`workflow-issues/`; more as they are needed), one Markdown file per learning,
YAML frontmatter on every file:

| Field | What it holds |
|---|---|
| `title` | The learning as a claim, not a topic |
| `date` | When it was written — and so which tree it was grounded against |
| `category` | Matches the subdirectory |
| `module` | The area it came out of: `share-extension-tests`, `verification-discipline`, `dependency-install` |
| `problem_type` | `best_practice`, `workflow_issue`, `convention`, `design_pattern`, `developer_experience` |
| `tags` | Free-form, and the widest net of the three |
| `applies_when` | The situations that should bring you here, written for someone who does not yet know the answer |

Most documents also carry `symptoms` — what the problem looks like from the
outside, before it has been diagnosed. That one is not universal.

**Searching it.** `applies_when` and `symptoms` are the fields worth grepping
when you have a situation but not a name for it; `module` and `tags` are the
ones worth grepping when you do.

```bash
grep -rn 'applies_when:' -A 8 docs/solutions      # what each doc claims to cover
grep -rln 'share-extension' docs/solutions        # by area, across fields
grep -rn '^problem_type:' docs/solutions | sort   # the corpus by kind
```

The field names above are held to the corpus by
[`test/agents-md.test.ts`](test/agents-md.test.ts), so a field named here is
one every document actually carries. That test is the reason this section can
be trusted rather than merely believed.

### `CONCEPTS.md` — the words this project has agreed on

Shared domain vocabulary: entities (`capture`, `capture role`, `provenance
marker`), named processes (`quick capture`, `structured capture`), and status
concepts (`pending capture`, `in-flight marker`, `unusable role`), each with a
meaning specific to this project. It also records the domain/surface-layer
split that [ADR 0011](docs/adr/0011-behaviour-is-specified-at-the-domain-with-a-thin-platform-surface-layer.md)
decided, and a *Flagged ambiguities* section for words that are still contested.

Its failure mode is worth stating because it is not "you miss something." An
agent that has not read it does not merely lack the word — it invents a
competing one, and the drift is invisible until two parts of the codebase are
naming the same thing differently. Several entries carry an explicit
*Avoid:* line for exactly this reason (`popup path`, for instance, is a word
this project decided against).

Relevant when orienting to the codebase, and when naming anything new.

## Decisions that constrain your change, not the product

[`docs/adr/`](docs/adr/) holds the architecture decisions. Most describe the
product and are worth reading when you touch what they cover. A handful instead
govern **how a change may be shaped**, and an agent that has not read those
will produce a pull request that fails a required check, or that merges having
silently dropped something. Those are named here; the rest of the directory is
background you can reach for when a design question comes up.

- **[ADR 0009](docs/adr/0009-ai-authorship-survives-a-squash-only-where-the-diff-is-unchanged.md)
  — one commit per pull request, where that is natural.** This repository
  publishes line-level AI-authorship notes. Squash-merging a single-commit pull
  request yields a byte-identical diff, so the note's line ranges still describe
  real code and the attribution can be carried across; a multi-commit pull
  request lands with *no* attribution rather than wrong attribution. Nothing
  fails — that is the point. The loss is silent.
- **[ADR 0012](docs/adr/0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md)
  and [ADR 0013](docs/adr/0013-an-adr-number-is-defended-at-three-points-not-one.md)
  — exactly one required check, and it must be up to date.** `main` runs with
  `strict_required_status_checks_policy` on, so a branch that falls behind must
  be brought current before it can merge. Bringing it current with a merge
  commit turns a compliant one-commit pull request into a two-commit one, which
  is ADR 0009's silent loss arriving with no author involved. `gh pr
  update-branch --rebase` is the way out — it reconciles by rebasing rather than
  merging, so the branch comes current *and* stays at one commit. The bare form
  of that command is the trap, not the remedy; see
  [#130](https://github.com/Integral-Productivity/glassfrog-clipper/issues/130).
- **[ADR 0013](docs/adr/0013-an-adr-number-is-defended-at-three-points-not-one.md)
  — an ADR number is shared mutable state claimed on a private branch.** The
  next free number is not what `ls docs/adr/` says; open pull requests hold
  claims too. Two collisions have already happened this way.
- **[ADR 0011](docs/adr/0011-behaviour-is-specified-at-the-domain-with-a-thin-platform-surface-layer.md)
  — behaviour is specified at the domain, with a thin platform surface layer.**
  Decides where a behaviour change belongs, and why a surface layer stays thin
  enough to be reviewed rather than tested.
- **[ADR 0010](docs/adr/0010-four-architectural-characteristics-get-fitness-functions.md)
  — four architectural characteristics get fitness functions.** Explains why
  `fitness/` and `test/fitness/` exist and what they are permitted to assert.

## Claiming an issue

[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) is the vocabulary
an agent writes rather than merely reads: six mutually exclusive issue states,
orthogonal markers including `status:in-progress`, and one `track:*` per issue.
[`docs/agents/labels.json`](docs/agents/labels.json) is the source of truth —
the document explains it, `npm test` holds the document to it, and
[`.github/workflows/label-drift.yml`](.github/workflows/label-drift.yml) holds
the live GitHub labels to it. Edit the manifest, not the prose and not the
labels in the GitHub UI.

## Everything else

Not repeated here, because these files say it better and going stale in two
places is worse than going stale in one:

- [README.md](README.md) — what the extension is, its actual status, how to
  build and load it, and the limits of the AI-authorship record.
- [CONTRIBUTING.md](CONTRIBUTING.md) — the loop, the commit conventions, the CLA,
  and the `npm ci` token barrier you will hit locally.
- [STRATEGY.md](STRATEGY.md) — what this project is for and what it is not, and
  the tracks the `track:*` labels name.
