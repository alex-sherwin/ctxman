---
type: Feature
name: inflate-working-dir
title: Inflate into a working directory
description: "Context Inflate v2: a recipe names an output directory and a run places symlinks, copies, clones and installed skills there, with an LLM_CONTEXT.md map and an ownership manifest."
state: complete
tags: [inflate, recipe, working-directory]
generated:
  by: process:ctxman-add-entry
  at: 2026-10-18T05:21:38.229Z
---

# Inflate into a working directory

Context Inflate v2: a recipe names an output directory and a run places symlinks, copies, clones and installed skills there, with an LLM_CONTEXT.md map and an ownership manifest.

## Motivation

Context Inflate v1 produces one markdown document that tells an agent where things are, but the agent still has to start somewhere and fetch every repository and skill itself. A working directory that already holds the knowledge, the skills and the repositories, and that explains itself in one file, removes that step: start the harness in it and go.

## Requirements

* A recipe can set `output.dir` (absolute or `~/`); a run can override it without editing the recipe.
* Per item a material decides what is placed: symlink or copy for knowledge bundles, copy for skills, symlink for local repositories, clone for remote repositories, install for remote skills, or nothing.
* One repository can be the primary; the generated `LLM_CONTEXT.md` leads with it and gives every path relative to the directory.
* Optional `CLAUDE.md` / `AGENTS.md` / `.gitignore` stubs, chosen per target.
* A dry run lists every step and every problem before anything is written; a run reports progress per step and can be cancelled.
* Re-running is idempotent and removes only what ctxman recorded in `.ctxman-inflate.json`; local changes in a clone or an edited stub are never discarded.
* The directory must be outside the repository and the data directory, never a filesystem root or the home directory.

## Design

* Pure planner (`src/lib/inflate/material-plan.ts`) produces the step list; a Node executor (`material-exec.ts`) re-checks every precondition; an in-memory job store (`jobs.ts`) runs one job at a time and the UI polls it every 500 ms.
* Endpoints: `POST /api/inflate/plan`, `POST /api/inflate/run`, `GET /api/inflate/jobs/<id>`, `POST /api/inflate/jobs/<id>/cancel`; the UI is the Run view of `/inflate` (`view=run`).
* System tools do the heavy lifting: `git` for clones, `tar` / `unzip` for archives; nothing is added to the dependencies.
* The complete description is the concept `concepts/context-inflate.md` of the knowledge base [ctxman](ctxman:kb/ctxman); the origin is the idea [context-inflate](ctxman:idea/context-inflate).

## Acceptance criteria

- [x] The seed recipe dry-runs to 15 steps and a run into an empty temporary directory ends `done`.
- [x] A second identical run leaves symlinks, the clone, the context file and the stubs `unchanged`.
- [x] Switching an item to "Mention only" removes its symlink on the next run and leaves the ctxman entry intact.
- [x] A non-empty directory without a manifest is refused unless `allowNonEmpty` is set.
- [x] A cancelled run still writes a valid manifest.
- [x] `pnpm run check` reports no warnings for the new recipe rules (`recipe-output-dir-relative`, `recipe-material-invalid`, `recipe-primary-invalid`).
