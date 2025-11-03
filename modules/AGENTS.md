# Modules-specific instructions

This file augments the repository-wide guidelines in `/AGENTS.md` for everything under `modules/`.

## Workspace conventions
- Each subdirectory is a Yarn workspace package (see the root `package.json` workspaces map). Keep entry points consolidated in `src/index.ts` and mirror any public exports in the generated `dist` bundle configs.
- Align TypeScript settings with the local `tsconfig.json`. Prefer updating shared compiler options there instead of sprinkling `// @ts-ignore` in sources.

## Local development
- Run tests for a package via `yarn workspace <package-name> test` or `test-watch` when available.
- Use `yarn build` from the repo root to produce release artifacts for all packages when validating publish readiness.

## Pitfalls and references
- Editable layer APIs rely on the shared `EditableLayer`/`ModeHandler` contract. When changing edit flows, cross-check the developer guide to avoid breaking `onEdit` semantics or cursor handling. See `docs/modules/editable-layers/developer-guide/configuration.md`.
- Graph and geo layer bundles are imported by the docs site through generated sidebars (`docs/modules/*/sidebar.json`). If you add or rename pages or exports, update the corresponding sidebar file so the Docusaurus build does not 404.
