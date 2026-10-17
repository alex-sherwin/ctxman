---
type: Concept
title: Glob loader
description: Options, id generation and path rules of Astro's glob loader as used by ctxman.
tags: [astro, loaders]
status: draft
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:35:00Z
---

# Glob loader

`glob` from `astro/loaders` loads one entry per file matching a pattern. This concept is a draft: it records what ctxman depends on and has not been reviewed against newer Astro releases.

## Options

| Option | Notes |
| --- | --- |
| `pattern` | A string or array of globs. Must not start with `/` or `../`. |
| `base` | Directory the pattern is relative to. Pass a `file:` URL so Windows paths such as `C:\data` are not parsed as URL schemes. |
| `generateId` | Receives `{ entry, base, data }`, where `entry` is the posix path relative to `base`. Returns the entry id. |
| `retainBody` | Defaults to true; keeps the raw markdown body on `entry.body`. |
| `deferRender` | Postpones rendering. ctxman leaves it off. |

## Ids in ctxman

The default id is derived from the file path or frontmatter slug. ctxman overrides it so the id always equals the dataset entry name:

* OKF and skill datasets use the first path segment (the bundle folder).
* Reference files use the file stem.
* The `docs` collection uses the whole path without `.md`.

## Behaviour to know

* In `astro dev` the loader watches its base directory and reloads entries on add, change and unlink; each reload triggers a browser full reload. This is why `context` has its own loader.
* In a built server the entries are a snapshot.
* A custom loader that calls `store.set` must pass `filePath` relative to the site root; an absolute path throws.

Parent entry: [Astro content layer](/main.md).
