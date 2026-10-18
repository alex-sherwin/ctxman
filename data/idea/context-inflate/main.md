---
type: Idea
name: context-inflate
title: Context inflate
description: A tool that turns selected contexts plus user instructions into material ready for a Claude Code or Codex session; built as Context Inflate.
state: complete
tags: [context, agents, inflate]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:00:00Z
---

# Context inflate

**Status: built.** Context Inflate shipped after v1 as the `recipe` dataset plus the tool at `/inflate`: a recipe selects contexts and extra items, sets an include mode per item and an order, injects markdown and a preamble, and generates one markdown document and a manifest for Claude Code, Codex or a generic agent. How it works is documented in the concept `concepts/context-inflate.md` of the knowledge base [ctxman](ctxman:kb/ctxman). The rest of this entry is the original proposal, kept for history, followed by how each open question was settled.

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

## How the open questions were settled

* **Which files does each harness read?** Per target the document header names the skills directory (`.claude/skills` for Claude Code, `.agents/skills` for Codex and the generic target) and the instructions file (`CLAUDE.md`, `AGENTS.md`, none). The tool writes one markdown document rather than harness-native files, and skills are installed by commands the document lists.
* **Write into a project or review first?** Review first: the preview shows the document and its manifest, then you copy it, download it, or write it to an absolute `.md` path (default `out/<recipe>.md`, gitignored). The write endpoint refuses paths inside `data/`, `node_modules` or `.git`.
* **Very large bundles?** Each item has an include mode, from a one-line pointer to the whole bundle, and the manifest warns when the document passes 512 KB.
* **Conflicting instructions between contexts?** Not resolved automatically. Contexts keep their own sections and notes, labelled by context, in the order you choose, and you can add your own markdown to settle a conflict.
* **Page, script or both?** A page (`/inflate`) backed by JSON endpoints. There is no CLI script.

Delivery tracking lives in the project [ctxman-v1](ctxman:project/ctxman-v1), where this is listed as work after v1.
