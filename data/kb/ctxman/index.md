---
okf_version: "0.2"
---
# ctxman

## Entry

* [ctxman](/main.md) - What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.

## Design

* [Architecture](/concepts/architecture.md) - Stack, repository layout and the layering rules that keep scripts, tests and the site sharing one codebase.
* [Datasets](/concepts/datasets.md) - The eleven datasets, their on-disk shape, lifecycle states and the link syntax between entries.
* [Runtime modes](/concepts/runtime-modes.md) - How dev and built servers differ, and why contexts bypass the content layer at runtime.
* [Editing](/concepts/editing.md) - In-browser editing: the explicit Save model, the markdown editor and popups, the yaml forms, Open in IDE, the JSON Schemas and how the UI tolerates the dev reload after a save.

## Features

* [Context forge](/concepts/context-forge.md) - How contexts work and how to build one in the forge UI.
* [Context inflate](/concepts/context-inflate.md) - Recipes that turn contexts and extra items into one markdown document, or into a working directory (symlinks, copies, clones, installed skills, an LLM_CONTEXT.md map) for Claude Code, Codex or a generic agent: modes, materials, targets, runs, safety rules and API.
* [Search](/concepts/search.md) - The global fuzzy search: what is indexed, how it ranks, and its URL parameters.
* [Routes and API](/concepts/routes-and-api.md) - Every page route, URL parameter and JSON endpoint.

## Working in the repo

* [Adding entries](/concepts/adding-entries.md) - Scaffold new entries with the add scripts and fill them in correctly.
* [Compliance checks](/concepts/compliance-checks.md) - The check scripts, their rule ids and the typecheck chain.
