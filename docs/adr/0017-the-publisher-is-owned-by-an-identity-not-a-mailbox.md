# 17. The publisher is owned by an identity, not a mailbox

Date: 2026-09-03

## Status

Accepted

Amends ADR
[0016](0016-a-verified-publisher-is-bought-with-a-public-address.md), which
stands in full on the trader decision and is corrected here on two points of
fact. Refines the runbooks in [#105](../../issues/105) and
[#164](../../issues/164), and the Publisher identity section of
[`docs/store/chrome-web-store-listing.md`](../store/chrome-web-store-listing.md).

## Context

ADR 0016 decided *who* the publisher is. It also recorded, as settled fact, the
constraints that shaped the choice. Those constraints were re-checked against
Google's own documentation on 2026-09-03, because the next step spends money and
creates an account that cannot be renamed. Two of them did not survive the
re-reading, and one of them was never checked at all.

**"An account gets one publisher, for the life of the account" is retired, not
merely stale.** The quota was real, but it was the *one group publisher, ever*
rule, and it applied to the group-publishing system that ADR 0016 itself records
as removed. Google's archived page states it plainly — "A Chrome Web Store
developer account can only create one group publisher, **ever**" — and the same
page is the one now replaced by the members-and-roles model. Under that model
the developer account *is* the publisher, and Publisher name is an editable
field on the Account page. The two facts cannot both be current: 0016 carried
the constraint from the system whose removal it recorded in the paragraph above
it. The operational effect is that #105 step 5 and the listing dossier both warn
an operator to treat a renameable text field as an irreversible act, which
spends caution in the wrong place.

**"A dedicated Workspace mailbox" is one implementation of the requirement, and
the expensive one.** The requirement Google states is an account that can sign
in. An alias cannot — "email aliases are not Google Accounts, so you can't sign
in with an email alias" — which is why #164 is right to forbid one, and a group
cannot either, now for the stronger reason that the mechanism it would have used
no longer exists. Neither fact implies a *licensed* seat. A **Cloud Identity
Free** user in the same Workspace organization is a real, admin-managed Google
account on `integralproductivity.com`, with its own sign-in and password, and it
costs nothing: the free edition raises the user cap by 50.

What a Cloud Identity Free user does not have is Gmail, and mail to it bounces
by default. That matters here because the account email is where Google sends
the address-verification link and every later publisher notification — the one
thing this account exists to receive. Workspace answers it with a Gmail
**Default routing** rule, which applies before delivery and therefore reaches an
address with no mailbox behind it.

The permanence that drove 0016's reasoning is unchanged and was re-confirmed:
the developer account's email cannot be changed afterwards, and a deleted
account's address can never be reused for a new one. So is the trader position,
including the detail 0016 rested on — Google's trader FAQ does name Google Voice
among acceptable SMS-capable options.

## Decision

**The owning account is a Cloud Identity Free identity with a routing rule, not
a licensed mailbox.** A `chrome-store`-style role address on the company domain
is created as a user in the existing Workspace organization, holding a Cloud
Identity Free licence rather than a Workspace one, with mail for that address
routed to a mailbox a human reads. The address itself is deliberately not
recorded here — see the note on the public record at the end of this ADR.

Four steps carry the decision, and the order of the first two is the whole
saving:

1. Turn **off** automatic licensing before creating the user. Left on, the new
   user silently consumes a paid Workspace seat, which is the cost this decision
   exists to avoid.
2. Add the **Cloud Identity Free** subscription, create the user under it, and
   confirm in Billing which licence it holds. The confirmation is the step; the
   intent is not observable from the user record.
3. Add a Gmail **Default routing** rule for that address. Ordinary forwarding
   and routing settings apply to users with Gmail turned on, so they are not
   available here.
4. Turn **Chrome Web Store** on for that user's organizational unit. It is an
   Additional Google service and an administrator can have it off.

**The saved cost is recurring, not the $5.** A Business Starter seat runs
roughly $7–$9.20 per user per month on an annual plan depending on source and
renewal date — on the order of $85–$110 a year, against $0 — while the
registration fee is $5 once, is unavoidable, and is not what this is about. Read
the live rate off the Billing page rather than this ADR; the point is the order
of magnitude and that it repeats every year.

**Two corrections travel with it.** The publisher display name is an editable
field, so the runbooks stop calling it irreversible; and the genuinely
irreversible facts — the account email, and a deleted account's address — are
stated in its place.

**One alternative is rejected on cost grounds it appears to win.** A free
consumer Gmail account is also $0 and needs no routing rule, but it sits outside
the Admin console: no administrator can reset its password or recover it. That
trades an unrecoverable asset against a saving Cloud Identity Free already
makes, which is not a trade. If an *unassigned but already committed* seat
exists on the annual plan, using it is equally free until renewal and simpler,
because a real mailbox needs neither step 3 nor step 4.

## Consequences

**The mail path becomes a dependency, and it is testable before it is
expensive.** Sending a message to the address from outside and watching it
arrive in the routed mailbox is the whole test, and it can be run before the $5
is paid — so the failure mode surfaces while nothing has been bought. This
ordering is the same safeguard #164 already applies to the account itself: the
irreversible step goes last.

**Google does not document a Gmail-less identity as a publisher owner.** Nothing
found forbids it, and it satisfies every documented requirement — an account
that signs in, and an address that receives mail. When this was written that was
a reasoned position rather than an observed one.

**Half of it is now observed.** On 2026-09-03 the operator built the account this
way — the role address as a Cloud Identity Free user — and all four checks
passed — it signs in independently in a clean profile, mail sent
from outside arrives through the routing rule, Billing reports a Cloud Identity
licence rather than a consumed Workspace seat, and Chrome Web Store is on for its
organizational unit. So the identity half of the reasoning is no longer an
assumption, and the $0 is real rather than projected.

**The other half is observed too.** At [#105](../../issues/105) step 3 the
developer dashboard, signed in as that account in a clean profile, presented the
ordinary registration screen — the developer agreement and the fee. So a Chrome
Web Store developer account can be owned by a Google identity with no mailbox
behind it. Google documents this neither way, which is why the runbook puts that
sign-in *before* the fee: the observation was bought with minutes, and the
fallbacks — the committed spare seat, or a licensed one — stayed available until
it came back.

**The routing rule then carried Google's own mail.** Registration completed on
that account — fee paid, publisher display name `Integral Productivity` set, and
the account-email verification link delivered to the mailbox-less address through
the rule and followed successfully. The mail path is therefore proven under
Google's traffic, not only under a test message sent by hand, which was the one
dependency this decision added.

Access no longer rests on the single password either: Kraig holds **Admin** on
the publisher as a membership row, added free and without a second registration —
the members-and-roles mechanism whose arrival is what retired the constraint this
ADR corrects. The decision is, at this point, entirely observed rather than
argued.

**The identity is admin-recoverable, which the mailbox alternative also was.**
Nothing about the free licence weakens the Admin console's control over the
account: password reset, recovery address, and a second super-administrator all
still apply. This is the property that rules the consumer-Gmail option out, and
it is retained rather than traded away.

**The retired quota leaves the corpus.** ADR 0016 keeps its text — the record of
what was believed when the decision was made is the point of an ADR — and its
Status now names this amendment. The runbooks a human will actually follow are
edited in place, because a comment under a stale instruction is not where an
operator reading step 5 will look.

**A cost decision has been recorded at the point where cost was invisible.** The
$5 is what the tracking issue named, and it is the smaller number by an order of
magnitude. Any future account this project needs on the domain — an agent
identity, a second store — inherits the same question, and the answer is the
same: an identity is free, a mailbox is a subscription.

**A note on the public record.** This repository is public, so what is written
here about the account is read by anyone. The decision, the mechanism and the
cost all belong in the open — they are the reasoning a reader needs. The
*inventory* does not: the exact address, the licence it holds, the unit it sits
in, where its mail lands, and where its password is kept together describe a
single credential-bearing account whose email can never be changed, which is a
phishing target rather than an architectural argument. So this ADR names the
shape and omits the specifics, and
[`fitness/checks/account-disclosure.ts`](../../fitness/checks/account-disclosure.ts)
fails the build if an operational address returns to the tree.

Stated rather than implied: this is a forward-looking control, not an erasure.
The address appears in this branch's earlier commits and in the issues that
tracked the work, both public and both beyond editing away. What the redaction
buys is that the durable record — what `main` carries and what a reader browses —
stops repeating it.
