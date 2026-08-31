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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions need a
[Contributor Licence Agreement](CLA.md); a bot prompts you on your first pull
request. Bug reports need no agreement at all.

Note that `npm install` currently requires a token authorized for the
`Integral-Productivity` GitHub Packages registry, which is a real barrier for
outside contributors. Publishing the SDK publicly is the next gate — see
[ADR 0005](docs/adr/0005-the-open-source-path-runs-through-a-public-sdk.md) and
[#2](../../issues/2).

## Licence

[GPL-3.0-or-later](LICENSE), with an
[additional permission under section 7](LICENSE-EXCEPTION.md) allowing
distribution through app stores whose terms would otherwise conflict with the
GPL — provided the unrestricted source stays available. That exception exists so
a Safari build can reach Apple's App Store without handing users a licence the
channel contradicts.

Copyright © Integral Productivity LLC. Authored by Kraig Parkinson.

Copyleft is a deliberate choice rather than a default. It keeps the extension
free for everyone who wants to use, study, and improve it, while ensuring that
anyone wanting to ship it inside a proprietary product comes and asks. If that
is you, [open an issue](../../issues/new) — commercial licences are available.
