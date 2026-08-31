# GlassFrog Clipper

Clip the page you're on into [GlassFrog](https://app.glassfrog.com) as a tension,
action, or project — without losing your train of thought.

Strategy and boundaries: [STRATEGY.md](STRATEGY.md).
Architecture decisions: [docs/adr/](docs/adr/).
Domain vocabulary: [CONCEPTS.md](CONCEPTS.md) — entities, named processes, and
status concepts with project-specific meaning; relevant when orienting to the
codebase or discussing domain concepts.
Documented solutions: [docs/solutions/](docs/solutions/) — solutions to past
problems (bugs, best practices, workflow patterns), organized by category with
YAML frontmatter (`module`, `tags`, `problem_type`); relevant when implementing
or debugging in documented areas.

## Status

Pre-alpha. The capture path is implemented and under test — a keystroke files
the current page as a tension against a configured capture role, and the popup
exposes the same capture with role, work type, and note editable. Not yet
exercised end-to-end against a live GlassFrog org.

## Develop

Requires Node 22.18+ and an `NODE_AUTH_TOKEN` authorized for the
`Integral-Productivity` org (the `@integral-productivity/glassfrog` SDK resolves
from GitHub Packages — see `.npmrc`). Use **npm**, not pnpm, per
`devops-excellence` ADR-016.

```
npm install
npm run typecheck
npm run build      # → dist/, load unpacked in chrome://extensions
```
