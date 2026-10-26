# basemap-conformance

A renderer-neutral, hermetic conformance harness for basemap renderers. One corpus of scenes (a
MapLibre style, a camera, and the recorded tiles, glyphs and sprites they need), one set of
metrics, any number of renderers. MapLibre GL JS is the reference. Every other renderer is scored
against it on SSIM, edge F-score, and label recall and precision. The harness only reports. It
fails nothing on a score.

This is a private, test-only workspace: never published, no runtime dependencies, no build. It
grew out of basemap-layers' reference-render harness (`modules/basemap-layers/tests/reference-render`),
which still imports its metrics and its MapLibre reference renderer from here.

## Layout

```
src/types.ts           ConformanceScene, ConformanceRender, ConformanceRenderer, SavedRender
src/scenes.ts          STYLES and SCENES (the corpus catalog), VIEWPORT, selectScenes
src/browser.ts         loadConformanceStyle, runConformanceScene, canvas and timeout helpers
src/maplibre.ts        the reference renderer, with placed-label read-back (MapLibre is injected)
src/metrics.ts         SSIM, edge detection and F-score, label scores, baseline checks
src/panels.ts          SSIM-map and edge-overlay panels as RGBA arrays
src/fixture-server.ts  Vite plugin: fixture server, recorder, request log, output sink (Node)
scripts/score.ts       the scorer: report.md, scores.json and comparison images (Node)
fixtures/              recorded fixtures of the corpus, as <host>/<path>
__output__/            renders and reports (ignored by git)
```

The browser files import nothing outside this directory: not vitest, deck.gl or MapLibre. A
runner in another checkout can therefore import them by path without loading a second copy of any
dependency. Each runner brings its own test framework, its own renderer and its own MapLibre.

## The interface

```ts
type ConformanceRenderer = {
  id: string;                       // output directory and report column
  name: string;                     // for the report, with version
  supports(scene): boolean;         // e.g. only the styles the renderer can map
  render(scene, style): Promise<{
    pixels: Uint8ClampedArray;      // RGBA, 512 x 512, composited on white
    width: number; height: number;
    labels: string[] | null;        // placed label texts; null = cannot tell (label metrics n/a)
    labelNote?: string;
    problems: string[];             // anything that invalidates the measurement
    meta?: Record<string, unknown>; // durations, device, ...
  }>;
};
```

`style` is the scene's MapLibre style JSON, already resolved against the fixture server: the
TileJSON is inlined, and the tile, glyph and sprite URLs are rewritten. A renderer that does not
read MapLibre styles maps the style to its own input, or takes only what it needs from it (the
tile URL template, say), and declines the styles it cannot map with `supports`.

`runConformanceScene(renderer, scene)` loads the style, renders the scene and saves
`__output__/<renderer>/<scene>.png` and `.json`. The JSON holds the labels, the problems, the
fixture requests the server saw and any fixtures it could not serve. A runner fails a test only
when a render is invalid, that is, when it has problems or missing fixtures. A score never fails a
test.

## Hermeticity

- The fixture server is a Vite middleware. It is the only place that serves fixtures, so it sees
  every request from the page and from every worker, whichever loader made it. It logs each request
  and answers a missing fixture with a 404, never with the HTML fallback. It sends
  `Cache-Control: no-store`, so the browser cache cannot hide a request from the log.
- Chromium is launched with `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`
  (`HERMETIC_CHROMIUM_ARGS`). Any request that would leave the machine fails, from the page or from
  a worker alike. The flag is set in record mode too, because the recorder downloads from Node, not
  from the browser.

## Running

basemap-layers' runner (`modules/basemap-layers/tests/conformance/basemap-layer.conformance.ts`,
with `vitest.conformance.config.ts`) renders every scene with MapLibre (the reference) and with
`BasemapLayer`. It needs the packages built (`yarn build`) and Chromium (`yarn playwright:install`):

```sh
yarn test-conformance
VITE_CONFORMANCE_SCENES=paris-streets-z13.3,ofm-liberty yarn test-conformance
```

Then score everything the runners have saved:

```sh
yarn conformance-report
```

The scorer writes `__output__/report.md`, `scores.json` (which adds the missing and extra labels
per scene and candidate), `images/<scene>.png` (all renderers side by side, the reference first)
and `images/<scene>--<renderer>.png` (reference, candidate, SSIM map, edge overlay). CI runs both
steps in the `basemap-conformance` job, outside the required `test-headless` check, and uploads
`__output__` as the `basemap-conformance` artifact. Neither step can fail the job.

## Using it from another repository

A renderer that lives in another repository scores itself against the same corpus in the same way:

1. Check out this repository at a pinned commit next to its own (in CI, a second
   `actions/checkout` of `visgl/deck.gl-community` with a `path:`), and import
   `dev/basemap-conformance/src/index.ts` and `src/fixture-server.ts` by path. No package is
   installed: the browser files import nothing, and the fixture server imports only `node:` modules.
2. Implement `ConformanceRenderer` for its renderer. Draw at `VIEWPORT` (512 x 512) at device pixel
   ratio 1. Wait until tiles, placement and fades have settled, then read the canvas with
   `readCanvas`. Read back the text of every label drawn after collision. If the renderer cannot
   report them, return `labels: null` and give the reason in `labelNote`.
3. Add `conformanceFixtureServer({fixtureRoots: [<checkout>/dev/basemap-conformance/fixtures,
   <checkout>/modules/basemap-layers/tests/reference-render/fixtures], outputDirectory})` and
   `HERMETIC_CHROMIUM_ARGS` to a Vitest browser config, and call `runConformanceScene` from a test
   for each scene that the renderer `supports`.
4. Render the reference in the same run with `createMapLibreRenderer({maplibregl, styleSpec})`
   from its own pinned MapLibre, so that both renders share a browser and a GPU. To cross-check
   it against this repository's reference, give it another id (`maplibre@<repo>`): the scorer
   scores every `maplibre*` directory against `maplibre`.
5. Run `node <checkout>/dev/basemap-conformance/scripts/score.ts <outputDirectory>`.

The fixtures stay here, at one pinned commit, rather than being copied into each repository.

## Recording fixtures

Add or change scenes in `src/scenes.ts`, then run a runner with `CONFORMANCE_RECORD=1`. The
fixture server downloads each fixture that is missing and writes it to the first fixture root.
One run records everything every renderer of that runner requests. Renderers can pick different
tiles (a renderer that loads 512-pixel tiles at the rounded zoom, say), so run each renderer's
runner once in record mode. The network is used only during recording.

The fixture roots are searched in order: `fixtures/` here, then basemap-layers' trimmed
reference-render fixtures. The corpus's own tiles are not trimmed, because a new style can read
source layers and properties that the reference styles do not.

## Fixture licenses

- The tiles are OpenStreetMap data (© OpenStreetMap contributors, ODbL) in the OpenMapTiles schema,
  served by OpenFreeMap (`tiles.openfreemap.org`).
- The glyph ranges are CARTO's SDF ranges (`tiles.basemaps.cartocdn.com`) of the font stack
  `Montserrat Regular, Open Sans Regular, Noto Sans Regular, HanWangHeiLight Regular,
  NanumBarunGothic Regular`, the same stack as basemap-layers' CARTO glyph fixtures. Montserrat,
  Open Sans and Noto Sans are under the SIL Open Font License.
- `styles/tangram-streets.json` is the MapLibre equivalent of tangram.gl's Streets example (MIT):
  the output of `createComparisonStyle('streetsVector', 'mapFlat', 'openfreemap', {labels: true})`
  from tangram.gl's `examples/deck/comparison-style.ts`, serialized to JSON. It holds the Streets
  palette, road grades and widths, and a place-name layer in Montserrat that mirrors Tangram's
  `places` text layer.
- The control scenes read basemap-layers' committed fixtures, which carry their own notes in
  `modules/basemap-layers/tests/reference-render/fixtures.ts`.

## Control scenes

`paris-liberty-z13.3` and `new-york-positron-z14.2` are basemap-layers' reference-render scenes,
rendered by this runner. Their `BasemapLayer` scores match the reference-render harness's, which
shows that the shared runner measures what the original harness measures. On one machine:
paris-liberty SSIM 0.9783 and edge F 0.9915 in both; new-york-positron SSIM 0.9791 in both and
edge F 0.9908 here against 0.9906 there. The small edge difference comes from the fixtures: where
both roots hold a tile, this runner serves the untrimmed copy from `fixtures/`.
