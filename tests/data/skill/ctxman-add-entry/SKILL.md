---
name: ctxman-add-entry
description: Create a new ctxman dataset entry (kb, rca, idea, task, bug, feature, project, skill, reference, snippet, context or recipe) with the pnpm add scripts, then fill it in and verify it. Use whenever asked to record an idea, task, bug, feature, project, analysis, note, skill, external reference, reusable instruction snippet, context or Context Inflate recipe in this repo.
compatibility: Run from the ctxman repository root. Needs Node 24, pnpm (never npm) and the CTXMAN_DATA_DIR environment variable (shell or a .env file at the repo root).
metadata:
  author: ctxman
  version: "1.5"
allowed-tools: Read Edit Bash(pnpm run add:*) Bash(pnpm run check:*) Bash(pnpm run fix:yaml-comments)
---

# Adding a ctxman entry

Every entry is created with a script so its files have the right shape. Use pnpm only.

## When to use

Any time the user wants something recorded in ctxman: "add a task for X", "write up this bug", "note this as knowledge", "save a reference to that repo", "save these instructions as a snippet", "make a context for this work", "save a recipe for this session brief".

## Instructions

0. **Check the data directory.** The scripts write into the directory named by `CTXMAN_DATA_DIR`, which is required (there is no default). It can be exported in the shell or set in a `.env` file at the repo root (`.env.example` shows the format); the scripts read `.env` themselves. When it is unset, a script prints the problem and exits with code 2: set it and run again. To work on the sample corpus, use `CTXMAN_DATA_DIR=tests/data` (it holds the committed seed entries).

1. **Choose the dataset.**

   | Dataset | Use for | Default state |
   | --- | --- | --- |
   | `kb` | knowledge about something that exists | none |
   | `rca` | root cause analysis of a solved problem | none |
   | `idea` | an idea worth exploring | pending |
   | `task` | a discrete unit of work | pending |
   | `bug` | a defect | pending |
   | `feature` | a user-facing capability | pending |
   | `project` | a large scope spanning many entries | pending |
   | `skill` | an agent skill folder | none |
   | `reference` | a pointer to a local repo, local folder, remote repo or remote skill | none |
   | `snippet` | reusable markdown text, such as instructions you give every session, that contexts and recipes include | none |
   | `context` | a reusable set of links to other entries | none |
   | `recipe` | a saved Context Inflate composition: contexts, extra items, include modes, order and instructions for one agent target | none |

2. **Pick a name**: lowercase letters, digits and single hyphens, at most 64 characters. It becomes the folder or file name and the slug, and cannot be changed later for a context.

3. **Run the script** from the repo root:

   ```bash
   pnpm run add:task fix-login-redirect --title "Fix login redirect" --description "Users land on the home page after login."
   ```

   Other options: `--state <state>` for lifecycle datasets; `--issue-key <key>` for OKF datasets (the key of the matching issue in an issue tracker, e.g. `PROJ-123`; one word); for references `--type local-repo|local-folder|remote-repo|remote-skill` (`local-folder` = a plain folder that is not a git repository), `--path` (the local types), `--uri` (git URI such as `git@github.com:org/repo.git` or `https://github.com/org/repo`; a `remote-skill` may instead use an https `.tar.gz`/`.tgz`/`.zip` URL), `--subpath`, `--folder <name>` (not for `remote-skill`: the folder name a Context Inflate working directory uses, `repos/<name>` or `folders/<name>`, instead of the reference name; one folder name, letters, digits, `. _ -`), `--owner me|not-me`; for snippets `--markdown "..."` (the text itself; without it the file gets a `TODO:` placeholder to replace); `--json` for machine-readable output. Do not add a `--` separator before the flags (pnpm 11 forwards it literally and the script rejects it). The script refuses to overwrite anything that already exists. A reference created without `--path` or `--uri` gets a placeholder location (`~/repos/<name>`, `~/<name>` for a local folder, or `https://github.com/TODO/<name>.git`) that still passes the checks, so pass the real value or replace it afterwards.

4. **Fill in the generated files.** For OKF datasets edit the sections of the entry `index.md` (in the data directory), set `tags`, and replace the `TODO:` description. For the OKF details load the skill `okf-authoring`. A `recipe` is a YAML file (`recipe/<name>.yaml` in the data directory) that starts with `target: claude-code`, `layout: grouped` and empty `contexts` and `items`; recipes have no lifecycle state (`--state` is refused), so fill in the description and then compose it at `/inflate?recipe=<name>` instead of hand-editing the lists (the schema is strict; the fields are documented in `concepts/context-inflate.md` of the knowledge base [ctxman](ctxman:kb/ctxman)).

   Every dataset can also be created in the browser at `/new/<dataset>` (a form with typed fields; `/new/<dataset>?parent=<project>` makes the new entry a child of that project). The script is the way for an agent: it needs no running server. These yaml files (reference, snippet, context, recipe) start with the line `# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/<dataset>` (the origin is `CTXMAN_SERVER_ORIGIN`, default `http://127.0.0.1:4321`): the script and the forms write it, never strip it, and run `pnpm run fix:yaml-comments` for a yaml entry you wrote by hand.

5. **Link related entries.** In prose use `ctxman:<dataset>/<slug>`, for example `ctxman:feature/context-forge` (a *mention*). For a typed relation add `links` to the frontmatter of an okf entry `index.md` (not a skill): `links: [{dataset, slug, rel}]` with `rel` `child` (a project lists the tasks, features, bugs and ideas it contains; the child does not point back), `related` or `depends-on`; one link per target, none to the entry itself. The entry page edits them too (Links and Children panels).

6. **Change state or frontmatter later without editing the file by hand**: the state select on lists and detail pages, or `PATCH /api/entry/<dataset>/<slug>` with `{"state": "complete"}` (also `title`, `description`, `tags`, `stale_after`, `status`, `addLinks`, `removeLinks`) when the server is running (the same edits are the MCP tool `patch-entry`). The PATCH edits only the given keys and refuses (writes nothing) a result that fails the schema. Without a server, edit the `state:` line directly.

7. **Verify** with `pnpm run check` (it needs `CTXMAN_DATA_DIR` too). It must report zero errors and zero warnings (it also checks that the generated `schemas/*.schema.json` are current; after a change to a yaml dataset's shape run `pnpm run gen:schemas`).

## Notes

* The same action is available in the browser: `/new/<dataset>` forms (the `/tools` Add Entry panel links to them).
* Entries can be edited in the browser: markdown files on their detail page (Edit toggle, `?edit=1`), reference, snippet, context and recipe in a form (`/<dataset>/<slug>?edit=1`); a snippet's markdown also has a pencil popup on its page. Both save explicitly and are described in the knowledge base concept `concepts/editing.md`.
* Relations (the `links` field, projects and their children, the panels) are described in the knowledge base concept `concepts/relations.md`.
* An agent connected to ctxman over MCP (`POST /mcp`) can use the `create-entry`, `clone-entry`, `patch-entry`, `append-context-links` and `append-log` tools instead of the scripts; see the knowledge base concept `concepts/mcp.md`.
* To start from an existing okf bundle (a recurring task, a project template), clone it instead of copying the folder: the `⋯` menu's Clone… on its page, `POST /api/entry/<dataset>/<slug>/clone` with `{"name": "new-name", "description": "..."}`, or the MCP tool `clone-entry`. Every file is copied, the new `index.md` gets the new name, title, description and the default state, and links to the original are not copied.
* Contexts can also be built interactively at `/forge`; recipes are composed and turned into a markdown document for Claude Code or Codex at `/inflate`.
* Background on all datasets: [ctxman](ctxman:kb/ctxman).
