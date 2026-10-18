---
type: Root Cause Analysis
name: node-strip-types-enum-crash
title: Node strip-types enum crash
description: A TypeScript enum crashed a script with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX because Node 24 strips types but does not compile them.
tags: [node, typescript, scripts]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:50:00Z
---

# Node strip-types enum crash

A script that used a TypeScript `enum` failed immediately when run with `node script.ts`:

```text
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
```

## Summary

ctxman scripts run directly under Node 24 with no build step. Node removes type annotations ("type stripping") but does not transform syntax that has runtime meaning. An `enum` generates code, so it is rejected.

## Timeline

1. Toolchain verification ran a probe script that imported shared modules under `src/`, in plain Node 24.
2. A probe using an `enum` failed with the error above; the same file with a union type ran cleanly.
3. `erasableSyntaxOnly` was turned on in `tsconfig.json`, and the rule was written into the shared coding rules.

## Root cause

Node's strip-only mode replaces types with whitespace and leaves the rest untouched. It cannot emit helper code, so any construct that needs emitted code is a syntax error. TypeScript's own compiler would have accepted the file, which is why the problem only showed up at run time and not in an editor.

## Resolution

Replace the enum with an `as const` object or tuple and derive the union type:

```ts
export const STATES = ['pending', 'in-progress', 'complete'] as const;
export type State = (typeof STATES)[number];
```

The dataset registry uses this pattern for every list of states.

## Prevention

* `erasableSyntaxOnly` makes TypeScript report error TS1294 for enums, namespaces with values, parameter properties and similar constructs, at typecheck time instead of at run time.
* Relative imports always carry their `.ts` extension, because Node does not resolve extensionless specifiers.
* The full list of allowed and forbidden constructs is in [Erasable syntax rules](./concepts/erasable-syntax.md).
* Scripts and the modules they import must stay free of `astro:*` imports; see [Architecture](ctxman:kb/ctxman).
