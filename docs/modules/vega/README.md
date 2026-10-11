import {App as VegaExample} from '../../../examples/vega/unit-layouts/src/example';

# Vega renderer (private experiment)

This private module ports Microsoft's MIT-licensed SandDance Vega renderer to deck.gl 9.4. Vega JSON creates a scene graph that the renderer turns into deck.gl layers, including animated cuboids.

## Attribution and upstream project

This module builds on [SandDance](https://github.com/microsoft/SandDance), created by
[Microsoft Research's Visualization and Interactive Data Analysis (VIDA) group](https://www.microsoft.com/en-us/research/project/sanddance/).
The Vega-to-deck.gl renderer, scene staging, cuboid rendering, and animated unit-visualization
approach come from that upstream work; this community experiment adapts them to current vis.gl APIs.

Special thanks to **[Dan Marshall](https://github.com/danmarshall)** for his engineering work on
SandDance and its open-source visualization components. See his Microsoft Research project update,
[What's new in SandDance 3](https://opensource.microsoft.com/blog/2020/06/23/whats-new-sanddance-3-microsoft-research/).
We also credit **Steven Drucker and Roland Fernandez** for the foundational animated unit-visualization
research, and **Deokgun Park and Niklas Elmqvist**, with Drucker and Fernandez, for the ATOM grammar research.
See the [SandDance project website and publications](https://microsoft.github.io/SandDance/).

- [SandDance source repository](https://github.com/microsoft/SandDance)
- [Original Vega/deck.gl renderer at the imported revision](https://github.com/microsoft/SandDance/tree/5f2c1e58467b9417bd626f0ef404bd3bda11f068/packages/vega-deck.gl)
- [Upstream MIT license](https://github.com/microsoft/SandDance/blob/5f2c1e58467b9417bd626f0ef404bd3bda11f068/LICENSE)

Microsoft Corporation's MIT license and original source copyright notices are retained.
The cube-layer shader code also retains the MIT notice crediting Uber Technologies.
This is an independent deck.gl-community experiment; it is not an official Microsoft or SandDance release.

## Animated record layouts

Each cube below represents one of 180 records. Switch between **Grid**, **Scatter**, and **Grouped stacks** to see the same records move and resize. Enable **3D view** to orbit the extruded cubes. Position and size transitions take 1.2 seconds.

<VegaExample />

The example preserves identity with `onSceneRectAssignCubeOrdinal: datum => datum.id` and changes a Vega `layout` signal on the existing `ViewGl`. Keeping the view alive lets deck.gl interpolate attributes between layouts. Configure animation with `presenterConfig.transitionDurations` (`position`, `size`, `color`, and `view`, in milliseconds).

This demonstrates the renderer's transitions rather than the full SandDance application: chart recommendation, filtering, selection UI, and the SandDance specification builder are outside this initial port. The module requires WebGL2 and is private and unpublished.

The same example runs locally with `yarn vite modules/vega/demo --host 127.0.0.1 --port 5199`. See `modules/vega/README.md` for the API and `modules/vega/UPSTREAM.md` for source attribution.
