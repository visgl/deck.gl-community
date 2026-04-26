# Repository-wide instructions for agents

This file applies to the entire `deck.gl-community` repository. Directories may add more specific guidance in their own `AGENTS.md` files.

## Tooling
- Use the Yarn 4 workspace that ships with the repo. Install dependencies with `yarn` and run scripts via `yarn <script>` from the repo root. See `package.json` for the canonical script list.
- Prefer TypeScript and ES module syntax when authoring source files. Most packages ship dual ESM/CJS bundles via build tooling defined per workspace package.
- if any dependencies are changed, the yarn.lock file must be rebuilt by running `yarn` in the root before committing.

## Quality gates
- Run `yarn lint` or `yarn lint-fix` before committing JavaScript/TypeScript changes.
- Run the relevant Vitest project: `yarn test` (Node), `yarn test-browser`, or `yarn test-headless` as appropriate for your change.
- When asked to "get ready for merge", do the full merge-readiness pass:
  - TSDoc the public API surface affected by the change
  - do a documentation pass, including `docs/whats-new.md` and any relevant upgrade or migration guide content
  - run `yarn` in the repo root so workspace metadata and `yarn.lock` are up to date, especially after any `package.json` changes
  - run the build
  - install website dependencies and build the website with `yarn install` followed by `cd website; yarn build`
  - run `yarn lint-fix`
  - run the relevant tests for the changed packages, examples, and website/docs wiring
  - prepare a copyable Markdown pull request description based on the branch diff compared to `master`

## Documentation and release process
- Follow the contribution flow in `docs/CONTRIBUTING.md` before landing breaking changes.
- When adding or removing packages or examples, update any related documentation, sidebars, or release notes under `docs/`.
- **Publishing:** Use `yarn publish-prod` (production) or `yarn publish-beta` (pre-release) to version packages. These run `ocular-publish version-only-prod` / `version-only-beta` which bump versions and create git tags. The actual NPM publish is handled by the `release` CI workflow, which triggers on `v*` tags pushed to `master` or `*-release` branches.

## Code style

Formatting and linting are enforced by Biome via `yarn lint` / `yarn lint-fix`.

**Biome formatter rules** (`biome.jsonc`):
- Print width: 100
- Semicolons: yes
- Single quotes: yes
- Trailing commas: none
- Bracket spacing: no (`{a}` not `{ a }`)

**Guidelines:**
- Run `yarn lint-fix` before committing
- Do NOT reformat files you are not otherwise changing
- Keep formatting changes in separate commits from logic changes

## Naming conventions

- Typescript functions use verb-noun, in camelCase.
- Typescript variables use camelCase
- Typescript types use PascalCase
- Typescript constants use UPPER_CASE
- File names use kebab case. Typically corresponding to the name of the main export in that file. Example: `export class StyleEngine` => `style-engine.ts`

## Dependencies

- Generally we want to be restrictive with external dependencies, unless they provide a major capability and not just some minor utilitiy.
- vis.gl ecosystem dependencies are acceptable, as long as they respect the layering of those frameworks (a math library should not include luma.gl or deck.gl for instance).
- For math use math.gl modules. Do not introduce d3-extents or similar to save just a few lines
- Try to avoid lodash dependencies.
