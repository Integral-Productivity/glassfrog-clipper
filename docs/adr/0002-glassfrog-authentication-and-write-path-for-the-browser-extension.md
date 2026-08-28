# 2. GlassFrog authentication and write path for the browser extension

Date: 2026-08-28

## Status

Proposed

## Context

GlassFrog Clipper must authenticate to GlassFrog and write tensions, actions,
and projects from inside a Chrome MV3 extension. Three facts constrain the
choice.

**GlassFrog v5 has no OAuth.** The v5 API authenticates with a long-lived
per-user API key sent as `X-Auth-Token`. The OAuth2 flow in
`glassfrog-mcp-server` is not GlassFrog's — it is an embedded authorization
server that repo had to build itself (its ADR 0002), which ultimately holds and
forwards the user's own v5 key. There is no upstream token-exchange to lean on.

**The org already owns a canonical client.** `@integral-productivity/glassfrog`
(v0.1.0) wraps v5 and owns base URL, auth, pagination, RFC 9457 error mapping,
and Zod ID validation. `glassfrog-mcp-server` and OrgOps both consume it; its
ADR 0004 established it as the one client per API change. Composition over
invention says we consume it too rather than re-deriving types and error
handling in a fourth place.

**STRATEGY.md's guiding policy is latency-sensitive.** "Capture never blocks on
a decision" is measured by `time-to-capture (p50/p95)`, and the resist test
rejects anything that "puts a decision between sensing and filing." Any auth
design that adds a network hop to the capture path spends the exact budget the
product exists to protect.

## Options considered

**A. SDK direct — bundle `@integral-productivity/glassfrog`, store the user's
v5 key in `chrome.storage.local`, call `api.glassfrog.com` from the service
worker under `host_permissions`.** One hop. Reuses the canonical client. The
key lives in the browser profile.

**B. Broker through `glassfrog-mcp-server`.** The extension holds a JWT from
that repo's embedded OAuth2 server instead of a raw key. Better key hygiene;
adds a hosted service as a hard runtime dependency and a second network hop on
every capture.

**C. Raw `fetch` against v5, no SDK.** Smallest bundle, no GitHub Packages
dependency. Re-implements pagination, error mapping, and ID validation the org
already maintains.

## Decision

Adopt **Option A**.

Option B is rejected on the strategy, not on the engineering: putting a hosted
broker between the keystroke and the filed item is a latency cost paid on every
single capture, against a product whose entire diagnosis is that the thought
does not survive delay. Option C is rejected on composition over invention.

## Consequences

- A GlassFrog v5 API key sits in `chrome.storage.local`, readable by anyone with
  device access or the ability to load an unpacked extension. This is a real and
  accepted risk, mitigated by scoping `host_permissions` to
  `https://api.glassfrog.com/*` and never logging the key. Revocation is
  GlassFrog-side and user-driven.
- The extension consumes a GitHub Packages dependency, so `npm` is required
  rather than `pnpm` (`devops-excellence` ADR-016), and contributors need a
  `NODE_AUTH_TOKEN` that is SAML-SSO-authorized for `Integral-Productivity`.
- **This collides with the Distribution & trust track.** STRATEGY.md contemplates
  open-sourcing to the GlassFrog community, and a repository whose build requires
  an authenticated token against a private registry is not meaningfully open
  source. Installed users are unaffected — the SDK is bundled at build time — but
  contributors are blocked. Resolving this means either publishing the SDK
  publicly or vendoring the subset the extension uses. Not decided here.
- Writing goes through the SDK, so a v5 API change is absorbed by an SDK version
  bump rather than by edits in this repo.
