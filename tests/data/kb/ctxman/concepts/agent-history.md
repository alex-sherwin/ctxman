---
type: Reference
title: Agent history import
description: Importing coding-agent session histories and plan files (Claude Code, Codex, GitHub Copilot CLI and VS Code chat) into an okf bundle - where ctxman looks, the formats it reads, the generated markdown, the safety rules, the API and the two dialogs.
tags: [agent-history, sessions, plans, import, claude-code, codex, copilot]
generated:
  by: claude-code/ctxman-agent-history
  at: 2026-10-21T12:00:00Z
---

# Agent history import

Coding agents keep a record of every session and of the plans they write. The Files panel of every okf entry and okf doc page has two buttons after `+ Add file` that bring those records into the bundle as markdown concept files: **+ Session** (an agent session, `type: agent-session`) and **+ Plan** (a plan file, `type: plan`). ctxman only ever reads the agents' directories; the import is a new file in the bundle, written like [Add file](/concepts/editing.md) writes one (never overwriting, listed under `## Links` of the entry `index.md` and in an existing `log.md`).

Imported files carry `index: false`, so session and plan text never enters [search](/concepts/search.md) (the widget, `#tag` queries and the MCP `search` tool); they still show in the Files panel, the `## Links` section (title only), the doc pages and [Context inflate](/concepts/context-inflate.md) like any other file of the bundle.

The code is `src/lib/agent-history/` (contract `types.ts`; readers, listing and markdown beside it) behind the routes `src/pages/api/agent-sessions/*` and `src/pages/api/agent-plans/*`; the dialogs are `src/ui/agent/` in the EntryTools island.

## Where ctxman looks

Every location derives from one home directory: `CTXMAN_AGENT_HOME` when it is set (tests and the e2e servers point it at a fake home; then every other variable below is ignored), else the OS home directory. Display paths shorten it to `~`.

| Source | Agent | Sessions | Plans |
| --- | --- | --- | --- |
| `claude-code` | Claude Code | `<claude>/projects/<encoded-cwd>/<uuid>.jsonl` (top level only: `agent-*.jsonl` and sub-folders are subagent transcripts) | `<claude>/plans/*.md` |
| `codex` | Codex | `<codex>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` and `.jsonl.zst` | `<codex>/plans/<thread>/<turn>/*.md` |
| `codex-archived` | Codex | `<codex>/archived_sessions/rollout-<ts>-<uuid>.jsonl[.zst]` | |
| `copilot-cli` | GitHub Copilot | `<copilot>/session-state/<uuid>/events.jsonl` (+ `workspace.yaml`), legacy `<copilot>/session-state/<uuid>.jsonl` | `<copilot>/session-state/<uuid>/plan.md` |
| `vscode`, `vscode-insiders` | GitHub Copilot | `<user>/workspaceStorage/<hash>/chatSessions/<uuid>.json[l]`, `<user>/globalStorage/emptyWindowChatSessions/` | best effort: `<user>/workspaceStorage/<hash>/GitHub.copilot-chat/memory-tool/memories/**/*plan*.md` |

`<claude>` = `CLAUDE_CONFIG_DIR` else `~/.claude`; `<codex>` = `CODEX_HOME` else `~/.codex`; `<copilot>` = `~/.copilot`; `<user>` = the `User` folder of `Code` / `Code - Insiders` (macOS `~/Library/Application Support/<app>/User`, Linux `${XDG_CONFIG_HOME:-~/.config}/<app>/User`, Windows `${APPDATA:-~/AppData/Roaming}/<app>/User`). Symlinked folders and files there are not followed. A session or plan is named by a key `<source>:<id>` (the agent's own id: a uuid, a file stem; a Codex plan is `<thread>.<turn>`, plus `.<stem>` when the file is not `PLAN.md`); a request only ever names a key, never a path, and the server finds the file by listing that source again.

## What is read

Every format is parsed defensively: unknown line types are skipped, a torn line never fails the file. Tool calls become one-line summaries (the command of a shell tool, the file of a read / edit / write tool, the pattern and path of a search, the URL, the query, a task description, else compact JSON; at most 160 characters); tool output is never kept. Subagent work is left out.

* **Claude Code**: `user` lines with typed text are prompts; tool results, `isMeta` and `isSidechain` lines, task notifications and peer messages (`origin.kind` other than `human`) are not. Slash commands show as `/name args`, a shell escape as `! cmd`; local command output, system reminders and `Caveat:` lines are dropped. Consecutive `assistant` lines (one content block each) are one turn: text, thinking, tool calls. Title: the last `custom-title` (set by the user), else the last `ai-title`, else a `summary` line, else the first prompt.
* **Codex**: the rollout lines `{timestamp, type, payload}`; `session_meta` (id, cwd, git branch; a thread with a parent or a subagent source is a subagent and not listed), `turn_context` (model), `response_item` (messages, reasoning summaries, `function_call`, `custom_tool_call`, `local_shell_call`; a message between agents of a multi-agent run is one `agent message` line) and the exact typed prompts of `event_msg` (`user_message`, or the `item_completed` UserMessage item of newer builds; when a file has those, the `response_item` user copies are ignored). Injected context (environment, AGENTS.md instructions, permissions, collaboration mode, any text that is one `<tag>…</tag>` wrapper) is never a prompt. `.zst` files are zstd (`node:zlib`). Title: the thread name in `<codex>/session_index.jsonl` (the latest line per id), else the first prompt.
* **GitHub Copilot CLI**: `events.jsonl` (`session.start`, `user.message`, `assistant.message` with its `toolRequests`, `assistant.reasoning`, `tool.execution_start` for calls no message announced; events with a `parentToolCallId` belong to a subagent) and `workspace.yaml` (cwd, branch, summary). Title: the summary, else the first prompt.
* **VS Code chat** (GitHub Copilot): a `.json` session state, or a `.jsonl` mutation log replayed into it (`kind` 0 whole state, 1 set at a path, 2 truncate and append to an array, 3 delete). Response parts: markdown chunks (joined), `thinking` (chunks of one thought share an id), `toolInvocationSerialized` (its message, links shown as their file names) and inline references (the referenced name in code); everything else is skipped. The workspace folder comes from `workspace.json` (a `file://` URI as a path, a remote URI decoded). Title: the custom title, else the first prompt.

## Listing

`GET /api/agent-sessions` stats every source (readdir + stat only), sorts by file mtime, newest first, and parses only what the page needs: a summary reads a bounded part of each file (Claude: the first and last 128 KB, cut to complete lines; Codex: the first 256 KB of the decompressed text, the zstd stream stopped there; Copilot: the first 128 KB plus `workspace.yaml`; VS Code: the whole file up to 8 MB, else its first 2 MB, by pattern when that head is not valid JSON) and is cached by path, mtime and size. Sessions without a user prompt and subagent threads are left out. `q` keeps the sessions where every whitespace token occurs (case-insensitive) in the title, first prompt, cwd or branch. A page is `limit` sessions (default 50, at most 200); `next` is the offset to continue from, null at the end. On a home with about 500 sessions the first page answers in about 140 ms cold and 10 ms from the cache.

`GET /api/agent-plans` lists every plan file (at most 500) newest first. Each text is read (up to 1 MB, cached), so `q` matches the title, the path, the thread and the whole text. A plan's title is its first heading, else the thread / session title, else the file name; the excerpt is the first lines of text after it.

## The imported file

A session becomes:

```markdown
---
type: agent-session
title: Fix the login redirect
description: Claude Code session in ~/repos/app, 2026-10-21, 12 prompts
tags: [agent-session, claude-code]
index: false
agent: claude-code
source: claude-code
session_id: 6b97321c-…
cwd: /Users/me/repos/app
git_branch: main
model: claude-opus-5-5
started: "2026-10-21T16:13:00Z"
ended: "2026-10-21T18:02:11Z"
prompts: 12
source_path: ~/.claude/projects/-Users-me-repos-app/6b97321c-….jsonl
imported: "2026-10-21T19:00:00Z"
---

# Fix the login redirect

| Agent | Claude Code |
| ----- | ----- |
| Directory | `/Users/me/repos/app` |
| …         | … |

## Prompt 1 · 2026-10-21 16:13

<the prompt>

### Response

> **Thinking:** … (only with Thinking on)

- `Bash` `git status`
- `Read` `src/lib/auth.ts`

<the answer>
```

Keys whose value is unknown are left out; date-times are quoted strings (ctxman reads YAML with the timestamp tag). Every prompt is a `## Prompt N · <UTC time>` section and every assistant turn a `### Response`; headings inside the text move down three levels (capped at 6; setext headings become ATX; never inside code). Tool calls are on by default and thinking off; both are options of the preview and the import. Every text block is cut at 40 000 characters (`… [truncated N characters]`); once the body passes 1.5 MB the remaining prompts are left out with a closing note. The default path is `sessions/<YYYY-MM-DD>-<agent>-<slug of the title, at most 48>.md`.

A plan becomes `type: plan` with `title`, `description` (`<Agent> plan, <YYYY-MM-DD>`, plus the thread when known), `tags: [plan, <agent>]`, `index: false`, `agent`, `source`, `plan_id`, `cwd` and `thread` when known, `source_path` and `imported`; the body is the plan text without its own frontmatter, with `# <title>` added when it has no H1 (headings are not shifted). The default path is `plans/<slug of the title, at most 64>.md`.

A title given in the dialog replaces the agent's own (frontmatter, H1 and the `## Links` line); without one the server uses the agent's title or the first prompt, cut to one line of at most 200 characters (a prompt-derived title to 120).

## Safety

* **Read-only**: nothing under the agents' directories is ever written or deleted, and a request never names a path. The detail of a session file over 256 MB answers 413, a plan over 1 MB too.
* **Inert text**: session and plan text can carry fetched web content, and the renderer passes raw HTML through, so every `<` outside code (fenced, indented, inline) becomes `&lt;`, except an `http(s)` / `mailto` autolink. What counts as code comes from satteri's own mdast (`markdownToMdast`, the parser that renders the doc page), and the whole body is checked again after assembly, so no raw HTML node survives.
* **No new link findings**: a link, image or reference definition whose destination is not `http(s)`, `mailto` or a `#fragment` becomes ``text (`dest`)`` (an image ``alt (`src`)``; a definition is escaped), so `javascript:`, `file:`, relative and `ctxman:` links never become links and an import adds no `links/*` finding to `pnpm run check`. The body is also run through the checker's own link model (`links.ts#extractLinks`), which reads links inside indented or nested code that CommonMark keeps literal.
* **Bookkeeping lines**: the `## Links` and `log.md` lines get the title only, with `<` escaped, so they add no HTML; no description: the entry `index.md` is searchable, so the session's directory, dates and prompt count stay out of it.
* **Writer**: `doc-io#createDocFile` (the same checks and bookkeeping as `POST /api/doc`, never overwriting: 409 `exists`); the frontmatter passes the okf concept schema.

## API

| Endpoint | Answer |
| --- | --- |
| `GET /api/agent-sessions?agent=&q=&offset=&limit=` | 200 `{ items, next, sources }`: summaries `{ key, agent, source, id, title, firstPrompt?, cwd?, gitBranch?, model?, startedAt?, modifiedAt, bytes }`, `sources` = every searched location `{ source, agent, path, exists }`. 400 `bad-agent` (`agent` is `claude-code`, `codex` or `copilot`, absent for all) |
| `GET /api/agent-sessions/<key>?tools=1\|0&thinking=1\|0` | 200 `{ summary, prompts, markdown, html, truncated, defaultPath }` (`markdown` = the file an import writes, `html` = its body rendered like a doc page). 400 `bad-key`, 404 `not-found`, 413 `too-large` |
| `POST /api/agent-sessions/import` | Body `{ key, dataset, slug, path, title?, tools?, thinking? }`: 201 `{ path, url, lastModified, warnings }` + `location`. 400 `invalid` / `bad-key` / `bad-dataset` / `bad-slug` / `bad-path`, 403, 404 `not-found` (session or entry), 409 `exists`, 413, 415 |
| `GET /api/agent-plans?agent=&q=` | 200 `{ items, sources }`: `{ key, agent, source, id, title, excerpt, path, cwd?, thread?, modifiedAt, bytes }` |
| `GET /api/agent-plans/<key>` | 200 `{ summary, markdown, html, defaultPath }` |
| `POST /api/agent-plans/import` | Body `{ key, dataset, slug, path, title? }`: same answers as the session import |

The `<key>` is one path segment, sent with `encodeURIComponent` (`claude-code%3A6b97…`); the decoded form works too. `/api/agent-sessions/import` and `/api/agent-plans/import` are their own routes (a GET there is 405). The import checks the body, the key and the target (dataset, slug, path) before it reads the history.

## The dialogs

Both dialogs are large modals with a list on the left and a preview on the right; the preview shows exactly the markdown an import writes.

* **Agent sessions** (`+ Session`): agent chips All / Claude Code / Codex / GitHub Copilot and a search field (debounced 250 ms, searched on the server); rows newest first with the agent (and source) badge, title, short directory and relative time; the first row is selected, arrow keys move the selection, Load more fetches the next 50. Under the preview: Tool calls (on) and Thinking (off), which refresh it, then Path (prefilled with the default path, the Add file path rules), Title (prefilled; sent only when changed) and Import. A 201 opens the new doc page; an existing path keeps the dialog open with "already exists". With nothing found the dialog lists the searched locations.
* **Agent plans** (`+ Plan`): the same layout with an autofocused search over the whole plan text and the agent chips; rows show title, excerpt, agent badge, short path and relative time.

## Not yet

MCP tools to list and import sessions, Claude Code's custom `plansDirectory`, other VS Code forks (Cursor, VSCodium), tailing a running session and subagent transcripts.
