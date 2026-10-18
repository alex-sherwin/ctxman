---
type: Task
name: forge-e2e-coverage
title: Forge end-to-end coverage
description: Write Playwright specs that cover creating, editing, reordering, saving and deleting a context in the forge.
state: pending
tags: [testing, forge, e2e]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:25:00Z
links:
  - dataset: feature
    slug: context-forge
    rel: depends-on
---

# Forge end-to-end coverage

## Goal

Cover the context forge workflow end to end so regressions in saving, reordering and notes editing are caught before they reach the user.

## Steps

- [ ] Create a context through the new-context dialog and check the YAML file appears on disk.
- [ ] Add links from two different dataset tabs, using the text filter on one of them.
- [ ] Type notes into the notes editor and check they are stored as a literal block.
- [ ] Open raw YAML mode, make an invalid edit, and check the validation marker blocks saving.
- [ ] Reorder links, save, and check the order on disk; reload the page and check the same links show.
- [ ] Delete the context after confirming, and check the file is gone.
- [ ] Use only temporary data: contexts are named with the reserved `e2e-` prefix and the tests run on a copy of `data/`.

## Done when

The forge spec passes in a clean run of `pnpm run test:e2e` and leaves the real `data/` untouched.

Related: the feature [context-forge](ctxman:feature/context-forge) and the open bug [forge-reorder-focus](ctxman:bug/forge-reorder-focus), whose focus behaviour this spec should assert once fixed.
