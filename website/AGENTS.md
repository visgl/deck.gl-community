# Website subtree instructions

This file layers on top of `/AGENTS.md` for the Docusaurus app under `website/`.

## Commands
- Start the dev server with `yarn --cwd website start`.
- Build static assets via `yarn --cwd website build`; CI uses `scripts/build.sh` to include gallery assets and worker transpilation.
- Run `yarn --cwd website write-heading-ids` after adding new Markdown headings so generated anchors stay stable.

## Authoring notes
- The docs sidebar is defined in `docs/table-of-contents.json` and loaded by `src/docs-sidebar.js`. The example sidebar is defined in `src/examples-sidebar.js`. Keep entries sorted and ensure new routes map to actual Markdown or example exports.
- Embed interactive examples by importing from `examples/*`—ensure those examples expose an `App` export per the guidance in `examples/AGENTS.md`.

## Pitfalls and references
- The staging/prod build script (`scripts/build.sh`) validates tokens and rebuilds gallery bundles; keep it in sync if you change build steps so deploys do not miss assets.
- Docs navigation relies on document IDs in `docs/table-of-contents.json`. When you rename or move docs, update the mappings here and in the docs sidebars to avoid broken links during deployment.
