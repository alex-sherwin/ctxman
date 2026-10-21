# Agent history import: sessions and plans (build spec, 2026-10-21)

Branch `feature/ai-sessions`. Two features on okf bundle pages:

1. **Import session**: a dialog (the agent session history viewer) lists the agent sessions found in the well-known
   history locations of Claude Code, Codex and GitHub Copilot (CLI + VS Code chat), newest first, previews one as
   markdown and imports it into the bundle as a concept file (`type: agent-session`).
2. **Import plan**: a dialog with a search lists the plan markdown files those agents write, most recently modified
   first, previews one and imports it into the bundle (`type: plan`).

The shared contract is `src/lib/agent-history/types.ts` (PURE). Do not change its exported names without updating
both sides; additions are fine.

## 1. Locations (`src/lib/agent-history/roots.ts`, NODE without fs calls)

`agentRoots(env = process.env, platform = process.platform)`:

- `home` = `CTXMAN_AGENT_HOME` (resolved against `process.cwd()`) else `os.homedir()`.
- **When `CTXMAN_AGENT_HOME` is set, every other env override below is ignored** and all paths derive from it (tests
  and e2e set only this one variable to isolate from the real home).
- Claude Code: `CLAUDE_CONFIG_DIR` else `<home>/.claude`.
- Codex: `CODEX_HOME` else `<home>/.codex`.
- Copilot CLI: `<home>/.copilot`.
- VS Code user dirs, for `Code` (source `vscode`) and `Code - Insiders` (`vscode-insiders`):
  darwin `<home>/Library/Application Support/<app>/User`; linux `${XDG_CONFIG_HOME:-<home>/.config}/<app>/User`;
  win32 `${APPDATA:-<home>/AppData/Roaming}/<app>/User`.

Display paths shorten the home dir to `~` (forward slashes on every OS).

## 2. Sessions (observed formats, Oct 2026)

| source            | files                                                                                                           | id                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `claude-code`     | `<claude>/projects/<encoded-cwd>/<uuid>.jsonl` (top level only; skip `agent-*.jsonl` and sub-dirs = subagents)   | file stem                |
| `codex`           | `<codex>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` and `.jsonl.zst` (zstd)                                 | the trailing uuid        |
| `codex-archived`  | `<codex>/archived_sessions/rollout-<ts>-<uuid>.jsonl[.zst]`                                                     | the trailing uuid        |
| `copilot-cli`     | `<copilot>/session-state/<uuid>/events.jsonl` (+ legacy `<copilot>/session-state/<uuid>.jsonl`)                  | the uuid                 |
| `vscode[-insiders]` | `<user>/workspaceStorage/<hash>/chatSessions/<uuid>.json` / `.jsonl`, `<user>/globalStorage/emptyWindowChatSessions/<uuid>.json[l]` | file stem |

Formats (parse defensively: unknown line types are skipped, a bad line never fails the file):

- **Claude Code** jsonl: lines `{type, uuid, timestamp, sessionId, cwd, gitBranch, version, isSidechain, isMeta?, message}`.
  `type: user` with `message.content` a string or blocks (`text`, `tool_result`, `image`); a user line whose content
  is only `tool_result` blocks is NOT a prompt. Skip `isMeta: true` and `isSidechain: true`. Slash commands appear as
  `<command-name>/x</command-name><command-message>…</command-message><command-args>…</command-args>`: show as
  `/x args`; drop `<local-command-stdout>…`, `<system-reminder>…` and `Caveat: …` wrapper lines. `type: assistant`:
  `message.model`, `message.content` blocks `text`, `thinking` (`.thinking`), `tool_use` (`name`, `input`); each
  content block is often its own line: merge consecutive assistant lines into one message. Title: the LAST
  `{type: 'ai-title', aiTitle}` line, else a `{type: 'summary', summary}` line, else the first prompt.
- **Codex** rollout jsonl (`.zst` = zstd, `node:zlib` `zstdDecompressSync` / `createZstdDecompress`, Node 24): lines
  `{timestamp, type, payload}`. `session_meta.payload`: `id`, `timestamp`, `cwd`, `cli_version`, `git?.branch`.
  `turn_context.payload.model`. `response_item` payloads: `message` (`role` user|assistant|developer|system,
  `content: [{type: input_text|output_text|text, text}]`), `agent_message` (`content` like message), `reasoning`
  (`summary: [{text}]`, the rest is encrypted: ignore), `function_call` (`name`, `arguments` JSON string),
  `custom_tool_call` (`name`, `input`), `local_shell_call` (`action.command`). `event_msg` payload `user_message`
  (`message`) when present is the exact typed prompt (prefer it over the response_item copy; do not count both).
  User content that is injected context is not a prompt: text starting with `<environment_context>`,
  `<user_instructions>`, `<permissions`, `<collaboration_mode`, `# AGENTS.md instructions`, or any text that is one
  XML-like `<tag>…</tag>` wrapper. Title: `<codex>/session_index.jsonl` lines `{id, thread_name, updated_at}` (the
  latest line per id wins; read once per mtime), else the first prompt.
- **Copilot CLI** `events.jsonl`: lines `{type, data, id, timestamp, parentId}`: `session.start` (`data.startTime`,
  `data.context`), `user.message` (`data.content`), `assistant.message` (`data.content`, `data.toolRequests[]`
  `{name, arguments}`), `assistant.reasoning` (`data.content`), `tool.execution_start` (`data.toolName`,
  `data.arguments`; use it only when the assistant message had no `toolRequests`). `workspace.yaml` beside it:
  `cwd`, `branch`, `summary?`, `created_at`, `updated_at` (parse with `yaml`). Title: `summary`, else the first prompt.
- **VS Code chat** `.json`: `{sessionId, creationDate, lastMessageDate, customTitle?, requests: [{message: {text},
  timestamp, modelId, response: [...]}]}`. `.jsonl` = a mutation log, one op per line: `{kind: 0, v}` = the whole
  state; `{kind: 1, k: path[], v}` = set at path; `{kind: 2, k, v: items[], i?}` = at the array at path, truncate to
  length `i` when given, then append `v`; `{kind: 3, k}` = delete at path. Replay into the same shape as `.json`.
  Response parts: an object with a string `value` and no `kind` = markdown text; `kind: 'thinking'` (`value`);
  `kind: 'toolInvocationSerialized'` (`toolId`, `invocationMessage` string or `{value}`); everything else skipped.
  Workspace folder: `<hash>/workspace.json` `folder` (or `workspace`): a `file://` URI becomes a path, any other URI
  scheme (vscode-remote) is shown as the decoded URI. Title: `customTitle`, else the first prompt.

**Tool summaries**: one line, whitespace collapsed, at most 160 characters: Claude `Bash` -> `input.command`,
`Read|Edit|Write|NotebookEdit` -> `file_path`, `Grep|Glob` -> `pattern` (+ ` in <path>`), `WebFetch` -> `url`,
`WebSearch` -> `query`, `Task|Agent` -> `description`; Codex `shell`/`exec_command` -> the command (array joined with
spaces); otherwise compact JSON of the input.

**Listing** (`listAgentSessions({agent?, q?, offset, limit})`, NODE): candidates = readdir + stat of every source
(cheap), sorted by mtime desc. Summaries are computed lazily for the requested page (skip sessions without any user
prompt; keep scanning until `limit` items or the end), cached by `(path, mtimeMs, size)` in a module map (cap a few
thousand). A summary reads only a bounded part of big files: Claude head 128 KB + tail 128 KB (complete lines only);
Codex the first 256 KB of decompressed text (stream-decompress `.zst`, then stop); VS Code the whole file up to 8 MB,
else the first 2 MB of complete lines; Copilot head 128 KB + `workspace.yaml`. `q`: case-insensitive, every
whitespace token must occur in title + firstPrompt + cwd + gitBranch; with `q` set the scan computes summaries until
the page is full (the cache makes repeats cheap). `limit` default 50, max 200. `next` = index into the sorted
candidate list to continue from, null at the end.

**Detail** (`readAgentSession(key, options)`): resolves the key by listing its source again (never a path from the
request), parses the whole file (refuse files over 256 MB: 413 `too-large`), returns `AgentSessionDetail`.

## 3. Generated markdown (`src/lib/agent-history/markdown.ts`, PURE)

Session file:

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
| ----- | ----------- |
| Directory | `/Users/me/repos/app` |
…

## Prompt 1 · 2026-10-21 16:13

<prompt text>

### Response

<assistant text>

- `Bash` git status
- `Read` src/lib/auth.ts
```

Rules: `index: false` is always written (owner decision 2026-10-21: imported session and plan text never enters the
search index, widget or MCP `search`; the file still shows in the Files panel, `## Links` and Inflate); optional keys left out when unknown; date-times quoted (yaml `stringify` of strings does that only when
needed: quote them yourself or keep them strings that never parse as timestamps); `## Prompt N · <UTC time>` per user
message and `### Response` per assistant turn (thinking, when on, as a `> **Thinking:** …` blockquote); headings inside
message text shifted down by 3 levels (cap 6; ATX only, never inside fenced code). **Make imported text inert**:
outside fenced code and inline code spans, `<` becomes `&lt;` (the renderer passes raw HTML through, and session text
can carry fetched web content), except `<https://…>` / `<http://…>` / `<mailto:…>` autolinks. **Neutralize links the
bundle checker would validate**: a markdown link or image whose destination is not an absolute URL with a scheme
other than `ctxman:`/`file:` (http, https, mailto…) and not a `#fragment` becomes `text (`dest`)` (image: `alt
(`src`)`), so an imported file never adds `links/*` warnings to `pnpm run check`. Size: each text block is cut at
40 000 characters (`… [truncated N characters]`); once the body passes 1.5 MB the remaining prompts are left out with a
closing note; `truncated` reports either. `defaultPath` = `sessions/<YYYY-MM-DD of startedAt|modifiedAt>-<agent>-<slug
of title, max 48>.md`.

Plan file: frontmatter `type: plan`, `title`, `description` (`<Agent> plan, <YYYY-MM-DD>` + `, <thread>` when known),
`tags: [plan, <agent>]`, `index: false`, `agent`, `source`, `plan_id`, `cwd?`, `thread?`, `source_path`, `imported`; body = the plan
text with its own frontmatter (if any) removed, `# <title>` added when the text has no H1, then the same inert-HTML
and link-neutralizing passes (headings NOT shifted). `defaultPath` = `plans/<slug of title, max 64>.md`.

The importer stays the only writer: frontmatter must pass the okf concept schema (`validateDoc`).

## 4. Plans

| source          | files                                                                                               | id                   |
| --------------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| `claude-code`   | `<claude>/plans/*.md` (Claude Code's default `plansDirectory`)                                       | file stem            |
| `codex`         | `<codex>/plans/<thread-id>/<turn-id>/*.md` (observed: `PLAN.md`); `thread` = its session_index name | `<thread>.<turn>` (+ `.<stem>` when the file is not PLAN.md) |
| `copilot-cli`   | `<copilot>/session-state/<uuid>/plan.md`; `cwd`/`thread` from `workspace.yaml` (`summary`)           | the uuid             |
| `vscode[-insiders]` | best effort: `<user>/workspaceStorage/<hash>/GitHub.copilot-chat/memory-tool/memories/**/*plan*.md` (depth <= 4) | `<hash>.<path segments joined by .>` |

`listAgentPlans({agent?, q?})`: all plans (cap 500) sorted by mtime desc; the text is read (cap 1 MB per file, cache
by path+mtime+size) so `q` matches title, path, thread and the whole text (case-insensitive, every token).

## 5. Import (NODE, `src/lib/agent-history/import.ts`)

`doc-io.ts` gets `createDocFile(dataset, slug, rawPath, {title, description?, markdown}, dataDir?, now?)`: everything
`createDoc` does (dataset/slug/path checks, never overwrite = 409 `exists`, missing folders, the `## Links` line in
`index.md`, the `log.md` line when the bundle has one, `invalidateEntryIndex`, `validateDoc` warnings) but with the
given file content. `createDoc` becomes a wrapper over it (the POST body never reaches `markdown`).
`importAgentSession(body)` / `importAgentPlan(body)` validate the body (arktype through `validate()`), resolve the key,
generate the markdown with the chosen title, call `createDocFile`.

## 6. API (`src/pages/api/agent-sessions/*`, `src/pages/api/agent-plans/*`; JSON via `src/lib/http.ts`)

- `GET /api/agent-sessions?agent=<AgentId>&q=&offset=&limit=` -> 200 `AgentSessionList`; 400 `bad-agent`.
- `GET /api/agent-sessions/<key>?tools=1|0&thinking=1|0` -> 200 `AgentSessionDetail`; 400 `bad-key`, 404
  `not-found`, 413 `too-large`.
- `POST /api/agent-sessions/import` `AgentSessionImportBody` -> 201 `AgentImported` (+ `location`); 400 `bad-key` /
  `invalid` / `bad-dataset` / `bad-slug` / `bad-path`, 403, 404 `not-found` (session or entry), 409 `exists`, 415.
- `GET /api/agent-plans?agent=&q=` -> 200 `AgentPlanList`; `GET /api/agent-plans/<key>` -> 200 `AgentPlanDetail`;
  `POST /api/agent-plans/import` `AgentPlanImportBody` -> 201 `AgentImported`. Same errors.
- The detail `html` = `renderMarkdown` of the body (frontmatter stripped) then `rewriteRenderedHtml` for the target
  bundle is NOT needed (links were neutralized): plain `renderMarkdown`.

## 7. UI (EntryTools island; `src/ui/agent/` for the dialogs, browser-only, kit parts by file, no Monaco)

- okf Files panel (`FileTree.astro`, where `canCreate`): after `+ Add file`, two more SSR buttons in the same style:
  `+ Session` (`data-entry-action="import-session"`, `data-testid="files-import-session"`, title "Import an agent
  session") and `+ Plan` (`import-plan`, `files-import-plan`, "Import an agent plan"). `ENTRY_ACTIONS`, `EntryDialog`
  and `dialogFor` in `entry-helpers.ts` grow the two actions.
- **Session dialog** (`ImportSessionDialog.tsx`, `Modal size="large"`, testId `session-dialog`, title "Agent
  sessions"): toolbar = agent ChipToggle All / Claude Code / Codex / GitHub Copilot (`session-agent-<all|id>`) and a
  search field (`session-search`, debounced 250 ms, server `q`). Body = two columns: the list (`session-list`, rows
  `session-row` with `data-key`, newest first: agent badge (+ source badge), title, short cwd, relative time via
  `$now`; first row selected on load; arrow keys move; `Load more` `session-more` while `next` is not null) and the
  preview (`session-preview`: meta line, the rendered html in `cx-prose`, loading and error states). Under the preview:
  checkboxes "Tool calls" (`session-opt-tools`, on) and "Thinking" (`session-opt-thinking`, off) that refetch the
  preview, then Path (`session-import-path`, prefilled with `defaultPath`, the Add file path rules
  `newFilePath`/`newFilePathProblem`), Title (`session-import-title`, prefilled) and `Import` (`session-import-submit`,
  disabled until valid). 201 -> `location.assign(url)` (the new doc page); 409 -> "already exists, pick another path"
  (`session-import-error`). Empty state `session-empty` lists the searched locations (`sources`, exists or not).
- **Plan dialog** (`ImportPlanDialog.tsx`, `plan-dialog`, "Agent plans"): the same layout: search (`plan-search`,
  autofocus), agent chips (`plan-agent-<all|id>`), rows `plan-row` (title, excerpt, agent badge, short path, relative
  time), preview `plan-preview`, `plan-import-path` (default `defaultPath`), `plan-import-title`,
  `plan-import-submit`, `plan-import-error`, `plan-empty`.
- Share the layout (list + preview + import form) between the two dialogs. Information dense; dark cybercore look;
  app CSS owns layout only (kit owns colour). New hook classes must pass `tests/unit/css-classes.test.ts`.
- Client fetch wrappers in `src/ui/agent/agent-api.ts` over `src/ui/edit/api.ts` (`getJson`/`sendJson`, never throw).

## 8. Tests and harness

- `tests/fixtures/agent-home.ts`: `buildAgentHome(dir, {now?, platform?})` writes a fake home with every format
  (Claude: two sessions with ai-title, slash command, tool_use, thinking, a `<script>` text and a relative markdown
  link, plus one session without prompts; Codex: one `.jsonl`, one `.jsonl.zst` with `session_index.jsonl`, one
  archived; Copilot CLI: one session dir with `events.jsonl` + `workspace.yaml` + `plan.md`; VS Code: one `.json`, one
  `.jsonl` mutation log with `workspace.json`; plans: Claude `plans/*.md` x2, Codex `plans/<t>/<turn>/PLAN.md`) with
  explicit, distinct mtimes (`utimesSync`) so every order is deterministic. It derives the paths from `agentRoots`.
- `tests/unit/setup.ts` pins `CTXMAN_AGENT_HOME` to an empty temp dir (restored after), so no test reads the real
  home. Unit tests for roots, each parser, listing/paging/filter/q, markdown (escaping, links, headings, truncation),
  plans, `createDocFile`, the imports, and the PURE UI helpers.
- e2e: `tests/e2e/server.ts` builds `w<N>/agent-home` with `buildAgentHome` and passes `CTXMAN_AGENT_HOME`;
  `tests/prod-smoke.ts` passes an empty temp `CTXMAN_AGENT_HOME` and checks `GET /api/agent-sessions` 200. A spec
  `tests/e2e/agent-import.spec.ts` (own `e2e-*` kb entry made through the API, removed in `afterAll`).

## 9. Docs

AGENTS.md (repo map, routes, API list, env, testing rules), `.env.example` (`CTXMAN_AGENT_HOME`), a new concept
`tests/data/kb/ctxman/concepts/agent-history.md` (+ `index.md` link, dated `log.md` line), `routes-and-api.md`,
`editing.md` (the two buttons). Then `CTXMAN_DATA_DIR=tests/data pnpm run check` at 0/0.

## Out of scope (follow-ups)

MCP tools for listing/importing sessions; Claude Code's custom `plansDirectory`; other VS Code forks (Cursor,
VSCodium); live tailing a running session; subagent (sidechain) transcripts.
