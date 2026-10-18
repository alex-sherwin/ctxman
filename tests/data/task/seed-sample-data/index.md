---
okf_version: "0.2"
type: Task
name: seed-sample-data
title: Seed sample data
description: Author the example entries under data/ that the UI, filters and end-to-end tests rely on.
state: complete
tags: [data, docs]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:15:00Z
---

# Seed sample data

## Goal

Ship a realistic seed dataset so every page, filter and test has something to show: all ten datasets populated, every lifecycle state represented, at least one stale entry, and a context that links to many datasets.

## Steps

- [x] Write the `ctxman` knowledge base bundle documenting this tool, with cross-linked concepts.
- [x] Add the `okf-format` and `astro-content-layer` bundles.
- [x] Add two root cause analyses, three ideas, four tasks, three bugs, three features and one project.
- [x] Add two skills, three references (one per type) and two contexts.
- [x] Use `ctxman:<dataset>/<slug>` links between related entries.
- [x] Run the data checks until they report zero errors and zero warnings.

## Done when

`pnpm run check` exits 0 with no warnings, and the end-to-end specs find the entry names they depend on. Names starting with `e2e-` are reserved for tests and are not used here.

Related: the data model is described in [ctxman](ctxman:kb/ctxman); the delivery plan is [ctxman-v1](ctxman:project/ctxman-v1).
