---
title: A maintained replacement can be the wrong instrument
date: 2026-09-03
category: best-practices
module: dependency-selection
problem_type: best_practice
component: supply_chain
severity: high
applies_when:
  - A dependency turns out to be archived or unmaintained and a replacement is being chosen
  - The obvious replacement is the one with recent commits
  - The dependency implements a legal, contractual or compliance instrument rather than a technical one
  - An allowlist, policy or ADR frames the decision as a supply-chain question
symptoms:
  - The only actively-maintained option in a category is a near-neighbour of what you have, not an equivalent
  - The comparison is being made on stars, last-commit date and archive status
  - Nobody has restated what the dependency is *for* in the current discussion
tags:
  - dependencies
  - supply-chain
  - licensing
  - cla
  - dco
  - evaluation
---

# A maintained replacement can be the wrong instrument

## Context

`contributor-assistant/github-action`, the action behind `.github/workflows/cla.yml`,
turned out to be **archived** — the maintainer cited bandwidth, invited forks, and
noted that existing releases still work. That is a normal prompt to go shopping for
a maintained replacement.

Surveying the category found something unusual: it is dormant end to end. The hosted
CLA Assistant had not been pushed to since 2024-06. `colineberhardt/cla-bot` stopped
in 2023-06. EasyCLA is alive but presupposes Linux Foundation project hosting. Every
fork of the archived action had zero stars — several organisations had each forked it
privately, and no community successor emerged.

Exactly one option in the space was **actively maintained**: `dcoapp/app`, 342 stars,
pushed within days. On every axis a dependency review normally uses — maintenance,
adoption, recency — it was the clear winner.

It was also the one option that would have destroyed the thing the dependency exists
to protect.

## The trap

A CLA and a DCO look interchangeable. Both gate a pull request on the contributor
agreeing to something. Both are implemented as a bot that comments and sets a status.
Substituting one for the other is a small diff.

They are different legal instruments:

- A **Developer Certificate of Origin** certifies *"I have the right to submit this
  under the project's existing licence."* It is an assertion about provenance.
- A **Contributor Licence Agreement** grants the project a licence to the contribution
  — in this repository's case, broad enough that one party can relicense the whole
  work.

`CLA.md` and `cla.yml` both state the purpose plainly: the agreement is what keeps
Integral Productivity able to license this work commercially as well as under the GPL,
and *"that option survives only while one party can license the whole work."* The
GPL-3.0 + CLA structure is instrumental to a dual-licence position.

DCO grants no relicensing right. Adopting it would have left the gate green, the
workflow maintained, the supply chain healthier — and the commercial optionality
quietly gone. Nothing would have failed. The loss would surface years later, in a
licensing conversation, as an inability to grant what had been assumed grantable.

## The rule

**When replacing a dependency, re-derive what it is for before comparing candidates
on health.** Maintenance status ranks candidates *within* a set of valid options; it
cannot be used to choose the set. For a dependency implementing a legal, contractual
or compliance instrument, "does the replacement do the same thing" is a question about
the instrument, not about the code.

The failure mode is specific and worth naming: an archived dependency reframes the
decision as a **supply-chain** question, because that is the language the archive
notice, the allowlist policy and the ADRs are all written in. Supply-chain framing
optimises for maintenance and provenance. It is silent on whether the replacement
does the same job, so the strongest supply-chain answer can be the weakest answer to
the actual question — and it arrives wearing all the signals of a good decision.

## What this implied here

The category having no maintained option changed the question from *which tool* to
*who maintains it*: allowlist the archived action, fork it into the organisation, or
hand-roll the check. All three keep the instrument correct. None of them is DCO.

Worth carrying separately: an archived dependency is a real cost even when keeping it
is right. [ADR-012](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-012-actions-allow-list-policy.md)
sets the org allowlist explicitly to bound supply-chain exposure, and an archived
action never receives a security patch. Pinning by SHA reduces that to "an unpatched
flaw in frozen code" rather than "a hostile update pushed under you", which is a
meaningful reduction but not elimination.

## See also

- [A gate that fails green is the one you will not find](a-gate-that-fails-green-is-the-one-you-will-not-find.md)
  — the same repository, the same week, the same shape: the failure that costs most is
  the one that leaves no artifact.
