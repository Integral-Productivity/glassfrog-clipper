# Triage labels

The vocabulary a triage pass on this repo assigns. It exists so that a reader on
disk — or an agent without repo API access — can see the convention without
running `gh label list`, and so a triage pass does not have to re-derive which
state fits.

## Which way authority runs

[`docs/agents/labels.json`](labels.json) is the **source of truth** for this
repository's labels. This file explains that manifest in prose; GitHub is
applied from it. When any two of the three disagree, the manifest is right and
the other one is what needs correcting.

Nothing here is maintained by remembering to. Both disagreements are caught:

| Disagreement | Caught by | When |
|---|---|---|
| This document vs. the manifest | `test/label-manifest.test.ts`, in `npm test` | Every pull request, before merge |
| The manifest vs. the live GitHub labels | [`.github/workflows/label-drift.yml`](../../.github/workflows/label-drift.yml) | Daily, and whenever the manifest changes on `main` |

The split exists because labels live behind the GitHub API. A check that needed
a token could not run in `npm test` — it would fail red on a fork, and on any
clone without one — so only the offline half blocks a pull request. The online
half never blocks anything: it reopens a standing issue describing the drift,
and closes that issue once the two agree again.

**To change a label**, edit `labels.json` and this document together — `npm test`
fails if you change only one — then run the **Label drift** workflow with
*apply* checked to push the change to GitHub. Editing a label in the GitHub web
UI instead is not forbidden, but it is not durable: the next scheduled run
raises it as drift, and the next apply overwrites it.

One thing apply cannot do is remove a label that exists on GitHub but not in the
manifest, because deleting a label strips it off every issue carrying it. Those
are reported for a person to resolve deliberately.

You can check by hand at any time:

```
node scripts/check-labels.mjs
```

> **On the count.** [Issue #43](https://github.com/Integral-Productivity/glassfrog-clipper/issues/43),
> which asked for this document, says "six-state vocabulary" in its body and "the
> five states" in its acceptance criteria. The live label set carries **six**
> mutually exclusive states, listed below. Six is what is documented here,
> because six is what exists.

## The two kinds of label

The distinction that governs every assignment:

|  | Cardinality | Answers |
|---|---|---|
| **State** (6 labels) | Exactly one, always | Where does this sit in triage? |
| **Marker** (2 labels) | Zero or more, freely | What else is true about it right now? |

A state is a position in the triage flow, so an issue can only occupy one. A
marker is a fact that can be true of an issue in any state, so it composes.

That is what makes `backlog` and `ready-for-human` incompatible — an issue is
either deliberately deferred or awaiting a human judgment call, not both — while
`status:in-progress` is compatible with either, because "someone is working it"
is not a triage position.

`track:*` labels are a third, separate axis: exactly one per issue, naming which
STRATEGY.md track the work serves. They are orthogonal to both state and marker.

## States — mutually exclusive, exactly one

Every issue carries exactly one. A newly filed issue that has not been triaged
carries `needs-triage`.

| State | Description | Assign it when |
|---|---|---|
| `needs-triage` | Not yet assessed | The issue has just been filed and nobody has read it against the strategy yet. The default on arrival; never a resting place. |
| `needs-info` | Blocked pending information | Triage cannot decide because something is missing from the issue itself — reproduction steps, a decision the filer has to make, a spec. The gap is answerable by a person; name who is being asked, in a comment. |
| `ready-for-agent` | Scoped enough for an agent to pick up | The problem, the acceptance criteria, and the files in play are clear enough that an agent could start without asking a question. If you would have to explain it in chat first, it is not this. |
| `ready-for-human` | Needs a human judgment call | The work is understood, but the next step is a decision — a trade-off, a naming choice, a strategy call — not an implementation. |
| `backlog` | On-strategy, deliberately not now | It fits STRATEGY.md and we intend to do it, but not in the current sequence. This is a decision, not a shelf: an issue nobody has assessed is `needs-triage`, not `backlog`. |
| `wontfix` | This will not be worked on | Off-strategy, superseded, or resolved elsewhere. Close the issue with the reason; the label records why for anyone reading the closed set. |

Movement between states is normal: `needs-triage` → `needs-info` →
`ready-for-agent` is a common path, and `ready-for-agent` → `ready-for-human`
when an implementation turns out to hide a decision. Replace the old state;
never leave two on one issue.

## Markers — orthogonal, any number

Compatible with any state, and with each other.

| Marker | Description | Assign it when |
|---|---|---|
| `status:in-progress` | Actively being worked by a session | A session has claimed the issue and started. This is the claim signal: apply it *before* any code, alongside self-assigning and setting the GitHub Project item to In Progress, and remove it when the work lands or is abandoned. Work in progress is invisible on GitHub until a PR appears, so without this label a second session reads the issue as free and starts it too. |
| `blocked-on-upstream` | Cannot proceed until a fix lands in another repo | The blocker lives in another repository — the `@integral-productivity/glassfrog` SDK, a `devops-excellence` workflow. Distinct from `needs-info`, whose blocker is information a person can supply; this one waits on someone else's merge. Name the upstream issue or PR in a comment. |

## Tracks — one per issue

`track:*` labels map an issue to a track in [STRATEGY.md](../../STRATEGY.md). An
issue that fits no track is a signal to check it against the strategy's
boundaries, not to invent a track.

| Track label | STRATEGY.md track | What it covers |
|---|---|---|
| `track:capture-surface` | Capture surface | The zero-friction path itself: keystroke invocation, page and selection context, and the progressive-disclosure UI that reveals role and work type without demanding them. Browser-first; a mobile share-sheet companion is on-strategy but sequenced later. |
| `track:role-identity` | Role & identity resolution | Authentication to GlassFrog, the practitioner's live role set, and proposing the sensing role and circle at the moment of capture. |
| `track:round-trip` | Round-trip & triage | Getting captured items to where the practice already lives — the deferred-classification queue and its hand-off into GlassFrog. |
| `track:distribution` | Distribution & trust | Install path, browser-permission posture, and eventual open-sourcing to the GlassFrog community. |

## The rest of the label set

GitHub's default labels also live on this repo and are orthogonal to everything
above — they describe the *kind* of issue, not its triage position: `bug`,
`documentation`, `enhancement`, `question`, `duplicate`, `invalid`,
`good first issue`, `help wanted`. Dependabot maintains `dependencies` and
`github_actions` on its own pull requests.

## A triage pass, end to end

For each issue lacking a state:

1. Read the live state before judging the issue — issue text drifts from
   reality. Check for an open PR referencing it, an assignee, and the GitHub
   Project Status before assigning anything.
2. Assign exactly one state from the table above.
3. Assign exactly one `track:*` if the issue is on-strategy and lacks one.
4. Add markers only for what is true right now, and remove ones that no longer
   are.
