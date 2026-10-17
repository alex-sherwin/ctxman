---
type: Reference
title: Erasable syntax rules
description: Which TypeScript constructs may appear in code that Node 24 runs directly.
tags: [typescript, node, rules]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:55:00Z
---

# Erasable syntax rules

Applies to every `.ts` file in the repo, because scripts, tests helpers and shared libraries are all loaded by Node without compilation.

| Construct | Allowed | Use instead |
| --- | --- | --- |
| Type annotations, interfaces, type aliases | Yes | n/a |
| `import type` | Yes | n/a |
| `enum` | No | `as const` object or tuple plus a union type |
| `namespace` or `module` with values | No | plain modules and exports |
| Constructor parameter properties (`constructor(private x)`) | No | declare the field, assign in the constructor body |
| `import x = require()` | No | `import x from` |
| Legacy decorators | No | plain functions |

Other rules:

* Relative imports include the extension: `./yaml.ts`, never `./yaml`.
* Type-only imports use `import type`, enforced by `verbatimModuleSyntax`.
* `.ts` files never import `.astro` files.

How this failure was found: [Node strip-types enum crash](/main.md).
