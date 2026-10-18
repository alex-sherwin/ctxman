---
type: Project
name: ctxman-v1
title: ctxman v1
description: Deliver the first complete version of ctxman with ten datasets, search, context forge, tools runner, checks and tests.
state: in-progress
tags: [ctxman, roadmap]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T12:05:00Z
---

# ctxman v1

## Goals

* A local Astro app that stores knowledge, work items, skills, references and contexts in plain files and renders them as navigable pages.
* A context forge that makes it quick to assemble contexts out of those entries.
* Self-checks that keep every dataset compliant with the content collection schemas and with OKF, and every bundle link valid.
* Tests at two levels: vitest for logic and playwright for the full UI.

## Scope

In scope for v1:

* The ten datasets and their pages: [kb](ctxman:kb/ctxman) is the reference documentation for them.
* Features: [global-search](ctxman:feature/global-search), [context-forge](ctxman:feature/context-forge), [tools-runner](ctxman:feature/tools-runner).
* Documentation for agents: [write-agents-md](ctxman:task/write-agents-md).
* Test coverage for the forge: [forge-e2e-coverage](ctxman:task/forge-e2e-coverage).

Out of scope for v1:

* [context-inflate](ctxman:idea/context-inflate): planned after v1, since built as Context Inflate (`/inflate`, `recipe` dataset).
* [okf-graph-view](ctxman:idea/okf-graph-view): abandoned.
* A Windows smoke test ([windows-smoke-test](ctxman:task/windows-smoke-test)): will not do.

## Milestones

Ordered milestones with their status are in [Milestones](/concepts/milestones.md). Summary: foundation and checks, server layer and search, pages and islands, tests and agent docs.

## Related

* Open defects: [forge-reorder-focus](ctxman:bug/forge-reorder-focus) (in progress) and [stale-badge-timezone](ctxman:bug/stale-badge-timezone) (pending).
* Sample data: [seed-sample-data](ctxman:task/seed-sample-data) (complete).
* Under consideration: [git-based-freshness](ctxman:idea/git-based-freshness).
* A context for working on this project: [ctxman-dev](ctxman:context/ctxman-dev).
