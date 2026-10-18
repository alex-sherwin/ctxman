---
okf_version: "0.2"
---
# Stale preview after a browser save

## Entry

* [Stale preview after a browser save](/main.md) - After saving a markdown file in the browser the dev server reloaded the page about 0.7 s later, but Astro's content layer re-read the file only after about 1 s, so the preview showed the old text; fixed with one guarded extra reload.
