---
type: Concept
title: Bundle navigation
description: Link forms, index.md structure and log.md structure in an OKF bundle.
tags: [okf, navigation, links]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:25:00Z
---

# Bundle navigation

## Links

A concept's id is its bundle-relative path without `.md`. Relationships between concepts are standard Markdown links, and the surrounding sentence gives the meaning. Prefer bundle-root links such as the one to [Provenance and lifecycle](/concepts/provenance.md); relative links such as [the overview](../main.md) are also valid.

Path-valued fields (`resource`, `sources[].resource`) accept an absolute URL, a bundle-relative path or a relative path.

## index.md

An optional navigation file. The bundle-root index may declare `okf_version: "0.2"`; every other index has no frontmatter. The body groups links under headings and gives each target's description:

```markdown
# Concepts

* [Provenance and lifecycle](/concepts/provenance.md) - How OKF records sources and expiry.
```

A missing index is conformant. ctxman warns anyway and its add script always writes one.

## log.md

An optional update history, newest first, under ISO date headings (`## 2026-10-17`). Entries may start with a bold action label such as Create, Update or Add. ctxman errors on non-date headings and warns when dates are not strictly newest-first.

## references/

By convention a `references/` folder holds mirrored external material or run instructions. It has no special semantics.

See also [OKF format](/main.md) and [Provenance and lifecycle](./provenance.md).
