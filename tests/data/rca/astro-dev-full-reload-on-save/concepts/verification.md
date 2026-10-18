---
type: Evidence
title: Verification
description: How the reload cause was confirmed and how the fix was measured.
tags: [astro, measurement]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:45:00Z
---

# Verification

Measured with Astro 7.4.0 on Node 24, by counting full-page reloads in a connected browser after a file write.

| Write | Loader serving the folder | Full reloads observed |
| --- | --- | --- |
| `data/kb/<name>/index.md` | glob, watching | 1, roughly 0.7 s after the write |
| `data/context/<name>.yaml` | custom, no watcher | 0 |

Additional observations:

* The first browser connection after `astro dev` starts gets one extra reload shortly after load. The end-to-end global setup absorbs it by warming the page before tests begin.
* Pre-bundling client dependencies with `vite.optimizeDeps.include` avoids "new dependency" reloads in the middle of a session.
* In a built server, a context file created after the build was invisible to `getCollection`, which confirms the filesystem read path is required.

Return to the [analysis](/index.md).
