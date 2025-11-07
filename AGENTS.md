# Repository-wide instructions for agents

This file applies to the entire `deck.gl-community` repository. Directories may add more specific guidance in their own `AGENTS.md` files.

## Tooling
- Use the Yarn 4 workspace that ships with the repo. Install dependencies with `yarn` and run scripts via `yarn <script>` from the repo root. See `package.json` for the canonical script list.
- Prefer TypeScript and ES module syntax when authoring source files. Most packages ship dual ESM/CJS bundles via build tooling defined per workspace package.
- if any dependencies are changed, the yarn.lock file must be rebuilt by running `yarn` in the root before committing.

## Quality gates
Before committing JavaScript/TypeScript changes:
- Run `yarn build` and fix any TypeScript build errors.
- Run `yarn lint-fix` and fix any linter errores.
- Run tests using `yarn test` (Node) and `yarn test-headless` and fix any errors by modifying code or tests as appropriate.

## Documentation and release process
- Follow the contribution flow in `docs/CONTRIBUTING.md` before landing breaking changes.
- When adding features, or removing packages or examples, update any related documentation, sidebars, or release notes under `docs/`.
- Run `yarn lint-fix` to ensure that markdown gets formatted before committing.


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

