# Follow-up packet F1 — DONE 2026-10-17 (all items implemented; kept for history, not maintained)

Source: user request 2026-10-17 (pasted after wave 1).

## F1.1 Remote skill references may point at an HTTPS tarball
- Extend the `reference` dataset variant `remote-skill` so `uri` may be EITHER a git repo URI (https://..., git@host:org/repo.git, ssh://...) OR an HTTPS URL to an archive ending in `.tar.gz`, `.tgz` or `.zip`.
- Add a derived/explicit discriminator for the UI: e.g. `uriKind: 'git' | 'archive'` computed in entry-summary / detail rendering (prefer computing from the URI; do not require authors to set a field). `subpath` keeps meaning "path inside the repo/archive to the skill folder" (empty/null = root).
- Update: `src/datasets/schemas.ts` (zod refinement + error message), `scripts/add-entry.ts` reference template/args + validation, `src/lib/collections-check.ts` if it validates URIs, detail page rendering for reference (show "archive" vs "git" badge), search index body text, `kb/ctxman` concept `datasets.md` + AGENTS.md dataset table, unit tests (schemas + add-entry) and one e2e assertion on the reference detail page.
- Git URIs for BOTH `remote-repo` and `remote-skill` must accept all of: SSH scp-style `git@github.com:meow-sci/catcom.git` (typical for repos the user owns), `ssh://git@host/org/repo.git`, and HTTPS `https://github.com/org/repo.git` or `https://github.com/org/repo` (typical for repos the user does NOT own). Do not use `z.url()`; write one custom `isGitUri(uri)` helper in `src/lib` (pure, unit-tested) and reuse it in the schema refinement, add-entry validation and the UI. Disambiguation for `remote-skill`: an HTTPS URI whose path ends in `.tar.gz`/`.tgz`/`.zip` is an archive; any other accepted git URI form is a git repo.

## F1.2 Seed the user's real entries (data/reference/*.yaml)
remote-repo (all `owner: me`):
| name | uri | description |
|---|---|---|
| catcom | git@github.com:meow-sci/catcom.git | ksa mod for in-game scripting using lua or typescript |
| unscience | git@github.com:meow-sci/unscience.git | ksa mod for a kitchen sink of various ways to hack the game |
| purrtty | git@github.com:meow-sci/purrtty.git | ksa mod for in-game terminal emulator |
| gatOS | git@github.com:meow-sci/gatOS.git | ksa mod for a linux vm integrated with ksa game data and control |
| blasto | git@github.com:meow-sci/blasto.git | ksa mod for ground landing vfx |
| flexo | git@github.com:meow-sci/flexo.git | a static site tool which can build ksa parts and subpart asset mods |

NOTE: the user's paste listed `name: gatOS` for blasto and flexo; that collides with the real gatOS entry (names must be unique) so the repo names are used. Confirm with the user if they object.
Name casing: `gatOS` has an uppercase letter — if the name/slug rule is lowercase kebab, use `gatos` as the slug with `title: gatOS`; otherwise keep `gatOS`. Follow whatever `isValidName` enforces and report which was applied.

remote-skill (`owner: me`):
| name | uri | subpath | description |
|---|---|---|---|
| ksa-modding | https://meow.science.fail/ksa-coffer/downloads/ksa-modding-latest.tar.gz | (root) | KSA modding skill bundle (agentskills.io skill folder) distributed as a tarball |

Acceptance: `pnpm run check` 0 errors/0 warnings; `pnpm run test`; `pnpm run typecheck`; the `/reference` list shows all 7 entries with correct type badges; e2e still green.

## F1.3 Small leftovers from the P8b review
- Add `tests/unit/scripts-exist.test.ts`: every `SCRIPTS[].file` in `src/lib/scripts-allowlist.ts` exists on disk under `scripts/`.
- Flip `data/task/write-agents-md` to `state: complete`, tick its steps, add a dated log.md entry (newest first). Re-run `node scripts/check-all.ts` (0/0) and make sure no e2e spec depended on that task being `in-progress` (grep tests/e2e for `write-agents-md` and `in-progress` counts; adjust the spec's expectations only if it hard-codes them).
- After F1.1/F1.2 land, update the dataset table in `AGENTS.md` and `data/kb/ctxman/concepts/datasets.md` (remote-skill: git URI or HTTPS archive; git URIs accept SSH/scp/HTTPS) and add a `log.md` entry in `kb/ctxman`.

## F1.4 Two real bugs found by the e2e suite (fix + un-fixme the tests)
1. Search widget reopens after a fast close. `src/scripts/shell.ts` has a 300ms fallback after a `[data-search-trigger]` click: if no `search-modal`/`search-input` is in the DOM it does `location.assign(trigger.href)` (`?search=1`). If the user opens then presses Esc within 300ms, the page reloads with the widget open. Fix: make the `ctxman:search-open` CustomEvent `cancelable: true` in shell.ts; the island's listener in `src/stores/search.ts` calls `event.preventDefault()` when it handles it; shell.ts only arms the fallback when `window.dispatchEvent(ev)` returned true (not handled). Then remove `test.fixme` from `tests/e2e/search.spec.ts` "closing the widget within 300 ms of opening it does not reopen it" and make it pass.
2. 404 page shows a trailing slash: `src/pages/404.astro` renders `Astro.originPathname` which reads "/nope/" for GET /nope. Strip a trailing slash (except for "/") before rendering. Remove `test.fixme` from `tests/e2e/smoke.spec.ts` "the 404 page shows the requested path without a trailing slash".
