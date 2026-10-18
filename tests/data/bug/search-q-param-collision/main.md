---
type: Bug
name: search-q-param-collision
title: Search q parameter collision
description: The global search widget and the list-page text filter both used the q URL parameter, so opening search clobbered the filter.
state: fixed
tags: [search, url-state]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:35:00Z
---

# Search q parameter collision

## Symptoms

On a filtered list page such as `/task?q=agents`, opening the search widget replaced the filter text with the search query. Closing the widget removed `q` from the URL, so the list lost its filter and the next reload showed every row.

## Reproduction

1. Open `/task?q=agents`.
2. Press Cmd/Ctrl+K and type `forge`.
3. Look at the URL: it now reads `?q=forge` with the search modal open.
4. Press Esc twice. The URL has no `q` and the list is unfiltered.

## Expected vs actual

* **Expected**: the list filter and the search query are independent; closing search restores the page exactly as it was.
* **Actual**: both features wrote the same parameter.

## Diagnosis

The first design reused `q` for the search widget because it is the obvious name. The same name was already the text filter on list pages and in the forge. Both features read and wrote it through the shared URL-state helpers, so each saw the other's value.

## Fix

The widget now owns a separate set of parameters: `search=1`, `sq` for the query and `in` for the dataset filter. `q` belongs to list pages and the forge only. A `/search` route remains and redirects to the new parameters. The design is described in [ctxman](ctxman:kb/ctxman), and the feature is [global-search](ctxman:feature/global-search).
