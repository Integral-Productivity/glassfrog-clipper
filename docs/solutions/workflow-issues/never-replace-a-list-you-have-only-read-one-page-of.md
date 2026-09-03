---
title: Never replace a list you have only read one page of
date: 2026-09-03
category: workflow-issues
module: api-mutation-safety
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Adding an entry to a list held behind a paginated API
  - The API offers a whole-list PUT and the obvious move is read-modify-write
  - The mutation targets org-level or otherwise shared configuration
symptoms:
  - A read returns a plausible-looking list and nothing indicates it is a page
  - The endpoint's PUT takes the full collection, so the write silently defines what is absent
  - Removal produces no error, no log line, and no failure until some unrelated consumer runs
tags:
  - github-api
  - pagination
  - org-settings
  - destructive-writes
  - read-modify-write
---

# Never replace a list you have only read one page of

## Context

Adding this repository to three organisation secrets
(`OP_AUTOMERGE_PUBLIC_TOKEN`, `OP_LABELER_PUBLIC_TOKEN`, `OP_AUDITOR_PUBLIC_TOKEN`)
began with the obvious read:

```
gh api orgs/Integral-Productivity/actions/secrets/OP_AUTOMERGE_PUBLIC_TOKEN/repositories \
  --jq '.repositories[].full_name'
```

It returned **12 repositories**. A clean, complete-looking list — alphabetical from
`automation-architecture-claude-plugin` to `marketplace-internal`, no ellipsis, no
truncation marker, nothing suggesting more.

The real total was **28**.

`.repositories[]` is one page. The count lives in a sibling field, `.total_count`,
which the jq expression above never touches.

## Why the obvious next step is destructive

The documented way to set a secret's repository list is:

```
PUT /orgs/{org}/actions/secrets/{name}/repositories
{ "selected_repository_ids": [ ... ] }
```

It is a **whole-list replacement**. What is absent from the array is removed. So the
natural read-modify-write — read the list, append one id, PUT it back — would have
written 13 ids over 28 and silently revoked 16 repositories' access to three
organisation secrets.

Nothing would have reported it. The PUT returns success; it did exactly what it was
told. The damage surfaces later and elsewhere, as some unrelated repository's
auto-merge or labeler workflow failing to resolve a secret, with no connection to the
change that caused it. Three secrets multiplies the blast radius; org scope means the
victims are repositories nobody in the session was thinking about.

## The rule

**When adding to a list, prefer an endpoint that adds.** GitHub provides one here:

```
PUT /orgs/{org}/actions/secrets/{name}/repositories/{repository_id}
```

One repository, additive, no knowledge of the rest of the list required, and no way
for it to remove anything. It cannot express the destructive outcome at all — which
is the property worth choosing, more than the brevity.

When no additive endpoint exists and a whole-list write is unavoidable:

1. **Read `total_count` and compare it against the length of what you fetched.** If
   they disagree, you are holding a page, not a list.
2. **Paginate explicitly** (`--paginate`) rather than trusting a first response that
   looks complete.
3. **Read the count back after writing** and assert it moved by exactly the amount
   intended. Here: 28 → 29 on each of the three secrets, checked per secret.

## The general shape

A read that returns a plausible list, and a write that treats absence as deletion.
Neither half is dangerous alone. Together they turn a routine addition into a silent
bulk removal, and pagination is what makes the first half lie convincingly — a
truncated list of 12 real entries looks far more like a complete list than an error
does.

Ask of any list-shaped mutation: **if this list were longer than what I fetched, what
would this write do?** If the answer is "remove the remainder", stop and find the
additive endpoint.

## See also

- [Verify the event, not the artifact that implies it](verify-the-event-not-the-artifact-that-implies-it.md)
  — same discipline applied to reads: confirm the thing itself rather than a proxy that
  usually accompanies it.
