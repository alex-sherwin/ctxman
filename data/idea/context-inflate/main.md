---
type: Idea
name: context-inflate
title: Context inflate
description: A planned tool that turns selected contexts plus user instructions into material ready for a Claude Code or Codex session.
state: pending
tags: [context, agents, planned]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:00:00Z
---

# Context inflate

**Status: not built.** The initial requirements say to build everything else first; nothing in the repo implements this yet.

## Problem

A context ([context forge](ctxman:feature/context-forge)) is only a list of pointers. To start an agent session someone still has to open each linked entry, copy the relevant parts and paste them into the harness, which is slow and easy to get wrong.

## Proposal

A tool that takes:

1. one or more contexts,
2. free-form markdown instructions from the user,
3. a target harness: Claude Code or Codex,

and prepares everything the linked items point to in a form that harness can consume. Ideas to explore:

* Resolve each link at that moment (contexts stay evergreen; inflation is the only step that reads linked content), and include the per-link notes as guidance.
* Emit harness-native files: for Claude Code, project instructions and skills; for Codex, an `AGENTS.md`-style instruction file.
* Copy skill folders into the harness's skill location instead of inlining them.
* Resolve `reference` links to paths or URIs and tell the agent how to reach them, rather than vendoring external repos.
* Report dangling links and stale entries before generating anything.

## Open questions

* Which exact files and locations does each harness read, and how do they differ between versions?
* Should output be written into a target project directory, or produced as a bundle to review first?
* How should very large linked bundles be summarised or truncated?
* How are conflicting instructions between two selected contexts resolved?
* Is inflation a page in the site, a script, or both?

Delivery tracking lives in the project [ctxman-v1](ctxman:project/ctxman-v1), where this is listed as work after v1.
