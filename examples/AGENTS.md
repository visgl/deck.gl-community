# Examples subtree instructions

This file supplements `/AGENTS.md` for everything under `examples/`.

## Running examples
- Each subfolder is a Yarn workspace (see the root `package.json`). Start an example with `yarn workspace <example-name> start`.
- Use the optional `start-local` script (when defined) to alias workspace modules through `examples/vite.config.local.mjs` for rapid iteration against local package changes.

## Authoring conventions
- Keep example entry points in `src/example.tsx` (or `index.tsx` for legacy folders) and export an `App` component so the website embedding utilities can import it.
- Mirror new examples in `website/src/examples-sidebar.js` to make them visible on the docs site.

## Pitfalls and references
- The local Vite config warns that `editable-layers/editor` cannot be run with `start-local` because it loads two React copies. See the note in `examples/vite.config.local.mjs` and fall back to the regular `start` script for that case.
- Publishing guides for editable-layer scenarios live in `docs/modules/editable-layers/developer-guide/get-started.md`; follow them to keep example props consistent with the documented API.
