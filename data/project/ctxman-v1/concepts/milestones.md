---
type: Plan
title: Milestones
description: The ordered milestones for ctxman v1, what each contains and where it stands.
tags: [roadmap, planning]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T12:10:00Z
---

# Milestones

Each milestone builds on the previous one. Status follows the lifecycle state of the linked entries.

| # | Milestone | Contents | Status |
| --- | --- | --- | --- |
| 1 | Foundation and checks | Registry, schemas, collections; libraries and scripts for adding entries and checking OKF, links and collections; seed data ([seed-sample-data](ctxman:task/seed-sample-data)); UI kit and theme | Complete |
| 2 | Server layer and search | JSON API, script runner, search index; [global-search](ctxman:feature/global-search) | Complete |
| 3 | Pages and islands | Dashboard, list, detail and sub-doc pages; [tools-runner](ctxman:feature/tools-runner); [context-forge](ctxman:feature/context-forge) | In progress (forge) |
| 4 | Tests and agent docs | End-to-end specs ([forge-e2e-coverage](ctxman:task/forge-e2e-coverage)); [write-agents-md](ctxman:task/write-agents-md) | In progress |
| 5 | After v1 | [context-inflate](ctxman:idea/context-inflate), [inflate-working-dir](ctxman:feature/inflate-working-dir) | Done (built as Context Inflate, `/inflate`; v2 inflates into a working directory) |

## Exit criteria for v1

* `pnpm run test:all` passes: typecheck, lint, format check, unit tests, data checks and end-to-end tests.
* The seed data shows every page type with no empty states.
* No open defect marked blocking; currently [forge-reorder-focus](ctxman:bug/forge-reorder-focus) is the one to close.

Parent: [ctxman v1](/main.md).
