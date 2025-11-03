# deck.gl-community Repository Guide

Welcome to the **deck.gl-community** monorepo. This file provides high-level context, workflow reminders, and repository-wide expectations for contributors and AI agents working in this codebase.

## Repository layout

- `modules/` &mdash; Published community-maintained modules. Code here must meet the repo's TypeScript, lint, testing, documentation, and changelog standards before merging.
- `modules-wip/` &mdash; Incubation space for experimental community packages that are not yet ready for release. Use this directory for early prototypes or large refactors that still require iteration before they can graduate into `modules/`.
- `examples/` &mdash; Production-ready runnable examples that showcase modules. These are kept in sync with published packages and should build without additional manual steps beyond workspace bootstrap.
- `examples-wip/` &mdash; Scratch space for works-in-progress demos. When an example is stable and documented, move it into `examples/`.
- `docs/` &mdash; Source for published documentation. Changes here usually accompany feature work in `modules/` and must follow the documentation guidelines referenced below.
- `docs-wip/` &mdash; Draft documentation or staging content. Promote into `docs/` once copy and assets are ready.
- `website/` &mdash; The deck.gl-community marketing and documentation site. Keep dependencies aligned with the workspace and coordinate large updates with the docs maintainers.
- `scripts/` &mdash; Shared build, release, and maintenance utilities used across the monorepo.

Additional folders such as `dev-docs/`, `test/`, and root-level configs (.eslintrc.cjs, tsconfig.json, etc.) provide developer documentation, shared tests, and tooling configuration.

## Standard workflows

All development assumes Node.js ≥16 and Yarn (Berry, see `packageManager` in `package.json`).

1. **Install and link workspace dependencies**
   ```bash
   yarn bootstrap
   ```
   This runs `ocular-bootstrap` to install root and workspace packages, linking modules into examples.

2. **Run lint**
   ```bash
   yarn lint
   ```
   Use `yarn lint-fix` to automatically apply safe fixes. These commands invoke the repo-wide ESLint configuration from `.eslintrc.cjs`.

3. **Execute tests**
   ```bash
   yarn test        # alias for yarn test-node
   yarn test-node   # vitest node environment
   yarn test-browser
   yarn test-headless
   ```
   Choose the environment(s) appropriate for your change. Module packages often expose additional scripts (e.g., `yarn test`, `yarn build`, `yarn start-local`) inside their own directories; consult each package’s `package.json` for details. Examples typically provide `yarn start` and `yarn start-local` commands for local development (see `CONTRIBUTING.md`).

Before opening a PR, ensure lint and relevant tests pass. Coordinate CI additions with the maintainers if you introduce new tooling.

## Coding and documentation expectations

- **TypeScript and linting** &mdash; Follow the shared ESLint/Prettier rules defined in `.eslintrc.cjs` and `.prettierrc`. The authoritative configuration is maintained in `@vis.gl/dev-tools`; avoid overriding rules without discussion.
- **Type safety** &mdash; Prefer strict typings. If you must use `any` or suppressions, leave TODOs and rationale so they can be tightened later.
- **Documentation** &mdash; Public APIs require updates in `docs/` (or `docs-wip/` while drafting) and the website where relevant. Follow the structure of existing guides and reference materials.
- **Changelog** &mdash; User-facing changes to stable modules, examples, or documentation should add an entry to `CHANGELOG.md` under the upcoming version heading. For WIP modules/examples, document progress in their local README until they graduate.
- **Testing** &mdash; Add or update tests in `test/` or the relevant module/example folder. Prefer Vitest for unit/integration coverage.

Refer to `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and the vis.gl [developer process](https://github.com/visgl/tsc/tree/master/developer-process) for authoritative policies.

## Modules, examples, and publishing guidance

- Start new community packages in `modules-wip/`. Once the API, tests, docs, and examples are ready, move the package into `modules/` via a dedicated PR, updating import paths and build scripts.
- Keep `modules/` changes backwards-compatible whenever possible. Breaking changes require TSC review and clear documentation.
- Update examples alongside module changes. Production examples live in `examples/` and should continue to run after `yarn bootstrap`. Experimental demos belong in `examples-wip/` until stabilized.
- Before publishing a community module, verify lint/tests across the workspace, refresh docs/examples, and coordinate releases using the scripts in `package.json` (`yarn publish-beta` / `yarn publish-prod`). Release branches should also update `CHANGELOG.md` and any relevant release notes.

## AI agent expectations

- Always search for and read every applicable `AGENTS.md` file before editing files in its scope. Nested instructions override parent guidance.
- Do not modify git submodules or external dependencies without explicit maintainer review.
- Follow repository security and governance policies; when uncertain, escalate rather than guessing.
- Keep PRs focused, documented, and accompanied by passing lint/tests.

Thank you for contributing responsibly to deck.gl-community!
