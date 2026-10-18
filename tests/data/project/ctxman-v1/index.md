---
okf_version: "0.2"
type: Project
name: ctxman-v1
title: ctxman v1
description: Deliver the first complete version of ctxman with ten datasets, search, context forge, tools runner, checks and tests.
state: in-progress
tags: [ctxman, roadmap]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T12:05:00Z
links:
  - dataset: feature
    slug: global-search
    rel: child
  - dataset: feature
    slug: context-forge
    rel: child
  - dataset: feature
    slug: tools-runner
    rel: child
  - dataset: task
    slug: write-agents-md
    rel: child
  - dataset: task
    slug: forge-e2e-coverage
    rel: child
  - dataset: task
    slug: seed-sample-data
    rel: child
  - dataset: task
    slug: windows-smoke-test
    rel: child
  - dataset: bug
    slug: forge-reorder-focus
    rel: child
  - dataset: bug
    slug: stale-badge-timezone
    rel: child
  - dataset: idea
    slug: okf-graph-view
    rel: child
  - dataset: kb
    slug: ctxman
    rel: related
  - dataset: idea
    slug: context-inflate
    rel: related
  - dataset: idea
    slug: git-based-freshness
    rel: related
  - dataset: feature
    slug: inflate-working-dir
    rel: related
  - dataset: feature
    slug: entry-relations
    rel: child
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
* Features: [global-search](ctxman:feature/global-search), [context-forge](ctxman:feature/context-forge), [tools-runner](ctxman:feature/tools-runner), [entry-relations](ctxman:feature/entry-relations).
* Documentation for agents: [write-agents-md](ctxman:task/write-agents-md).
* Test coverage for the forge: [forge-e2e-coverage](ctxman:task/forge-e2e-coverage).

Out of scope for v1:

* [context-inflate](ctxman:idea/context-inflate): planned after v1, since built as Context Inflate (`/inflate`, `recipe` dataset); v2 added working directories ([inflate-working-dir](ctxman:feature/inflate-working-dir)).
* [okf-graph-view](ctxman:idea/okf-graph-view): abandoned.
* A Windows smoke test ([windows-smoke-test](ctxman:task/windows-smoke-test)): will not do.

## Milestones

Ordered milestones with their status are in [Milestones](/concepts/milestones.md). Summary: foundation and checks, server layer and search, pages and islands, tests and agent docs.

## Related

* Open defects: [forge-reorder-focus](ctxman:bug/forge-reorder-focus) and [stale-badge-timezone](ctxman:bug/stale-badge-timezone).
* Sample data: [seed-sample-data](ctxman:task/seed-sample-data).
* Under consideration: [git-based-freshness](ctxman:idea/git-based-freshness).
* A context for working on this project: [ctxman-dev](ctxman:context/ctxman-dev).

## Plan

* [Milestones](/concepts/milestones.md) - The ordered milestones and what each one contains.
