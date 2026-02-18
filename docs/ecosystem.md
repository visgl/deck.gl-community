# Ecosystem

An "awesome list" of projects that use or integrate with [deck.gl](https://deck.gl).
Each project is listed with its current compatibility status against the latest deck.gl release.

:::info
If you have a project that uses deck.gl and would like to add it to this list,
please [open an issue](https://github.com/visgl/deck.gl-community/issues/new) or submit a pull request.
:::

## Community Modules

These modules are maintained in the [deck.gl-community](https://github.com/visgl/deck.gl-community) repository.

| Project | Description | deck.gl Version | Status |
| --- | --- | --- | --- |
| [@deck.gl-community/editable-layers](https://github.com/visgl/deck.gl-community/tree/master/modules/editable-layers) | Editable GeoJSON layers for deck.gl | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/graph-layers](https://github.com/visgl/deck.gl-community/tree/master/modules/graph-layers) | Graph visualization layers | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/layers](https://github.com/visgl/deck.gl-community/tree/master/modules/layers) | Additional community-contributed layers | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/react](https://github.com/visgl/deck.gl-community/tree/master/modules/react) | React components for deck.gl | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/widgets](https://github.com/visgl/deck.gl-community/tree/master/modules/widgets) | UI widgets for deck.gl | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/bing-maps](https://github.com/visgl/deck.gl-community/tree/master/modules/bing-maps) | Bing Maps basemap integration | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/leaflet](https://github.com/visgl/deck.gl-community/tree/master/modules/leaflet) | Leaflet basemap integration | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/infovis-layers](https://github.com/visgl/deck.gl-community/tree/master/modules/infovis-layers) | Information visualization layers | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |
| [@deck.gl-community/timeline-layers](https://github.com/visgl/deck.gl-community/tree/master/modules/timeline-layers) | Timeline visualization layers | 9.2 | ![status](https://img.shields.io/badge/CI-passing-brightgreen) |

## External Projects

These are external projects that integrate with deck.gl. Status badges reflect the outcome of
automated compatibility checks run via CI when deck.gl versions are bumped. See
[#485](https://github.com/visgl/deck.gl-community/issues/485),
[#488](https://github.com/visgl/deck.gl-community/issues/488),
[#495](https://github.com/visgl/deck.gl-community/issues/495) for details.

| Project | Description | Repo | deck.gl Version | Status |
| --- | --- | --- | --- | --- |
| [Viv](http://avivator.gehlenborglab.org/) | Multiscale bioimaging visualization on the web | [hms-dbmi/viv](https://github.com/hms-dbmi/viv) | — | ![status](https://img.shields.io/badge/CI-pending-lightgrey) |
| [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) | GPU-accelerated raster visualization layers | [developmentseed/deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) | — | ![status](https://img.shields.io/badge/CI-pending-lightgrey) |
| [Kepler.gl](https://kepler.gl/) | Geospatial data analysis tool | [keplergl/kepler.gl](https://github.com/keplergl/kepler.gl) | — | ![status](https://img.shields.io/badge/CI-pending-lightgrey) |
| [Flowmap.blue](https://flowmap.blue/) | Flow map visualization tool | [ilyabo/flowmap.blue](https://github.com/ilyabo/flowmap.blue) | — | ![status](https://img.shields.io/badge/CI-pending-lightgrey) |
| [SandDance](https://microsoft.github.io/SandDance/) | Unit visualization explorer by Microsoft | [Microsoft/SandDance](https://github.com/Microsoft/SandDance) | — | ![status](https://img.shields.io/badge/CI-pending-lightgrey) |

## Maintaining this List

The ecosystem projects are tested automatically via the
[ecosystem-check](https://github.com/visgl/deck.gl-community/blob/master/.github/workflows/ecosystem-check.yml) GitHub Actions workflow:

- **Trigger**: The workflow runs on pushes to `master` when `package.json` changes (to detect deck.gl version bumps) and can be triggered manually via `workflow_dispatch`.
- **Badges**: Each project row includes a status badge. Once a project has a standalone example in this repo under `examples/ecosystem/`, the CI workflow will attempt to build it and the badge will reflect the result.
- **Adding a project**: To add a new project, add a row to the table above and optionally create a minimal standalone example under `examples/ecosystem/<project-name>/` that imports the project and deck.gl so the CI can verify compatibility.
