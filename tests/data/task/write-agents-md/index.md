---
okf_version: "0.2"
type: Task
name: write-agents-md
title: Write AGENTS.md
description: Write and maintain the agent guide at the repository root so coding agents know the stack, rules and commands.
state: complete
tags: [docs, agents]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:20:00Z
---

# Write AGENTS.md

## Goal

Create `AGENTS.md` in the project root: concise, precise and accurate instructions on what the repository contains, which technology must be used, which rules to follow, and how to keep the docs current. It must stay short enough that an agent reads all of it.

## Steps

- [x] Outline the sections: what ctxman is, non-negotiable tech rules, repo map, data rules, commands, how to add a dataset, testing rules.
- [x] Fill in the commands from the final `package.json` scripts and check each one runs.
- [x] Describe the data rules (name equals folder, OKF bundle rules, `ctxman:` links, contexts are pointers).
- [x] State the pnpm-only rule and the Node 24 erasable-syntax rules.
- [x] Add a short "keeping docs current" checklist: which files change when a dataset, script or route is added.
- [x] Review against the code once all packets have landed.

## Done when

An agent that reads only `AGENTS.md` can run the dev server, add an entry, run the checks and tests, and knows which rules it must not break. Every command in it has been run once.

Background: [ctxman](ctxman:kb/ctxman) and the failure behind the syntax rules, [node-strip-types-enum-crash](ctxman:rca/node-strip-types-enum-crash).
