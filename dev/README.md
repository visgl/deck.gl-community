# dev/

This directory holds content that is **not** part of production builds or the public documentation site:

- **`rfc/`** — Design RFCs and architectural proposals
- **`wip/`** — Work-in-progress module stubs, experiments, and half-finished features
- **`examples-wip/`** — Exploratory examples not yet ready for publication

## Why a separate `dev/` directory?

Files inside `docs/` are indexed by the documentation site's search engine, which can surface outdated or incomplete content to users. Keeping WIP and RFC content here avoids that noise while still preserving it in the source tree for maintainers and contributors.

## RFCs

Design RFCs for individual modules live in `rfc/`. Prefer using GitHub Issues or Pull Requests for new proposals so that commenting and linking is easier, but historical RFCs with architectural rationale can be preserved here.

See also: [deck.gl-community issues](https://github.com/visgl/deck.gl-community/issues) for active roadmap discussions.
