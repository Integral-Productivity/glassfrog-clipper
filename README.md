# GlassFrog Clipper

Clip the page you're on into [GlassFrog](https://app.glassfrog.com) as a tension,
action, or project — without losing your train of thought.

Strategy and boundaries: [STRATEGY.md](STRATEGY.md).
Architecture decisions: [docs/adr/](docs/adr/).

## Status

Pre-alpha. Scaffold only — no working capture path yet.

## Develop

Requires Node 22+ and an `NODE_AUTH_TOKEN` authorized for the
`Integral-Productivity` org (the `@integral-productivity/glassfrog` SDK resolves
from GitHub Packages — see `.npmrc`). Use **npm**, not pnpm, per
`devops-excellence` ADR-016.

```
npm install
npm run typecheck
npm run build      # → dist/, load unpacked in chrome://extensions
```
