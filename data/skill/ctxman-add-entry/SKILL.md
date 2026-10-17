---
name: ctxman-add-entry
description: Create a new ctxman dataset entry (kb, rca, idea, task, bug, feature, project, skill, reference or context) with the pnpm add scripts, then fill it in and verify it. Use whenever asked to record an idea, task, bug, feature, project, analysis, note, skill, external reference or context in this repo.
compatibility: Run from the ctxman repository root. Needs Node 24 and pnpm; never use npm.
metadata:
  author: ctxman
  version: "1.0"
allowed-tools: Read Edit Bash(pnpm run add:*) Bash(pnpm run check:*)
---

# Adding a ctxman entry

Every entry is created with a script so its files have the right shape. Use pnpm only.

## When to use

Any time the user wants something recorded in ctxman: "add a task for X", "write up this bug", "note this as knowledge", "save a reference to that repo", "make a context for this work".

## Instructions

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
   | `reference` | a pointer to a local repo, remote repo or remote skill | none |
   | `context` | a reusable set of links to other entries | none |

2. **Pick a name**: lowercase letters, digits and single hyphens, at most 64 characters. It becomes the folder or file name and the slug, and cannot be changed later for a context.

3. **Run the script** from the repo root:

   ```bash
   pnpm run add:task fix-login-redirect --title "Fix login redirect" --description "Users land on the home page after login."
   ```

   Other options: `--state <state>` for lifecycle datasets; for references `--type local-repo|remote-repo|remote-skill`, `--path`, `--uri` (git URI such as `git@github.com:org/repo.git` or `https://github.com/org/repo`; a `remote-skill` may instead use an https `.tar.gz`/`.tgz`/`.zip` URL), `--subpath`, `--owner me|not-me`; `--json` for machine-readable output. Do not add a `--` separator before the flags (pnpm 11 forwards it literally and the script rejects it). The script refuses to overwrite anything that already exists. A reference created without `--path` or `--uri` gets a placeholder location (`~/repos/<name>` or `https://github.com/TODO/<name>.git`) that still passes the checks, so pass the real value or replace it afterwards.

4. **Fill in the generated files.** For OKF datasets edit `main.md` sections, set `tags`, and replace the `TODO:` description. For the OKF details load the skill `okf-authoring`.

5. **Link related entries** with `ctxman:<dataset>/<slug>`, for example `ctxman:feature/context-forge`.

6. **Verify** with `pnpm run check`. It must report zero errors and zero warnings.

## Notes

* The same action is available in the browser at `/tools`.
* Contexts can also be built interactively at `/forge`.
* Background on all datasets: [ctxman](ctxman:kb/ctxman).
