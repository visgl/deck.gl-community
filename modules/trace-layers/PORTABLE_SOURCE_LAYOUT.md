# Trace Layers Portable Source Layout

`modules/trace-layers/src` defines the portable OSS source layout for trace layers. Keep portable
files at these relative paths, and keep the documented OSS-only files below as package additions.

## Portable Source Boundary

The portable source directories are:

- `src/arrow-utils`
- `src/layers`
- `src/loaders`
- `src/react`
- `src/trace`

Keep portable files at the relative imports used in this OSS tree. Do not add `/index` suffixes
inside portable files; the OSS-only emitter barrels below isolate that package build adaptation.

## OSS-Only Source

These files intentionally exist only in this package:

- `src/arrow-utils.ts`
- `src/layers.ts`
- `src/loaders.ts`
- `src/react.ts`
- `src/trace.ts`
- `src/trace/loaders/chrome-trace-loader.ts`
- `src/protobufjs-light-browser.d.ts`
- `src/layers/layers/trace-graph-layer.ts`
- `src/layers/layers/trace-prepared-state-layer.ts`
- `src/layers/layers/trace-store-layer.ts`
- `src/layers/layers/trace-top-level-layers.test.ts`

The emitter barrel files emit package entry modules while leaving portable directory imports
stable. The wrapper layers are public OSS additions and should be adapted when the portable
runtime changes, not removed during source-layout updates.

## OSS Package Adaptations

Keep portable files on this repo's public package names, translated by OSS package ownership:

- infovis primitives and UTF-8 helpers -> `@deck.gl-community/infovis-layers`
- general add-on layers such as dependency arrows -> `@deck.gl-community/layers`
- timeline axis and tick helpers -> `@deck.gl-community/timeline-layers`
- trace layers -> `@deck.gl-community/trace-layers`
- panels -> `@deck.gl-community/panels`
- widgets -> `@deck.gl-community/widgets`

Run Biome after source-layout updates because repository formatting may differ across consumers.
Keep generic panel, widget, layer, timeline, and infovis helpers in their OSS packages rather
than hiding replacements inside trace-layers or copying existing OSS surfaces into another
package.

## Example Boundary

Keep the portable Tracevis demo logic under `examples/trace-layers/tracevis` at these relative
paths:

- `components/infovis-primitives.tsx`
- `components/tracevis-main-view.tsx`
- `examples`
- `lib`
- `tracevis-store.tsx`
- `widgets`

The Vite shell, public README, and `components/tracevis-panel.tsx` are OSS-local adaptations. Keep
focused demo tests in OSS and run the examples Vitest project so example regressions are caught
before the example build.

## Maintenance Checklist

Before opening a PR that changes the portable source layout:

- compare portable source and demo file sets, allowing only the OSS-only files listed above
- run `node scripts/check-trace-layers-portable-source-structure.mjs --candidate-trace-layers <path> --candidate-demo <path>`
  against another consumer tree when one is available
- verify OSS package import substitutions
- preserve `DeckTraceGraphConfig` naming in OSS APIs and docs
- grep source, docs, examples, and PR text for leakage terms
- run lint, tests, builds, example builds, website build, and `git diff --check`
