# CLA signature record

This branch holds one thing: `.github/cla-signatures.json`, the record of who
has accepted [`CLA.md`](https://github.com/Integral-Productivity/glassfrog-clipper/blob/main/CLA.md).
It carries no code and is never merged into `main`.

It is an orphan branch on purpose, and it is deliberately **not** `main`.
`contributor-assistant/github-action` records a signature by *pushing* that
file. `main`'s ruleset requires the `verify` check, and the action's push is not
a pull request, so `main` rejects it and nobody can sign. That is not
hypothetical — it is what happened on run #164, the first CLA run in this
repository's history to get far enough to fail for a reason of its own.

See [ADR 0019](https://github.com/Integral-Productivity/glassfrog-clipper/blob/main/docs/adr/0019-the-cla-signature-record-lives-off-the-protected-branch.md)
for the decision and the alternative that was rejected, and
[#179](https://github.com/Integral-Productivity/glassfrog-clipper/issues/179)
for how it was found.

**This branch must stay outside every ruleset.** Protecting it — including by a
pattern that happens to match it — silently stops all signing, because the
failure appears only inside the `cla` check, which nothing requires.
