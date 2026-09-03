# 16. A verified publisher is bought with a public address

Date: 2026-09-02

## Status

Accepted, and amended by ADR
[0017](0017-the-publisher-is-owned-by-an-identity-not-a-mailbox.md) on
2026-09-03. The trader decision below stands unchanged. Two supporting facts do
not: "an account gets one publisher, for the life of the account" was the
retired *group publisher* quota and does not apply to the members-and-roles
model this ADR records replacing it, and the owning account need not be a
licensed Workspace mailbox. Both are corrected in 0017; the text here is left as
written, because what was believed when the decision was made is the record.

**Met in practice on 2026-09-03, at the second attempt.** The first pass came
back approved against an *individual* rather than Integral Productivity LLC —
the verified *organization* publisher name this ADR spends a public address to
buy is not something an individual verification obtains. The cause sat several
steps upstream of the trader form, which is why nothing in that form could have
caught it: trader entity is inherited from the Google payments profile, whose
Individual or Business type is fixed at creation. A new Business profile, a
trader → non-trader → trader cycle to restart verification, and a D-U-N-S check
against the Dun & Bradstreet record produced the approval this ADR asked for.
The mechanism is written up in
[`docs/store/chrome-web-store-listing.md`](../store/chrome-web-store-listing.md#the-entity-is-decided-by-the-payments-profile-not-by-the-trader-form),
because it is the part worth knowing next time.

Numbered 16 rather than 15: `0015` is claimed by [#150](../../pull/150), still
open while this was written. `0014` landed on `main` during the same session
that wrote this, which is the drift ADR
[0013](0013-an-adr-number-is-defended-at-three-points-not-one.md) exists to
catch — the number here was taken from `git ls-tree origin/main`, not from the
working tree.

Decides the identity half of [#105](../../issues/105). Depends on
[#164](../../issues/164) for the mailbox that will hold it. Relates to
[#72](../../issues/72) and [#107](../../issues/107), which gate the same
submission on the repository being public, and to ADR
[0005](0005-the-open-source-path-runs-through-a-public-sdk.md), whose licensing
posture is what makes us a trader at all.

## Context

Publishing to the Chrome Web Store requires a developer account. The tracking
issue treated this as a $5 errand with a display name attached. Reading Google's
current rules rather than remembering them turned up four facts that make it a
decision instead.

**A developer account's email address is permanent.** Google's registration
guidance states it cannot be changed after the account exists. Whoever the
account is has already been decided the moment it is created.

**An account gets one publisher, for the life of the account.** Deleting a
publisher does not restore the quota. There is no second attempt at the name or
at the entity standing behind it.

**Group publishing no longer exists.** It was the mechanism we would have
reached for to avoid a single-owner account. It has been replaced by adding
*members* to one publisher with roles — viewer, item manager, editor, admin —
who join free and do not repeat registration.

**The trader declaration is mandatory, and it is where the real cost sits.** The
EU Digital Services Act requires every developer to declare trader or
non-trader. It is an account-level setting and nothing in the item submission
flow prompts for it. Declaring trader means Google collects and then *publishes,
at the foot of the item listing*: legal name, physical address, phone number,
and contact email. The phone must receive SMS.

The fourth fact interacts with the first three. A verified publisher name — and
a publisher page — are available only to an **organization that has completed
trader verification**. The unverified alternative is free text with nothing
standing behind it.

That is the whole tension. This listing's pitch is trustworthiness: no backend,
one host, five permissions, a build that fails if the permission list widens.
The publisher line is the one claim on the page that the extension's own code
cannot substantiate. Verification is what substantiates it, and verification is
sold at a fixed price: a public address and a public phone number.

Declaring non-trader would avoid that price. It is not available to us honestly.
Commercial licensing is the plan — ADR
[0005](0005-the-open-source-path-runs-through-a-public-sdk.md) and the README's
licence section both turn on it — which makes us a person "acting for purposes
relating to his trade, business, craft or profession," which is the definition.
Declaring non-trader would also tell EU users that standard consumer-protection
rights do not apply to their dealings with us, which is a worse thing to say on
a trust-first listing than an address is.

## Decision

**Register as an organization, declare trader, and complete verification. Buy
the verified publisher name with a business address and a Google Voice number.**

Concretely:

| | |
|---|---|
| Owning account | A dedicated Workspace mailbox on `integralproductivity.com`, not a person's and not a personal Gmail |
| Publisher display name | `Integral Productivity` |
| Trader declaration | Trader, with organization verification |
| Published contact | Business address, and a Google Voice number for the SMS requirement |
| Durable access | Kraig as an **Admin** member of the publisher |

Two of these follow from constraints rather than taste. Because the account
email is permanent, the owner is a **role**, not a person — any personal mailbox
welds a one-per-lifetime publisher to one human's inbox forever. Because group
publishing is gone, durable access is a **membership row with a role**, which is
also the honest answer to the tracking issue's "record which account owns it
somewhere durable": the dashboard records it, rather than a person remembering.

The free-text display name and the verified trader name will differ —
`Integral Productivity` against `Integral Productivity LLC`. This is expected,
not a misconfiguration, and is written down because it looks like one.

## Consequences

**The company's address and phone become permanently public**, on a page anyone
including scrapers can read, for as long as the extension is listed. Google's
own guidance is to use an address you are comfortable sharing publicly. A
business address and a Google Voice number keep a home address and a personal
mobile off that page while satisfying the requirement; Google's trader FAQ names
Google Voice as acceptable for the SMS check. This is the cost, and it is paid
once for all future extensions under the publisher, not per listing.

**The trader step will not prompt for itself.** It is account-level and absent
from the item submission flow, so it can be missed all the way to review. It is
therefore a line on the submission checklist in
[`docs/store/chrome-web-store-listing.md`](../store/chrome-web-store-listing.md),
not a thing to remember.

**A wrong account cannot be undone.** Every downstream step — the fee, the
publisher name, the verification — is cheap to redo *if* the account is right
and unrecoverable if it is not. This is why [#164](../../issues/164) exists as a
separate blocking issue rather than as step one of a longer errand: the ordering
is the safeguard.

**The Apple side is not covered by this.** [#63](../../issues/63) sets up an
Apple Developer team for the Safari build that ADR
[0008](0008-the-apple-build-shares-this-repo-and-this-capture-path.md) put in
this repository. Apple's identity, fee, and disclosure rules are its own; nothing
decided here transfers, and assuming it does is the error to avoid.

**Two things remain unverified**, and are recorded as unverified rather than
guessed: what happens to a live item if trader verification is begun and never
completed, and whether a registered-agent address is accepted in place of a
business one. Google's public documentation answers neither. Both are read off
the dashboard at verification time and recorded on
[#105](../../issues/105); neither blocks registration, so neither is a reason to
wait.

## The rule this generalises to

**Before paying for something, find out what it commits you to.** The $5 was
never the cost of this decision. The cost was a permanent email address, a
one-per-lifetime publisher, and a public postal address — none of which appeared
in the issue that had been open for a week describing the work as a fee and a
display name.

The generalisation is not "research more." It is narrower and more testable: for
any step that creates an *account or identity in someone else's system*,
establish which of its fields are immutable and which are published, before
creating it. Those two questions have answers in vendor documentation, they are
cheap to look up, and they are the two that cannot be corrected afterwards.
