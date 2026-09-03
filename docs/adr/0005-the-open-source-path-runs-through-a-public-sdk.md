# The open-source path runs through a public SDK, not a vendored fork

Date: 2026-08-31

## Status

Accepted

Resolves the open question left by
[GlassFrog authentication and write path for the browser extension](0002-glassfrog-authentication-and-write-path-for-the-browser-extension.md),
whose consequences recorded the collision and explicitly did not decide it.

Amends the mechanism chosen in
[glassfrog-mcp-server ADR 0004, decision 3](https://github.com/Integral-Productivity/glassfrog-mcp-server/blob/main/docs/adr/0004-cutover-to-glassfrog-api-v5-via-shared-sdk.md),
which reads "published to GitHub Packages under the org's private scope".

## Context

ADR 0002 chose to bundle `@integral-productivity/glassfrog` and named the
consequence: the SDK resolves from GitHub Packages, so contributors need a
`NODE_AUTH_TOKEN` that is SAML-SSO-authorized for `Integral-Productivity` just
to run `npm install`. STRATEGY.md's **Distribution & trust** track names
open-sourcing to the GlassFrog community. A repository whose build requires an
authenticated token against a private registry is not meaningfully open source.
Installed users are unaffected — the SDK is bundled at build time — but
contributors are blocked outright.

Four facts, all established after that ADR was written, shape the answer.

**The registry is the third gate, not the only one.** This repository is
private and carries no `LICENSE` file and no `license` field in `package.json`.
`glassfrog-sdk-ts` is private and declares `"license": "UNLICENSED"`. Opening
the source needs all three: the repository made public, a licence chosen here,
and the dependency made publicly resolvable — plus a licence chosen for the SDK
if the third is answered by publishing it. Issue #2 framed the registry as the
blocker. It is the most expensive gate and the furthest downstream, and it is
the only one that cannot be paid inside this repository.

**Package-level access has already solved the half of this that hurt.**
Granting the package read access to a consuming repository makes CI's ambient
`GITHUB_TOKEN` sufficient, verified on this repository including on a Dependabot
pull request. That supersedes the two-secret-store workaround in
[glassfrog-mcp-server ADR 0005](https://github.com/Integral-Productivity/glassfrog-mcp-server/blob/main/docs/adr/0005-dependabot-ci-needs-github-packages-token.md)
as the preferred lever inside the org. It does nothing for a local `npm
install`, which still 401s without a personal token — and the local install is
precisely the external contributor's first command. The remaining pain is
therefore entirely external-facing.

**The anti-fork decision cuts both ways.** The decision establishing one
canonical client is `glassfrog-mcp-server` ADR 0004, decision 3, not a
`glassfrog-sdk-ts` ADR — that repository holds only ADRs 0001 and 0002. Its
rationale is drift: a second consumer was about to upgrade to v5 independently,
which "would have doubled the maintenance burden and risked drift between two
implementations of the same API." Its mechanism is the org's private scope.
Vendoring contradicts the rationale; publishing publicly amends the mechanism.
Both are deliberate overrides of the same ADR, and neither can be done
incidentally.

**The coupling is six calls behind a port.** `src/glassfrog.ts` uses the
`GlassFrogClient` constructor, three `createForRole` writes, `me.get`, and
`me.listRoles`, and nothing above it knows GlassFrog's method names — the
`CaptureWriter` port sees to that. The adapter already hand-writes workarounds
for two open SDK defects
([#170](https://github.com/Integral-Productivity/glassfrog-sdk-ts/issues/170),
fetch stored unbound, which breaks every browser consumer; and
[#172](https://github.com/Integral-Productivity/glassfrog-sdk-ts/issues/172),
`me.get()` not unwrapping the `data` envelope), and runs `maxRetries: 0`. The
SDK's residual value at this call site is base URL, the `X-Auth-Token` header,
RFC 9457 error mapping, one paginated read, and Zod ID validation. Vendoring is
therefore cheaper than issue #2 assumed — and the port makes any of these
options a one-file change, which is why none of them needs to be paid for
early.

**Nobody is blocked today.** There is no external contributor and there cannot
be one while this repository is private. The registry wall is the last thing a
contributor hits, not the first.

## Options considered

**A. Publish `@integral-productivity/glassfrog` to the public npm registry.**
Keeps one canonical client. The SDK is a generated client for GlassFrog's own
public v5 API — 84 files, no Integral-Productivity domain logic, no
credentials, no org-specific data model — so what is published is knowledge of
a third party's documented surface. Costs a licence decision on the SDK, a
change to its changesets release pipeline, and the amendment to mcp-server
ADR 0004 recorded above.

**B. Vendor the six-call subset into `src/glassfrog.ts`.** Removes the
dependency outright and would let #170 and #172 be fixed here today. Forks the
canonical client for its third consumer, which is the exact drift mcp-server
ADR 0004 decision 3 exists to prevent, and stops this repository absorbing v5
API changes through a version bump.

**C. Accept the private registry and drop open-sourcing from the track.**
Honest about the constraint. Trades a named strategy commitment for a solvable
packaging problem, and the track's other halves — install path and browser
permission posture — would survive intact and unhelped.

**D. Vendor now, re-consume the SDK once it is published.** Unblocks
contributors soonest at the cost of a window of deliberate drift, and of the
risk that the temporary fork becomes the permanent one.

## Decision

Adopt **Option A**, sequenced: the direction is settled now; the work fires
when this repository goes public.

Option B and Option D are rejected on drift. The extension is the third
consumer of this client, and a fork maintained against a v5 API still in Beta
is a standing divergence, not a one-time copy. The cheapness of vendoring is
real but it is cheapness at the wrong layer — the port already makes the
dependency a one-file concern, so vendoring buys isolation this codebase
already has.

Option C is rejected as disproportionate. Open-sourcing is a named commitment
in a named track, and the thing standing in its way is a packaging decision
about a client for someone else's public API. Retiring a strategy commitment
is the correct response to learning the commitment was wrong, not to learning
it requires a week of work in a sibling repository.

Sequencing is part of the decision rather than a hedge attached to it. Every
gate above the registry is unpaid — this repository is private and unlicensed —
so publishing the SDK today would unblock a population of zero, while the
direction being unrecorded is what leaves the question to be re-litigated each
time it surfaces. Recording the direction costs nothing and closes issue #2;
paying for it early costs a licence decision and a pipeline change in a repo
with three consumers, and buys nothing until #36 lands.

**Trigger.** When this repository is made public (#36), publishing the SDK
(`glassfrog-sdk-ts`#173) becomes due, because at that point a contributor who
can clone the repository will hit the registry wall on their first command.

**Prerequisites.** `glassfrog-sdk-ts`#170 and #172 must land before the SDK is
published publicly. #170 means the SDK fails in every browser it is used from;
shipping that as the org's first public artifact to the GlassFrog community
would be a poor introduction, and this extension is the proof that a browser
consumer hits it immediately.

## Consequences

- STRATEGY.md is unchanged. The **Distribution & trust** track keeps
  open-sourcing; this ADR affirms the commitment and names its path rather than
  altering the track. Had Option C been taken, the track text would have had to
  change here.
- This repository keeps its `@integral-productivity/glassfrog` dependency and
  its `.npmrc` GitHub Packages entry. Nothing about the build changes today.
- Contributors remain blocked on a local `npm install` until #36 and
  `glassfrog-sdk-ts`#173 both land. CI is unaffected — the package-level access
  grant covers it, including Dependabot runs.
- Two gates open inside this repository before the trigger fires: making the
  repository public and choosing a licence, both tracked in #36.
- The two local SDK workarounds in `src/glassfrog.ts` become removable once
  `glassfrog-sdk-ts`#170 and #172 land. Tracked in #37, which is deliberately
  marked blocked — removing them against an unfixed SDK reintroduces a failure
  that only reproduces in a browser.
- `glassfrog-mcp-server` ADR 0004 decision 3 will need amending when #173 is
  executed, since publishing publicly changes the "private scope" mechanism it
  records. Tracked as scope within `glassfrog-sdk-ts`#173.
- If the SDK is ever published under a licence this repository cannot accept,
  or GlassFrog's v5 terms come to prohibit redistributing a generated client,
  this decision reopens and Option B becomes the fallback. The port means that
  reversal is a one-file change.

### Verification limit

The package-level access grant described above was verified by the session that
made it, not re-verified here: reading
`GET /orgs/Integral-Productivity/packages/npm/glassfrog` needs a token with
`read:packages`, which this session's `gh` credential lacks. Every other fact in
this ADR was read from live state — repository visibility, licence fields, the
ADR inventories of both sibling repositories, and the SDK call sites in
`src/glassfrog.ts`.
