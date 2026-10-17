---
type: Concept
title: Provenance and lifecycle
description: How OKF records sources, generation, verification, status and expiry.
tags: [okf, provenance, lifecycle]
sources:
  - id: okf-skill
    resource: .agents/skills/okf/SKILL.md
    title: OKF v0.2 authoring skill
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:20:00Z
---

# Provenance and lifecycle

All of these fields are optional. Omit anything you cannot back with evidence.[^okf-skill]

## Sources and claims

`sources` lists material a concept derives from. Each item needs `resource` (URL, internal path or scope descriptor); give it a stable `id` when the body cites it. Attribute a single claim with a footnote keyed to that id, never to a list position:

```markdown
This policy applies to recognized revenue.[^okf-skill]

[^okf-skill]: OKF v0.2 authoring skill
```

For lineage between internal concepts, use ordinary links.

## Generation and verification

```yaml
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:20:00Z
verified:
  by: human:alex
  at: 2026-10-17T12:00:00Z
```

If `generated` exists, both `by` and an ISO 8601 `at` are required. `verified` takes the same two keys, or a list of such mappings. Actors are spelled `<producer>/<version>`, `human:<id>` or `process:<id>`. The `human:` prefix is what marks content as human-reviewed.

## Status and expiry

* `status` is `draft`, `stable` or `deprecated`. Omitted means stable.
* `stale_after` is an absolute `YYYY-MM-DD`. Content is stale on or after that date. ctxman shows a stale badge and lists stale entries on the dashboard.
* `generated.at` records when content changed, not when it was last re-confirmed.

Back to the [overview](/main.md) or on to [Bundle navigation](./navigation.md).

[^okf-skill]: OKF v0.2 authoring skill, vendored at .agents/skills/okf/SKILL.md.
