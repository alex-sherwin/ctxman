---
type: Knowledge Base
name: ctxman
title: ctxman
description: What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.
tags: [ctxman, architecture, docs]
sources:
  - id: initial-instructions
    resource: INITIAL_INSTRUCTIONS.md
    title: ctxman requirements
  - id: plan
    resource: plans/PLAN.md
    title: ctxman implementation plan
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:30:00Z
status: stable
---

# ctxman

ctxman (context manager) is a local-only Astro application for agentic AI coding work. It keeps what you know and what you intend to build in one repository, and it lets you assemble that material into reusable **contexts** that you hand to a coding agent session.

It runs on a Node backend with API routes and can run local scripts. It is never deployed to a hosting platform.

## What it holds

* **Knowledge**: knowledge base bundles (`kb`) and root cause analyses (`rca`).
* **Work**: `idea`, `task`, `bug`, `feature` and `project` entries, each with a lifecycle state.
* **Agent material**: `skill` folders that follow the agentskills.io format, and `reference` records that point at things outside this repo.
* **Contexts**: `context` records that link to any of the above without copying it.
* **Recipes**: `recipe` records that turn contexts and extra items into one ready-to-use document for Claude Code, Codex or a generic agent.

Every entry is a folder or file under `data/`. There is no database. See [Datasets](/concepts/datasets.md) for the exact shapes.

## How an agent should use it

1. Find the relevant context (or build one in the [context forge](/concepts/context-forge.md)). A context lists links plus optional notes that narrow what the agent should read.
2. Follow each link to the underlying entry. Contexts are pointers, so the entry is always the current version.
3. To hand a whole session brief to an agent, compose a recipe in [context inflate](/concepts/context-inflate.md) and generate its document.
4. When you learn something durable, record it as a new entry with the [add scripts](/concepts/adding-entries.md) and run the [checks](/concepts/compliance-checks.md).

The context [ctxman-dev](ctxman:context/ctxman-dev) is the starting point for working on ctxman itself.

## Concept map

* [Architecture](/concepts/architecture.md) - stack, layout and layering.
* [Datasets](/concepts/datasets.md) - the eleven datasets and link syntax.
* [Context forge](/concepts/context-forge.md) - building and editing contexts.
* [Context inflate](/concepts/context-inflate.md) - recipes and the generated session document.
* [Search](/concepts/search.md) - global fuzzy search.
* [Routes and API](/concepts/routes-and-api.md) - pages, URL parameters, endpoints.
* [Adding entries](/concepts/adding-entries.md) - scaffold and author new entries.
* [Compliance checks](/concepts/compliance-checks.md) - OKF, link and collection checks.
* [Runtime modes](/concepts/runtime-modes.md) - dev server versus built server.

## Quick facts

| Item | Value |
| --- | --- |
| Package manager | pnpm only (never npm, npx or yarn) |
| Primary way to run | `pnpm run dev`, served at http://127.0.0.1:4321 |
| Data directory | `./data`, overridable with the `CTXMAN_DATA_DIR` environment variable |
| Scripts | TypeScript run directly by Node 24, no transpile step |

## Context inflate

The tool at `/inflate` expands selected contexts, extra items and your own instructions into one markdown document plus a manifest, with a target-specific header and include mode per item. It reads the linked entries when you generate, so contexts stay evergreen. The saved compositions are `recipe` entries. Details are in [Context inflate](/concepts/context-inflate.md); the origin is the idea [context-inflate](ctxman:idea/context-inflate) and the delivery plan is the project [ctxman-v1](ctxman:project/ctxman-v1).
