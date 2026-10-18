---
okf_version: "0.2"
type: Bug
name: stale-badge-timezone
title: Stale badge timezone
description: Suspected off-by-one day in the stale badge and the displayed stale_after date when the local timezone is west of UTC.
state: pending
tags: [dates, ui, freshness]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:40:00Z
---

# Stale badge timezone

## Symptoms

For a user west of UTC, an entry with `stale_after: 2026-10-17` can display "2026-10-16" in its metadata panel, or become stale one calendar day away from the date it names.

## Reproduction

Not yet reproduced. Suggested attempt:

1. Set the system timezone to a negative UTC offset such as America/Los_Angeles.
2. Give a bundle `stale_after` equal to today's date.
3. Open its detail page and the dashboard; compare the displayed date and the badge with today's date.

## Expected vs actual

* **Expected**: the badge appears on the named date in the user's local calendar, and the date is shown exactly as written.
* **Actual (suspected)**: the displayed date can be a day early.

## Diagnosis

Unconfirmed. YAML dates without a time are parsed as midnight UTC, so an unquoted `stale_after` is a `Date` at 00:00Z. Comparing it to "today" is correct only if both sides use the same calendar, and formatting it with a local-time formatter shifts it back a day west of UTC. The stale check compares the local date with the UTC date of the value; any other code path that formats the `Date` locally would disagree. Candidates to inspect: the metadata panel, the stale badge, and the entry summary builder.

## Fix

Not started. Proposed approach: treat `stale_after` as a calendar date string end to end, converting a parsed `Date` with its UTC date parts once, in one shared helper, and add unit tests with the process timezone set to a negative offset.

Related area: [git-based-freshness](ctxman:idea/git-based-freshness).
