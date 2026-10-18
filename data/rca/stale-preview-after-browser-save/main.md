---
type: Root Cause Analysis
name: stale-preview-after-browser-save
title: Stale preview after a browser save
description: After saving a markdown file in the browser the dev server reloaded the page about 0.7 s later, but Astro's content layer re-read the file only after about 1 s, so the preview showed the old text; fixed with one guarded extra reload.
tags: [astro, dev-server, content-layer, editing]
generated:
  by: claude-code/ctxman-inflate-v2-docs
  at: 2026-10-18T02:30:00Z
---

# Stale preview after a browser save

Saving a markdown file from the in-browser editor wrote the file at once, but the page that came back after the dev server's reload could still render the OLD text. A second reload about 1.5 seconds later showed the new text. The fix is exactly one extra, guarded reload.

## Summary

* **Impact**: The editor switched back to the preview after a successful save and the preview showed the previous version, which looked like a lost save.
* **Scope**: `astro dev` only, and only for files a glob loader serves (okf `.md` files and `SKILL.md`, and references). A built server has no watcher and keeps its build snapshot by design; context and recipe saves have no dev reload.
* **Resolution**: `src/stores/doc-editor.ts` schedules ONE more `location.reload()` 1.5 s after the first post-save reload, remembering the save across it.

## Timeline

1. The DocEditor was built with an explicit Save: `PUT /api/doc/...` writes the file atomically, then the editor returns to the preview.
2. About 0.7 s after the write the dev server sent its full-reload message, as it does for any change a glob loader sees (see [astro-dev-full-reload-on-save](ctxman:rca/astro-dev-full-reload-on-save)).
3. The reloaded page was rendered from the content layer, which had not re-read the file yet: it did so about 1 s after the write. The preview showed the old markdown.
4. Any reload after the content layer had caught up showed the new text, which pointed at timing rather than at the save.
5. The editor now reloads once more, guarded so it can never loop.

## Root cause

Two timers race. The browser reload fires about 0.7 s after the write; Astro's content layer picks the change up and re-renders about 1 s after it. For a window of roughly 0.3 s the server answers a request with the previous content, and the reload lands inside it. Nothing in the save path can close the window: the reload is sent by the dev server itself, and the editor cannot tell when the content layer is done.

## Resolution

* The remembered "Saved" record (`sessionStorage`, `src/ui/edit/last-save.ts`) carries a `reloads` counter. The page that consumes a record with `reloads` below the limit schedules exactly one more `location.reload()` (`SETTLE_RELOAD_MS`, 1.5 s) and writes the record again with `reloads + 1` just before reloading, so "Saved" stays visible across it and a further reload is never scheduled, whatever reloads the page.
* Under `pnpm start` there is no watcher, so the existing 2 s fallback reload runs first and the extra one follows it; the page then still shows the build snapshot, as documented in [runtime modes](ctxman:kb/ctxman).
* The preview is dimmed (`data-stale`) from the save until the page reloads, so a stale preview is never presented as current.

## Prevention

* Any editor that saves a file served by a watching loader must tolerate the dev reload and the content-layer lag: no state that matters may live only in the page, and the post-save view must not claim to show the new content before the reload settles.
* The end-to-end suite waits for the reloaded page (the doc spec's `expectPreviewShows`) instead of asserting immediately after Save.
* Datasets the UI writes at runtime and reads back at once should follow the watcher-less loader pattern instead (contexts and recipes), which avoids both the reload and the lag.
