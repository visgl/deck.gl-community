# Repository-wide instructions for agents

This file applies to the entire `deck.gl-community` repository. Directories may add more specific guidance in their own `AGENTS.md` files.

## Tooling
- Use the Yarn 4 workspace that ships with the repo. Install dependencies with `yarn` and run scripts via `yarn <script>` from the repo root. See `package.json` for the canonical script list.
- Prefer TypeScript and ES module syntax when authoring source files. Most packages ship dual ESM/CJS bundles via build tooling defined per workspace package.

## Quality gates
- Run `yarn lint` or `yarn lint-fix` before committing JavaScript/TypeScript changes.
- Run the relevant Vitest project: `yarn test` (Node), `yarn test-browser`, or `yarn test-headless` as appropriate for your change.

## Documentation and release process
- Follow the contribution flow in `docs/CONTRIBUTING.md` before landing breaking changes.
- When adding or removing packages or examples, update any related documentation, sidebars, or release notes under `docs/`.
