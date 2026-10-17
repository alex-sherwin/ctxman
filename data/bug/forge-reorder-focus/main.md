---
type: Bug
name: forge-reorder-focus
title: Forge reorder focus
description: Keyboard focus is lost after moving or removing a link in the context forge, so repeated reordering needs the mouse.
state: in-progress
tags: [forge, accessibility, keyboard]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:45:00Z
---

# Forge reorder focus

## Symptoms

After pressing "Move up" or "Move down" on a link row with the keyboard, focus falls back to the page body. Pressing the same key again does nothing, so a link cannot be moved several places without tabbing back to it. Removing a link has the same effect.

## Reproduction

1. Open `/forge?context=ctxman-dev`.
2. Tab to the "Move down" button of the first link and press Enter.
3. The row moves, but the focused element is gone.

## Expected vs actual

* **Expected**: after a move, focus stays on the same-direction button of the moved row. If that row reached the end of the list and the button is now disabled, focus goes to the opposite-direction button. After a removal, focus goes to the next row's Remove button, else the previous row's, else the "Links" heading.
* **Actual**: focus is dropped.

## Diagnosis

Rows are keyed by `dataset:slug`, so React preserves each row's DOM nodes when the order changes. But the moved row's buttons are re-rendered and, when one becomes disabled, the browser drops focus. Focus has to be restored explicitly after the state update has been flushed to the DOM.

## Fix

In progress. The approach: wrap the store update in `flushSync`, then focus through a map of callback refs keyed by link, choosing the target button by the rules above. Once merged, the end-to-end spec in [forge-e2e-coverage](ctxman:task/forge-e2e-coverage) should assert the focus behaviour. Feature: [context-forge](ctxman:feature/context-forge).
