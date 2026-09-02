# Contributing to glassfrog-clipper

Capture the page you're on into GlassFrog, without losing your train of
thought. If you use GlassFrog and something here gets in your way, a bug report
is as welcome as a patch.

## Licensing, up front

This project is **GPL-3.0-or-later**, with an
[App Store exception](LICENSE-EXCEPTION.md) so it can ship through Apple's
store without contradicting itself.

Contributions require a [Contributor Licence Agreement](CLA.md). The short
version: your contribution stays free software, and Integral Productivity LLC
keeps the ability to also license the work commercially. The CLA explains why
in its opening paragraphs — please read them rather than just signing.

A bot will prompt you on your first pull request. It takes one comment, once.

If the CLA is a dealbreaker for you, say so in an issue. A bug report or a
reproduction case needs no agreement at all, and that is often the more useful
contribution anyway.

## Getting set up

```bash
nvm use
npm ci
npm test
```

> **Note.** `npm ci` currently requires a `NODE_AUTH_TOKEN` authorised for the
> `Integral-Productivity` GitHub Packages registry, because
> `@integral-productivity/glassfrog` is not yet published publicly. This is a
> known barrier for external contributors and is tracked in
> [#2](../../issues/2) and
> [ADR 0005](docs/adr/0005-the-open-source-path-runs-through-a-public-sdk.md).
> Publishing the SDK is the next gate. Until it lands, expect `npm ci` to fail
> with a 401 — that is this project's problem, not yours.

## The loop

| Command | What it does |
|---|---|
| `npm test` | Unit tests (`node:test`) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run build` | Bundle into `dist/` |
| `npm run dev` | Rebuild on change |

Load `dist/` as an unpacked extension to try it. See
[docs/verifying-in-chrome.md](docs/verifying-in-chrome.md) for the manual
checks — the ones that matter most here are the ones Node cannot reach, and
[the verification record](docs/plans/2026-08-28-capture-path-verification-record.md)
explains why.

## What we look for

- **Tests before implementation.** The suite is the specification.
- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `chore(scope):`.
- **One commit per pull request, where that is natural.** Not a gate — a
  genuinely multi-commit change is fine. The reason is narrow and worth knowing:
  this repository publishes line-level AI-authorship notes, and those notes
  record line ranges tied to a single commit's diff. Squash-merging a one-commit
  pull request produces a byte-identical diff, so the attribution can be carried
  onto `main` intact; squashing several commits collapses the intermediate
  states and the ranges no longer describe anything real. A multi-commit pull
  request therefore lands without attribution rather than with wrong
  attribution. See [ADR 9](docs/adr/0009-ai-authorship-survives-a-squash-only-where-the-diff-is-unchanged.md).
- **Architectural decisions get an ADR.** See [docs/adr/](docs/adr/). If you
  find yourself explaining *why* a change is shaped the way it is, that
  explanation belongs in an ADR rather than a commit message.
- **No secrets, ever — including realistic-looking fake ones.** Test fixtures
  must be obviously fake. A plausible-looking key trips secret scanners and
  wastes everybody's afternoon.

## Reporting a security issue

Do not open a public issue. Email
[kraigparkinson@integralproductivity.com](mailto:kraigparkinson@integralproductivity.com).

The extension holds a GlassFrog API key in extension storage and has broad host
permissions, so anything touching key handling, storage, or the capture path is
worth reporting privately first.
