---
type: Task
name: windows-smoke-test
title: Windows smoke test
description: Run the app, the add script and the checks on a Windows machine; decided against for now.
state: wont-do
tags: [testing, cross-platform]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:30:00Z
---

# Windows smoke test

## Goal

Confirm that the dev server, the add scripts and the check scripts work on Windows, since scripts are required to be cross-platform.

## Steps

- [ ] Install Node 24 and pnpm on a Windows machine.
- [ ] Run `pnpm run dev`, open a few pages, run each check script.
- [ ] Add and delete one entry of each dataset kind.

## Done when

Not applicable: this task will not be done.

## Decision

No Windows machine is available and ctxman only runs locally for one user. Cross-platform behaviour is covered by construction instead: scripts use `node:fs`, `node:path` and `process.execPath`, never a shell; relative paths are handled as posix inside the app; and the unit tests exercise filesystem code against temporary folders. Reopen this task if ctxman is ever run on Windows.

See the portability rules in [ctxman](ctxman:kb/ctxman).
