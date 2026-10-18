# OKF bundle checklist

Run through this before finishing work on a bundle.

## Entry file (root `index.md`)

- [ ] Frontmatter starts with `okf_version: "0.2"`.

- [ ] `type` matches the dataset: Knowledge Base, Root Cause Analysis, Idea, Task, Bug, Feature or Project.
- [ ] `name` equals the folder name and is kebab-case.
- [ ] `description` is one sentence and not the `TODO:` placeholder from the template.
- [ ] `state` is present for idea, task, bug, feature and project, and is a valid value for that dataset.
- [ ] `tags` are lowercase kebab-case.
- [ ] Starter sections from the template are filled in or removed.

## Concept files

- [ ] Each has frontmatter starting on line 1 with `---`.
- [ ] Each has a non-empty `type`.
- [ ] Each is listed in the entry `index.md` (`## Concepts`) with a description.

## Provenance and lifecycle

- [ ] `generated` has both `by` and an ISO 8601 `at`, or is absent.
- [ ] Every footnote reference in a file has a matching definition or a `sources` id in that file.
- [ ] `stale_after` is a `YYYY-MM-DD` date, or absent.
- [ ] `status` is `draft`, `stable` or `deprecated`, or absent.

## Navigation

- [ ] Only the bundle-root `index.md` (the entry) has frontmatter; a nested `index.md` has none.
- [ ] `log.md` has no frontmatter, `## YYYY-MM-DD` headings, newest first.

## Links

- [ ] Intra-bundle links start with `/` (bundle root) or `./`, and the target file exists.
- [ ] Links to other entries use `ctxman:<dataset>/<slug>` and the entry exists.

## Commands

```bash
pnpm run check:okf
pnpm run check:links
pnpm run check
```

Zero errors and zero warnings is the target.
