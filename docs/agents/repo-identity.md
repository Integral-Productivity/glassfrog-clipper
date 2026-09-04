# Which repository this is

The slug is **`Integral-Productivity/glassfrog-clipper`**.

This file exists because that fact was, until now, written down only for people.
After [#62](https://github.com/Integral-Productivity/glassfrog-clipper/issues/62)
renamed the repository there were three human-facing places to learn the new
name — the README's migration section, `package.json`, and
[ADR 0008](../adr/0008-the-apple-build-shares-this-repo-and-this-capture-path.md)
— and no agent-directed one. `docs/agents/` is this repository's only
agent-guidance surface, and it held the triage vocabulary and nothing else.

The failure that invites is narrow and cheap to hit: an agent citing a new issue
URL, or scaffolding a new document, with the old slug — reintroducing exactly
what the rename swept out.

## Which way authority runs

[`package.json`](../../package.json)'s `repository.url` is the **source of
truth**. npm reads it, so it has to be right and it has to stay right; every
other copy is downstream of it.

`scripts/repo-slug.ts` is how you read it. `repoSlug()` returns the slug;
`slugFromRepositoryUrl()` does the parsing, handling both the HTTPS form this
repo uses and the SSH form. **Call it rather than writing the slug out** — a
literal in `scripts/` or `test/` is refused by
[`test/repo-identity.test.ts`](../../test/repo-identity.test.ts), which points
the next author here.

## The second copy, and why it is allowed to exist

[`labels.json`](labels.json)'s `repo` field holds the slug a second time. That
is deliberate, not drift.

`scripts/check-labels.mjs` passes it to `gh --repo` from
[`label-drift.yml`](../../.github/workflows/label-drift.yml), a **scheduled**
workflow. A scheduled run has the repository checked out but no reason to parse
`package.json` for a value the manifest can carry directly — and the manifest is
already the source of truth for everything else about labels. Neither copy can
be deleted in favour of the other.

So the two are held together instead:
`test/repo-identity.test.ts` compares `labels.json`'s `repo` against
`repoSlug()`, offline, on every pull request. It needs no token and no network,
which is why it can be always-on — and why it fails on the commit that
introduces the drift rather than whenever someone next happens to look.

That guard is the one #62's rename should have had. There was a third copy at
the time, a hard-coded fallback in `scripts/check-adr-claims.ts` that named the
old repository on the very day it was renamed. Nothing was wrong with the commit
that added it; the copy was simply invisible.

## Where the slug may still be written out

`docs/` is deliberately out of scope for the no-literals rule. Prose cites the
repository by name constantly, and a document recording a rename has to be able
to name both sides of it. This file names it in full, at the top, on purpose.

| Copy | Why it exists | Held by |
|---|---|---|
| `package.json` `repository.url` | npm reads it | It is the anchor |
| `docs/agents/labels.json` `repo` | the scheduled label workflow never parses `package.json` | `test/repo-identity.test.ts` |
| Anything under `docs/` | prose has to name things | Nothing — and that is the decision |
| `scripts/`, `test/` | **must not** — call `repoSlug()` | `test/repo-identity.test.ts` |

## The *old* slug, where it is still correct

A few places name `glassfrog-clipper-chrome-extension` on purpose — pasted
command transcripts, the ADR whose Decision records the rename, the README
section warning the old name is unclaimed, and local clone paths in shell
output. Rewriting any of them would misreport something that actually happened.

They are listed in [`rewrite-exceptions.json`](rewrite-exceptions.json), with a
reason each, and [`test/rewrite-exceptions.test.ts`](../../test/rewrite-exceptions.test.ts)
holds the tree to that list in both directions: a listed exception that gets
swept goes red, and a *new* occurrence has to be classified rather than
inherited. **If you are writing a stale-name guard, read that manifest rather
than starting a second copy of it.**

## To rename this repository again

Change `package.json`'s `repository.url` first, then `labels.json`'s `repo`, then
this file. `npm test` fails until the first two agree. Then run the **Label
drift** workflow with *apply* checked, so GitHub's labels follow the manifest to
the new name — `check-labels.mjs` aborts if `GITHUB_REPOSITORY` disagrees with
the manifest, so a half-done rename cannot reconcile the wrong repository's
labels.
