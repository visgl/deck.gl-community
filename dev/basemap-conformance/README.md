# basemap-conformance

Test-only code shared by harnesses that score a basemap renderer against MapLibre GL JS. It is a
private workspace: never published, no runtime dependencies, no build.

| File | What it is |
| --- | --- |
| `src/maplibre.ts` | The reference renderer: `renderMapLibreScene` draws a style with MapLibre GL JS and reads back the text of every label it placed. MapLibre and its style specification package are passed in, so each harness renders with its own pinned copy. |
| `src/metrics.ts` | SSIM, edge detection and edge F-score, label recall and precision, and the baseline checks. Plain functions over pixel arrays, tested in Node (`src/metrics.spec.ts`). |

Neither file imports anything, so a harness can import them by path. basemap-layers' reference
render harness (`modules/basemap-layers/tests/reference-render`) uses both.
