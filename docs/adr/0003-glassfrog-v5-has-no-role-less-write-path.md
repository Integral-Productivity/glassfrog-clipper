# GlassFrog v5 has no role-less write path

Date: 2026-08-28

## Status

Accepted

Amends [GlassFrog authentication and write path for the browser extension](0002-glassfrog-authentication-and-write-path-for-the-browser-extension.md)

## Context

[STRATEGY.md](../../STRATEGY.md) committed to a guiding policy — *"capture never blocks on a decision"* — written before anyone read the GlassFrog v5 write contract. Reading it during the Capture surface brainstorm falsified an assumption the policy rested on.

All three creates are role-scoped in the URL:

```
POST /roles/{role_id}/tensions
POST /roles/{role_id}/actions
POST /roles/{role_id}/projects
```

`role_id` is a path parameter, not an optional body field. Request bodies are almost entirely optional by contrast — `TensionInput.tension.body`, `ActionInput.action_item.description`, and `ProjectInput.project.description` are all optional.

The constraint is therefore the opposite of what the strategy assumed. Filing with no text is fine. Filing with no role is impossible. A capture that asks the practitioner for nothing cannot reach the API at all unless the role is resolved somewhere other than the moment of capture.

This is not an SDK limitation to route around. It reflects Holacracy's own model: a tension is sensed *by a role*. A tension with no sensing role is not an incomplete tension — it is not a tension.

A second consequence surfaced alongside it. The status vocabularies do not overlap: tensions take `unprocessed | processed | archived`, while actions and projects take `archived | cancelled | completed | current | scheduled | someday | waiting`. There is no `unprocessed` for actions or projects, so "capture now, classify later" has a native home for one of the three shapes and not the other two.

Tension status is also not a field a client controls. The v5 schema states that `unprocessed` and `processed` are auto-computed from the presence of associated actions, projects, proposals, or agenda items, and that only `archived` can be set explicitly. A newly filed tension has none of those associations, so it reports as `unprocessed` — the deferred state is a consequence of the tension being new, not something the extension asks for.

## Decision

Resolve the role outside the capture moment, and say so in the strategy rather than letting the policy quietly overstate itself.

1. A capture role is configured once in extension options and used as the `role_id` for any filing that does not name one. The popup may override it per capture.
2. STRATEGY.md's Positioning is amended to read "never blocks on a decision **at capture time** ... **given a capture role configured once in advance**." The commitment is unchanged; its scope is now stated.
3. Captures with no work type file as tensions. The extension does not set `status`; a newly filed tension reports as `unprocessed` because it has no associations yet, and that is the only native deferred state among the three shapes.
4. Actions and projects filed through the structured path take a configurable default status of `current` or `someday`, since neither vocabulary offers a deferred state and which one fits depends on the practitioner's triage rhythm.

## Consequences

- The strategy's resist test — *"resist a change when it puts a decision between sensing and filing"* — remains enforceable, and now has a stated exception rather than an unstated one a future reader would have to rediscover.
- One-time configuration becomes a hard precondition for any capture. An unconfigured extension cannot file at all, which makes the first-run path load-bearing rather than incidental. The recovery behavior is tracked as OQ1 in [docs/plans/2026-08-28-1123-feat-zero-decision-capture-path-plan.md](../plans/2026-08-28-1123-feat-zero-decision-capture-path-plan.md).
- Attribution is systematically wrong for any capture the practitioner does not correct — every quick capture lands on the configured role regardless of which role actually sensed it. This is accepted: it is wrong in a constant, knowable way that triage corrects, rather than the invisible per-capture drift a most-recently-used role would produce.
- The Round-trip & triage track shrinks. GlassFrog's unprocessed-tension queue is the triage surface, so the extension builds none of its own and the "capture into GlassFrog, don't replace it" boundary holds without extra work.
- This rests on the practitioner actually working that queue (assumption A2 in the plan). If that proves false, KD2 and the triage survival metric both need revisiting.
