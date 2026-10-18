---
okf_version: "0.2"
type: Idea
name: git-based-freshness
title: Git-based freshness
description: Derive an entry's last modified date from git history, falling back to file modification time, so freshness survives clones and copies.
state: in-progress
tags: [freshness, git, dashboard]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:05:00Z
---

# Git-based freshness

## Problem

Freshness is currently the newest file modification time in an entry's folder. That is simple and has no dependency on git, but modification times are reset by a fresh clone, a checkout or a plain copy (the end-to-end tests copy `data/` to a temporary folder). After any of those, "recently modified" ordering and the dashboard carry no information.

## Proposal

Compute last modified as the newest of:

* the latest git commit time touching the entry's path, from `git log -1 --format=%cI -- <path>`, run with `child_process` and no shell so it stays cross-platform; and
* the file modification time of any uncommitted change.

If the data folder is not inside a git repository (for example when `CTXMAN_DATA_DIR` points elsewhere), fall back to modification time exactly as today.

## Open questions

* Cost: one git call per entry is too slow for hundreds of entries. A single `git log --name-only` pass, cached for the process lifetime, might be enough.
* Squashed or rebased history changes dates; is commit time or author time the better signal?
* Should the UI say which source produced the date?
* The architecture currently states "no git dependency" as a deliberate choice; this idea would make git an optional enhancement, not a requirement.

Related: the stale badge uses a separate OKF `stale_after` date and is unaffected. See the bug [stale-badge-timezone](ctxman:bug/stale-badge-timezone) for a date-handling issue in the same area.
