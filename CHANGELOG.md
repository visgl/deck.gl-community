# deck.gl-community CHANGELOG

## v9.2.5

- lint fix

## v9.2.4

- fix(ci): update yarn.lock after -wip workspace directory renames
- chore: remove stale `*-wip` exclusion patterns from vitest config and eslintignore
- chore: exclude private modules (arrow-layers, basemap-props) from lint and broken basemap-props tests

## v9.2.1

- See all beta releases below, the whats new and upgrade guide in website for full v9.1 -> 9.2 changelog

## v9.2.0-beta.10

- feat(three): Add `TreeLayer` for 3D tree/forest visualization (#515)
- fix(editable-layers): prevent removing rectangle corner when `lockRectangles` is used (#511)
- fix(editable-layers): add missing `@turf/rhumb-bearing` and `@turf/rhumb-distance` dependencies (#519)
- fix(editable-layers): fix three-click polygon mode — skip guide processing without a prior pointer-move event (#482)
- chore(deps): bump `@deck.gl/*` to `~9.2.8` and `@luma.gl/*` to `~9.2.6` (#518)
- fix(three): bump `@deck.gl` deps to `~9.2.8`, fix Windows dev tooling (#520)
- chore: move WIP docs into module directories, remove wip/ top-level directory (#510)
- docs(geo-layers): initial TileSourceLayer documentation (draft/hidden until implementation ready)
- chore(deps): security bumps — node-forge, ajv, axios, diff, tar (#514, #521, #522, #523, #525)

## v9.2.0-beta.9

- feat(editable-layers): tracker tasks (#491)
- fix(editable-layers): use turf/kinks for self-intersection test in DrawPolygonMode (#471)
- chore(deps): replace viewport-mercator-project with @math.gl/web-mercator (#502)
- chore: promote WIP modules to modules/\*-wip (#509)
- chore: remove dead code and outdated WIP content (#505)
- chore: remove playground example (#508)
- chore: enable pre-commit lint and test hooks (#492)
- chore: enable repo-wide prettier formatting (#486)
- chore(deps): bump @vis.gl/dev-tools from alpha.21 to stable 1.0.1 (#500)
- chore(deps): bump vitest ecosystem to latest (#499)
- chore(deps): bump vite to ^7.3.1 and @vitejs/plugin-react to ^5.1.4 (#498)

## v9.2.0-beta.8

- fix(editable-layers): Fix issue where modify mode can update the wrong vertex (#198)
- feat(editable-layers): Export DeleteMode from edit-modes (#464)
- feat(timeline-layers): Add timeline-layers module (#458)
- chore(leaflet): Rename Leaflet DeckLayer to DeckOverlay (#454)
- fix(graph-layers): Update import path for stylesheet and improve code formatting (#448)

## v9.2.0-beta.7

- feat(editable-layers): Update to turf 7 and use geojson types (#447)
- chore(graph-layers): Define explicit graph stylesheet schema (#445)
- fix(editable-layers): EditableGeoJsonLayerProps typing, expose SelectionLayerProps (#219)
- fix(editable-layers): propagate EditableGeoJsonLayer accessor updateTriggers to GeoJsonLayer (#446)
- feat(website) Add screenshot for leaflet gallery example (#444)

## v9.2.0-beta.6

- chore(leaflet): Attempt to fix script build (#443)
- fix(website): gallery leaflet link .html extension (#442)
- feat(DrawPolygonMode): add allowHoles & update allowOverlappingLines configs (#367)
- Bump leaflet script tag version

## v9.2.0-beta.5

- chore: Update package.json publishConfigs (#441)

## v9.2.0-beta.4

- examples(leaflet): Update gallery script link
- website: Include gallery assets in Docusaurus build (#439)
- Add scripted gallery navigation and tiles (#438)
- chore: Add bundle builds for deck.gl-community modules (#433)
- chore(graph-layers): Update zod dependencies to v4 (#435)
- fix(editable-layers): Fix import of PathMarkerLayer (#432)
- docs(graph-layers) Remove GraphGL references (#428)
- feat(widgets) Add HTML overlay widget example (#427)

## v9.2.0-beta.3

- docs: Updates for 9.2.0-beta.3 (#426)
- link
- chore(graph-layers): Clean up excessive LLM changes (#424)
- chore: Move WIP code into wip folder (#425)
- fix(website); Ensure widget module JSX is transpiled with preact (#423)
- docs: expand graph layer coverage (#415)
- feat(graph-viewer): support remote DOT datasets (#417)
- docs(graph-layers): expand graph layout tutorial (#418)
- Use ArrowGraph in graph viewer example (#413)
- docs(graph-layers): update GraphLayout usage guidance (#416)
- feat(graph-layers) Add DOTGraphLoader with tests and docs (#414)
- feat(graph-layers) Add ArrowGraph (#411)
- feat(editable-layers): Experimental edit mode widget + example (#406)
- docs(layers) Add PathMarker and PathOutline example and docs (#403)
- docs(geo-layers): fix global grid layer examples (#404)
- docs(geo-layers): document global grid helpers (#405)
- feat(graph-layers) Replace graph events with callback props (#398)
- docs(graph-layers) Reorganize docs (#392)
- docs: polish (#310)
- feat(widgets): new widgets module and example (#399)
- chore(graph-layers): unify graph stylesheet engine usage (#397)
- feat(graph-layers) TabularGraph uses tabular node/edge state storage (#394)
- feat(graph-layers): default JSON loader emits tabular graph (#390)
- test(graph-layers): cover shared graph behavior (#391)
- chore(graph-layers) Extract a common graph interface (#387)
- feat(graph-viewer): improve tooltip readability (#386)
- fix(graph-layers): layout lifecycle events for hive and radial layouts (#384)
- feat(graph-layers): add rank grid utilities and layer (#378)
- Move layout prop description types into props form (#382)
- feat(graph-layers) Add GraphLayer data prop (#363)
- chore: Enable publish of leaflet package (#377)
- chore: Mark geo-layers for public publishing (#376)
- Add Charles as the editable-layer maintainer (#371)
- feat(graph-layers): Layered DAG support (#375)
- feat(graph-layers): break out collapsable D3 DAG layout subclass (#373)

## v9.2.0-beta.2

- chore: Enable publish of leaflet package (#377)
- chore: Mark geo-layers for public publishing (#376)
- Add Charles as the editable-layer maintainer (#371)
- feat(graph-layers): Layered DAG support (#375)
- feat(graph-layers): break out collapsable D3 DAG layout subclass (#373)

## v9.2.0-beta.1

- docs(graph-layers): Improve layout docs (#370)
- feat(graph-viewer): add dag layout configuration controls (#359)
- feat(graph-layers) add bounds calculation to layouts and graph-viewer (#357)
- chore(graph-layers): refactor collapsed chain utilities (#353)
- feat(graph-layers): collapsable linear DAG chains (#337)
- fix(graph-layers): restore dag arrow decorator color property (#343)
- [editable-layers] Real double-click used to finish drawing (#225)
- feat(experimental): add pan and zoom widget (#341)
- feat(graph-layers): unified graph stylesheet props (#328)
- feat(graph-layers): split style engine from stylesheet (#321)
- feat(graph-viewer): extract control panel component (#319)
- feat(graph-layers) Add probe.gl logging to graph layout lifecycle (#318)
- refactor(graph): extract reusable base stylesheet (#306)
- [graph-layers] Use literal string types for constants (#302)
- Add arrowhead decorator to graph layer (#297)
- Add d3-dag example for graph module (#289)
- chore: Bump to deck.gl@9.2 (#284)

## v9.1.1

- [chore] Prepare for v9.1 publish (#272)
- fix(website, editable-layers): Unbreak editor example in website (#271)
- Add horizon graph layer website example (#270)
- docs: update infovis sidebar (#269)
- refactor: move horizon layers to infovis package (#268)
- docs: add horizon graph layer documentation (#267)
- Horizon Layer (#258)
- fix: Remove stray merge markers (#266)
- feat(geo-layers): Fix the geo-layers module (#265)

## v9.1.0

- Skipped

### v9.1.0-beta.8

- No new commits

### v9.1.0-beta.7

- No new commits

### v9.1.0-beta.6

- feat(infovis-layers): New TimeAxisLayer, VerticalGridLayer and View utils (#264)
- chore: Website minor fixes follow-up (#263)
- chore: Unbreak website (#251)
- chore(deps-dev): bump vite from 5.4.11 to 5.4.19 (#249)
- chore(deps): bump estree-util-value-to-estree in /website (#231)
- chore(deps): bump @babel/runtime from 7.26.0 to 7.27.0 in /website (#233)
- chore(deps): bump axios from 1.7.4 to 1.8.4 (#234)
- chore(deps): bump @babel/helpers from 7.24.8 to 7.27.0 (#235)
- chore(deps): bump http-proxy-middleware from 2.0.7 to 2.0.9 in /website (#238)
- chore(deps): bump prismjs from 1.29.0 to 1.30.0 in /website (#222)
- docs: fix url to turf distance documentation (#248)
- chore(deps-dev): bump vite from 6.1.0 to 6.1.6 (#239)
- chore(deps): bump tar-fs from 2.1.1 to 2.1.3 (#244)
- chore(deps-dev): bump webpack-dev-server from 3.11.3 to 5.2.1 (#245)
- feat(layers): GlobalGridLayer, GlobalGrid (#240)

### v9.1.0-beta.5

- Fix lodash import (#220)
- fix: Replace missed occurrences of ocular-dev-tools to @vis.gl/dev-tools (#216)

### v9.1.0-beta.4

- chore: Update dev tools (#215)
