# Documentation subtree instructions

See `/AGENTS.md` for shared repo policies. This file covers Markdown under `docs/` that feeds the Docusaurus site in `website/`.

## Authoring conventions
- Prefer Markdown (`.md`/`.mdx`) with Docusaurus front matter when adding new pages. Reuse existing heading structures where possible for consistent slug generation.
- Update the relevant `sidebar.json` file alongside new pages so navigation stays in sync with content.

## Local preview
- Run `yarn --cwd website start` to preview documentation changes with live reload.
- Use `yarn --cwd website build` to catch broken links, missing front matter, or sidebar issues before publishing.

## Pitfalls and references
- Doc IDs become route segments—renaming files requires matching updates in `website/src/docs-sidebar.js`. Missing updates will break the docs navigation during deploy.
- Follow the contribution expectations in `docs/CONTRIBUTING.md` when introducing new guides or major content revisions.
