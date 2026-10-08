# TreeLayer geographic streaming

`TreeLayer` accepts either supplied `data` rows or an abortable `getTileData` inventory. Both modes share the same top-level tree accessors and renderer. An internal tile component streams geographic pages and batches visible trees. `WorldTreeLayer` is a deprecated compatibility wrapper for earlier callers. Nearby trees retain connected wood and full leaf templates; unresolved distant groups use overlapping three-dimensional Gaussian crowns. Geographic packets manage requests and cache residency internally. There are no ground polygons or visible packet rectangles.

```ts
import {TreeLayer} from '@deck.gl-community/layers';

new TreeLayer({
  id: 'world-trees',
  maxZoom: 20,
  getTreeKey: tree => tree.id,
  getTileData: async ({index, signal}) => {
    const response = await fetch(`/trees/${index.z}/${index.x}/${index.y}.json`, {signal});
    if (!response.ok) throw new Error(`Tree source ${response.status}`);
    return response.json(); // {byteLength, trees: [...], canopies: [...]}
  },
  getPosition: tree => tree.position,
  getTreeType: tree => tree.species,
  getHeight: tree => tree.height,
  windStrength: 0.025,
  foveationStrength: 1
});
```

A source must partition the inventory spatially and prepare distant representations. Only requested source pages are generated or decoded. A global count alone cannot reconstruct real tree locations or species.

## Source contract

`getTileData` receives deck.gl's geographic index, bounds and abort signal. Return `TreeTileData<DataT>` with bounded `trees`, `canopies` and decoded `byteLength`. Each `TreeCanopyCluster` contains geographic `position`, positive `[width, depth, crownHeight]` in metres, RGBA `color`, and integer `treeCount`. Counts are metadata and never expand into client arrays. Keep crown height physical rather than scaling tree height with geographic packet size. Provide individual rows wherever trunks and separate crowns are resolvable.

Declared bytes must include nested data and retained buffers. Bound encoded responses and decoding work in the adapter too; validation after decoding cannot retroactively limit a response. Source refinement should preserve individual tree positions and replacement coverage. Supply `getTreeKey` for rows representing the same tree and pose across source levels. Changing `getTreeKey` or its update trigger rebuilds identity grouping immediately. Matching identities share one rendered owner during replacement and retain it after the old page retires; use different identities when geometry changes incompatibly. `transitionDuration` defaults to 800 ms. Loaded outgoing and incoming crowns blend optical depth, and wood uses complementary coverage anchored in tree space. `isLoaded` becomes true after request loading and the visual transition settle. Set the duration to zero for instantaneous replacement.

Use ordinary top-level tree accessors for species, season, crops, connected wood, wind and picking. Set `foveationStrength: 1` to prioritize central detail: actual projected crown centers smoothly prioritize central detail without removing peripheral trees. Light-map refinement remains independent. Distant groups have simplified crown silhouettes; they do not contain individual branches, fruit or cast individual-tree shadows. `getDistantCanopyColor` updates their seasonal tint, and `windStrength` bends their stable templates. These are distant approximations; inspect individual TreeLayer rows for botanical detail.

## Budgets

| Property | Default | Behavior |
| --- | ---: | --- |
| `maxVisibleTiles` | 32 | Bound internal requests while prioritizing nearby footprints; retain coverage of every requested region. |
| `maxTileRecords` | 1024 | Maximum combined individual-tree and distant-crown records in one decoded page. |
| `maxTileByteLength` | 1 MiB | Maximum declared decoded page bytes. |
| `maxCanopySplats` | 250,000 | Shared Gaussian quota across distant crowns and individual species. |
| `maxShadowSplats` | 125,000 | Independent light-space Gaussian quota. |
| `maxCanopyPixels` | Infinity | Shared accumulation pixel limit; raster resolution remains fixed as geometry quality adapts. |
| `targetFrameTime` | 16.67 ms | Quality feedback with hysteresis. Zero disables feedback for controlled comparisons. |
| `minBudgetScale` | 0.125 | Lowest Gaussian budget fraction selected by feedback. |
| `maxCacheSize` | 64 | Deck cache eviction target. |
| `maxCacheByteSize` | 32 MiB | Decoded cache eviction target; excludes shared renderer/template GPU memory. |
| `maxRequests` | 4 | Concurrent abortable requests. |
| `debounceTime` | 35 ms | Request debounce. |

The `no-overlap` strategy retains loaded parent coverage until replacements are ready. Visual crossfades retain outgoing pages up to twice `maxVisibleTiles`, or the selected page count if greater; rapid retargeting discards the lowest-weight history first. Cache targets exclude neither selected pages nor transition history from residency statistics. Selected/fallback pages may temporarily exceed cache eviction targets. Source bounds, page limits and frontier size must remain finite. This implementation targets `MapView` / Web Mercator; that extent excludes the poles. Camera far-plane settings still determine the visible horizon.

Opaque wood and owner picking retain host resolution. Gaussian accumulation and its opaque occlusion capture can use lower resolution and a linear full-size resolve. Geometry feedback does not resize that target during motion. An explicitly low pixel limit softens leaf edges and reduces branch-occlusion precision. The smallest visible Gaussian pixel limit affects the shared pass, including other Gaussian layers in the same Deck.

The allocator retains every visible owner and spends remaining submissions on projected error reduction. If coarsest coverage exceeds the quota, coverage wins and `streamingStats.coverageFloorExceeded` becomes true. Prepare smaller distant representations in the source to address that floor; do not feed a global inventory into one array.

`budgetExceeded` also reports temporary retained LOD work after a quota reduction. The optical fade retires that work gradually; `coverageFloorExceeded` distinguishes an irreducible owner floor.

`streamingStats` reports cache/frontier counts, decoded bytes, resident page rows (including crossfade history), deduplicated visible trees, distant crown groups, transitioning pages, `refiningCrowns`, selected canopy/shadow submissions and `budgetScale`. After reduced quality reaches stable 60Hz delivery, feedback gently probes higher detail instead of requiring frame intervals shorter than vsync. Feedback targets frame time; it cannot guarantee 60 fps on arbitrary hardware, large canvases, heavy host workloads or cold shader compilation. Measure delivered frame intervals and tail latency on the intended device.


## Example

Streaming sources are supplied by the host. Performance observations depend on hardware, visible crown support and the source workload.

### Shared canopy selection

Near-tree foliage and distant crown groups share one parent Gaussian quota. Nested tree caps
remain effective, and allocation favors projected error reduction across their sources.
Geographic inventory pages retain their TileLayer lifecycle and coverage transitions; they are
separate from Gaussian template assets. `streamingStats` reads SplatLayer's supported counters
and includes actual camera/light submissions and their coarsest coverage floors.

## Compatibility

Existing `WorldTreeLayer` calls still work through a wrapper around the internal tile component.
Migrate to `TreeLayer`, move `treeProps` to the top level, rename the distant group
`getCanopyColor` to `getDistantCanopyColor`, and use `windStrength` for both near and distant trees.
The wrapper preserves its earlier 400,000/50,000 canopy/shadow defaults; canonical `TreeLayer`
uses its normal 250,000/125,000 defaults in both modes. Do not provide nonempty `data` together
with `getTileData`. `streamingStats` is available on the public TreeLayer and reports zero
residency until the inventory child is initialized.
