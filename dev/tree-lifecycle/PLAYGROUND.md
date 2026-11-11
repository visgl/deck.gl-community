# Interactive tree field

From the repository root, start the source-based development server:

```sh
yarn vite --config dev/tree-lifecycle/vite.config.ts
```

Open http://127.0.0.1:4393/playground.html. The default field contains 20,000 citrus trees.
The server disables hot reload during benchmark captures. Reload the page after source edits.

## Navigate and edit

- Drag to orbit, Shift-drag to pan, and scroll to zoom.
- Overview, Rows, Tree and Leaf frame the selected tree at different distances. Keys 1–4 do the same;
  F focuses the selected tree.
- Click a crown to select its source tree. The ring marks its ground position.
- Choose Selected tree, Selected row or All trees before changing attributes. Changes affect the
  existing objects, coalesced once per animation frame.
- Life, shape, lean, damage, decay and fruit controls edit tree attributes. Wind, wetness and frost
  apply to the field. Transition duration controls how lifecycle values reach their targets.
- Pause wind freezes the wind clock. Restore selected scope resets attributes for the current scope.
- Auto detail targets 60 fps by adjusting the existing LOD chain, with half-second spacing between
  changes and slower recovery. At a vsync-limited 60 Hz it periodically probes a small quality
  increase, rolls it back if overloaded, and waits before retrying. If maximum bias still exceeds the budget, near residency can fall
  from eight trees to four or two. The readout shows the actual bias and near-tree count.
- Changing Manual LOD bias disables Auto detail; zero requests maximum detail. Re-enabling Auto
  detail resets its budget. Initial loading, camera jumps and isolated CPU spikes are excluded.
- Detail reach defaults to 1.5, keeping detailed crowns 50% farther away. Increase it to extend
  the canopy handoff and background crown detail while retaining the same near-tree budget.
- Open Render diagnostics to see crown markers, the shell and near decisions for a tree, its
  projected width, and the priority of detailed crowns. Option-click a marker or bare ground.
  The planted boundary and ground probe show where the orchard actually ends. Compare with
  shell frustum culling or near geometry compaction bypassed. Save a frame snapshot with
  every cell's decision, the camera, and the shadow window.
- Field setup changes the tree count by reloading the playground.

Loading prepares the botanical templates and shader variants before navigation. The live frame
readout excludes startup; Templates reports one-time CPU setup. Measurements in a browser follow
its display refresh rate and include other work on the machine.

## Renderer

This dev integration combines the existing photoreal leaves, wood and crops near the camera with
crown shells fitted to the same botanical templates in the background. Tree state is shared across
the handoff, and near geometry has a bounded per-tree residency budget. Distant damage is an
approximation. A separate bounded crop pass retains individual fruit across the canopy handoff,
using its actual projected size independently of the automatic leaf budget. The renderer currently
requires WebGL2.

The playground's directional shadow window keeps its scale through small zoom changes and moves in
whole shadow texels as the camera pans. A zoom band change blends the previous map into the new one
over 160 ms. Nearby trees use the same leaf and branch casters across color LODs, with coverage that
follows the near and shell handoff. The inspector shows the map dimensions and metres per texel.

This development playground uses the local TreeLayer source. The benchmark includes the field, shell,
photoreal, standard, and empty scene implementations.

Automatic detail trades blade detail for frame time. Turn it off and set manual bias to
zero when judging maximum fidelity. Report the canvas size, device pixel ratio, bias, and near-tree budget with every performance
measurement. The laptop comparison requires p99 frame time under 16.7 ms and maximum frame time
under 33 ms. Validate the target on the base M1 Air.

## Verify

```sh
yarn vitest run --config dev/tree-lifecycle/vitest.config.ts
yarn tsc --noEmit -p dev/tree-lifecycle/tsconfig-playground.json
yarn node dev/tree-lifecycle/verify-playground.mjs --out /tmp/tree-playground-qa
yarn node dev/tree-lifecycle/verify-field-lod.mjs --out /tmp/tree-field-lod-qa
yarn node dev/tree-lifecycle/field/bench-field.mjs \
  --config 'field:impl=field' --config 'floor:impl=none' \
  --paths overview-hold,pan,orbit-wide,orbit-mid,low-pitch,dive,hold-leaf \
  --runs 3 --out /tmp/tree-field-bench
```

The benchmark reports CPU, drained GPU latency, p99, maximum frame time and startup separately.
The playground check exercises actual controls, edit scopes, near and far source-tree picking,
keyboard navigation, wind pause, and sidebar layout, then saves a JSON report and screenshots.
Use its screenshots to judge the foreground look alongside the performance table. A fast frame
that leaves a foreground shell covering the individual leaves is not an acceptable result.
The LOD check retreats with wheel navigation until the selected crown becomes a shell, then checks
actual crop instances and visible orange pixels while editing its fruit count. It also verifies that
Detail reach changes the live canopy and background crown thresholds. It checks tilted camera
coverage, shadow window alignment, and the inspector's frame export.

The M4 comparison uses p99 CPU time under 6 ms and p99 GPU time under 4 ms above the empty-scene floor.
