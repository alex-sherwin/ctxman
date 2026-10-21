---
okf_version: "0.2"
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
links:
  - dataset: feature
    slug: entry-relations
    rel: related
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
* **Agent access**: an embedded [MCP server](/concepts/mcp.md) at `POST /mcp` lets an agent search, read, render recipes and update entries without going through the UI.

Every entry is a folder or file in your data directory (`CTXMAN_DATA_DIR`, required; the repository's sample corpus is `tests/data/`). There is no database, and files are read from the disk on every request, so what you see is always the current state. See [Datasets](/concepts/datasets.md) for the exact shapes. Entries point at each other with typed [relations](/concepts/relations.md) (a project owns its children, a task can depend on another), and every entry page shows what it links to and what links to it. Entries are normally edited in your IDE (the UI follows along); markdown files, references, contexts and recipes can also be edited in the browser, see [Editing](/concepts/editing.md).

## How an agent should use it

1. Find the relevant context (or build one in the [context forge](/concepts/context-forge.md)). A context lists links plus optional notes that narrow what the agent should read.
2. Follow each link to the underlying entry. Contexts are pointers, so the entry is always the current version.
3. Connect entries with typed [relations](/concepts/relations.md) (a project lists its tasks as children, a task can depend on another) and add any entry to a context from its page.
4. Agents can do all of this through [MCP](/concepts/mcp.md) (`claude mcp add --transport http ctxman http://127.0.0.1:4321/mcp`).
5. To hand a whole session brief to an agent, compose a recipe in [context inflate](/concepts/context-inflate.md) and generate its document.
6. When you learn something durable, record it as a new entry with the [add scripts or the create forms](/concepts/adding-entries.md) and run the [checks](/concepts/compliance-checks.md).

The context [ctxman-dev](ctxman:context/ctxman-dev) is the starting point for working on ctxman itself.

## Concept map

* [Architecture](/concepts/architecture.md) - stack, layout and layering.
* [Datasets](/concepts/datasets.md) - the twelve datasets and link syntax.
* [Relations](/concepts/relations.md) - typed links between entries, projects and their children, and how the UI edits them.
* [Context forge](/concepts/context-forge.md) - building and editing contexts.
* [Context inflate](/concepts/context-inflate.md) - recipes and the generated session document.
* [Search](/concepts/search.md) - global fuzzy search.
* [Routes and API](/concepts/routes-and-api.md) - pages, URL parameters, endpoints.
* [Adding entries](/concepts/adding-entries.md) - scaffold and author new entries.
* [Compliance checks](/concepts/compliance-checks.md) - OKF, link and collection checks.
* [Runtime modes](/concepts/runtime-modes.md) - the data directory, the per-request read path, dev server versus built server.
* [MCP server](/concepts/mcp.md) - the embedded MCP endpoint for agents: setup, tools and resources.
* [Keyboard shortcuts](/concepts/keyboard-shortcuts.md) - `?` help, `c` new entry, `l` add a link, `.` open in the IDE, `e` edit, `t` log time, and the editor and search keys.
* [Editing](/concepts/editing.md) - editing in the browser: the Save model, drafts, markdown editor with link completion, Details dialog and forms, Open in IDE, JSON Schemas.
* [Jira markup](/concepts/jira-markup.md) - Copy as JIRA Markup: markdown to Jira wiki markup, the mapping and the escaping policy.
* [Agent history import](/concepts/agent-history.md) - + Session / + Plan: import Claude Code, Codex and GitHub Copilot sessions and plans into a bundle.

## Quick facts

| Item | Value |
| --- | --- |
| Package manager | pnpm only (never npm, npx or yarn) |
| Primary way to run | `pnpm run dev`, served at http://127.0.0.1:4321 |
| Data directory | Required: the `CTXMAN_DATA_DIR` environment variable, from the shell or a `.env` file at the repo root (see `.env.example`); `tests/data` is the sample corpus |
| MCP endpoint | `POST http://127.0.0.1:4321/mcp` (Streamable HTTP, stateless, loopback only) |
| Scripts | TypeScript run directly by Node 24, no transpile step |

## Context inflate

The tool at `/inflate` expands selected contexts, extra items and your own instructions into one markdown document plus a manifest, with a target-specific header and include mode per item. Given an output directory it can also inflate into a working directory: knowledge and skills symlinked, repositories cloned, linked, copied or checked out as git worktrees (with an Editable flag and an optional work branch), remote skills cloned or downloaded, plus an `AGENTS.md` context file that links to all of it, maps the directory and says where to run commands (Claude Code, Codex and other agents all read it), and an optional `.gitignore` stub, ready to start an agent in. It reads the linked entries when you generate, so contexts stay evergreen. The saved compositions are `recipe` entries. Details are in [Context inflate](/concepts/context-inflate.md); the origin is the idea [context-inflate](ctxman:idea/context-inflate) and the delivery plan is the project [ctxman-v1](ctxman:project/ctxman-v1).

## Design

* [Architecture](/concepts/architecture.md) - Stack, repository layout, the three-kind layering (pure, node, server), the single arktype validator and the embedded MCP server that keep scripts, tests and the site sharing one codebase.
* [Datasets](/concepts/datasets.md) - The twelve datasets (snippets included), their on-disk shape, lifecycle states, the `links` relations field and the link syntax between entries.
* [Relations](/concepts/relations.md) - Typed links between entries (child, related, depends-on), projects that own their children, mentions, the entry index behind them and the panels, pickers and APIs that edit them.
* [Runtime modes](/concepts/runtime-modes.md) - The required data directory and `.env`, the per-request read path from disk, and what still differs between the dev server and a built server.
* [Editing](/concepts/editing.md) - In-browser editing: the explicit Save model, drafts that survive a reload, the markdown editor with link completion and the entry picker, the Details dialog, state select and New concept, the forms, Open in IDE, the JSON Schemas and the reload that follows a save.

## Features

* [Context forge](/concepts/context-forge.md) - How contexts work and how to build one in the forge UI, including the All tab, add with children and drafts.
* [Context inflate](/concepts/context-inflate.md) - Recipes that turn contexts and extra items into one markdown document, or into a working directory (symlinks, copies, clones, worktrees, downloaded skills, an AGENTS.md context file that links to them) for Claude Code, Codex or a generic agent: Place and mode per item, Editable repositories, materials, targets, runs, safety rules and API.
* [Search](/concepts/search.md) - The global fuzzy search: what is indexed (built from the disk per request), how it ranks, and its URL parameters.
* [MCP server](/concepts/mcp.md) - The embedded MCP endpoint at `POST /mcp`: client setup, the read and write tools, the resources, and its loopback-only safety.
* [Jira markup](/concepts/jira-markup.md) - "Copy as JIRA Markup" on the Copy buttons: how `src/lib/jira-markup.ts` maps every GFM element to Jira wiki markup, when it escapes, and what real Jira renderers cannot show.
* [Agent history import](/concepts/agent-history.md) - The + Session and + Plan buttons of the Files panel: where the session histories and plan files of Claude Code, Codex and GitHub Copilot (CLI and VS Code) live, how they are read, the generated `agent-session` / `plan` markdown (inert, kept out of search), the safety rules and the API.
* [Routes and API](/concepts/routes-and-api.md) - Every page route, URL parameter and JSON endpoint, including the entry PATCH and create APIs, the MCP endpoint and the 503 while the data directory is unusable.

## Working in the repo

* [Adding entries](/concepts/adding-entries.md) - Scaffold new entries with the add scripts or the `/new/<dataset>` forms and fill them in correctly.
* [Compliance checks](/concepts/compliance-checks.md) - The check scripts (which need `CTXMAN_DATA_DIR`), their rule ids and the typecheck chain.
