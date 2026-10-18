---
okf_version: "0.2"
type: Feature
name: tools-runner
title: Tools runner
description: A page at /tools that runs allowlisted local scripts, such as the checks and the add-entry script, and shows their output.
state: complete
tags: [tools, scripts, ui]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T12:00:00Z
---

# Tools runner

## Motivation

ctxman can run local native processes. Running the checks and creating entries from the browser keeps the whole workflow in one tool, as long as only known scripts can run.

## Requirements

* List the check scripts with a Run button each, and show exit code, duration, stdout and stderr.
* An add-entry form (dataset, name, title, description) that calls the same script as the command line.
* Only allowlisted scripts can run; arguments are validated; no shell is ever used.
* One run at a time; output can be copied or cleared.
* Scripts are cross-platform: TypeScript, `node:fs`, started with `process.execPath`.

## Design

* One React island on `/tools`. The allowlist lives in a shared module that the page and the server both import.
* `POST /api/scripts/<name>` returns `{ code, stdout, stderr, durationMs, created? }` with HTTP 200 even when the exit code is not zero; an unknown script name is 404.
* Because adding a bundle triggers one dev reload, the last run is kept in `sessionStorage` and restored.
* The script behaviour itself is described in [ctxman](ctxman:kb/ctxman).

## Acceptance criteria

- [x] Each check can be run and its exit code shown.
- [x] Creating an entry shows the created path with a link to open it.
- [x] Creating an entry that already exists fails with a clear message and writes nothing.
- [x] Requests from another origin are rejected.

Related feature: [context-forge](ctxman:feature/context-forge), which also writes data from the UI.
