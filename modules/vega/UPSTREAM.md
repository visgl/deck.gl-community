# Upstream provenance

- Repository: [microsoft/SandDance](https://github.com/microsoft/SandDance)
- Commit: `5f2c1e58467b9417bd626f0ef404bd3bda11f068`
- Imported component: `packages/vega-deck.gl/src` (package version 3.3.6).
- Additional imported types: `packages/chart-types/src/view.ts`.
- License: MIT, copyright Microsoft Corporation; retained in `LICENSE` and
  upstream source headers.
- Cube layer and shaders contain Uber Technologies' MIT notice, retained in
  those source files.

Community modifications migrate public deck.gl types/imports, Device/Model
resource handling, uniform buffers and GLSL 300 ES, initialize dependencies as
ES modules, remove obsolete injected dependency/typings packages, use local
chart-view types, and add private-workspace guards and regression coverage.

Vega is BSD-3-Clause and remains a dependency, rather than copied source.
Other upstream runtime dependencies retained for this first port are d3-color,
d3-ease, deepmerge, and tsx-create-element. No upstream datasets, branding,
compiled bundles, or Explorer UI have been imported.

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
