# Update log

## 2026-10-17
* **Update**: Documented the reference URI rules in [Datasets](/concepts/datasets.md): `remote-repo` takes git URIs (SCP-style SSH, `ssh://`, HTTPS with or without `.git`); `remote-skill` takes a git URI or an HTTPS `.tar.gz`/`.tgz`/`.zip` archive, shown as a `git` or `archive` badge.
* **Add**: Added [Runtime modes](/concepts/runtime-modes.md), [Routes and API](/concepts/routes-and-api.md) and [Adding entries](/concepts/adding-entries.md).
* **Update**: Extended [Datasets](/concepts/datasets.md) with the cross-entry link syntax.
* **Update**: Checked every concept against the built app; corrected [Architecture](/concepts/architecture.md) (four `src/lib` kinds, layout), [Routes and API](/concepts/routes-and-api.md) (doc route, status codes, response shapes) and [Adding entries](/concepts/adding-entries.md) (reference placeholders, no `--` separator before flags).

## 2026-10-16
* **Create**: Created [ctxman](/main.md) with the architecture, datasets, forge, search and checks concepts.
