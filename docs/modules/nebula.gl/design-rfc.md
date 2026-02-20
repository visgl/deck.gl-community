# Design Decisions

This page preserves key architectural decisions and rationale from the original [nebula.gl](https://nebula.gl) RFCs (authored primarily by Clay Anderson, 2018-2019). These decisions shaped the current codebase and are important context for maintainers, contributors, and AI assistants working with `editable-layers`.

## EditMode Interface

### Problem

The original `ModeHandler` class had two limitations:

1. **deck.gl coupling** — `ModeHandler` depended on deck.gl types and event system, making it unusable in non-deck.gl contexts (e.g. `react-map-gl-draw`, which renders with SVG and has no deck.gl dependency).
2. **GeoJSON lock-in** — the interface was hardcoded to `FeatureCollection`, preventing editing of other data formats (e.g. H3 hexagons, custom coordinate systems).

### Decision: Generic `EditMode<TData, TGuides>`

A framework-agnostic interface with generic type parameters:

```typescript
export interface EditMode<TData, TGuides> {
  handleClick(event: ClickEvent, props: ModeProps<TData>): void;
  handlePointerMove(event: PointerMoveEvent, props: ModeProps<TData>): void;
  handleStartDragging(event: StartDraggingEvent, props: ModeProps<TData>): void;
  handleStopDragging(event: StopDraggingEvent, props: ModeProps<TData>): void;
  getGuides(props: ModeProps<TData>): TGuides;
}
```

Modes receive immutable `ModeProps` and notify the application of changes via an `onEdit` callback — modes never mutate `data` directly. This reactive callback pattern aligns with React/Redux conventions and enables immutable data flow throughout the system.

The GeoJSON specialization is `GeoJsonEditMode implements EditMode<FeatureCollection, GuideFeatureCollection>`.

### Module boundary rationale

The `edit-modes/` directory has **no deck.gl dependency** — only turf.js. This is intentional: mode implementations are portable between deck.gl (`EditableGeoJsonLayer`) and any other rendering context. The layer integration lives separately and handles deck.gl-specific concerns (picking, event registration, rendering guides).

### Legacy ModeHandler

The `src/mode-handlers/` directory contains 24 files from the pre-`EditMode` era, all marked with `// TODO edit-modes: delete handlers once EditMode fully implemented`. These are superseded by the `EditMode` implementations in `src/edit-modes/` and exist only for backward compatibility.

### Non-geospatial extensibility

The generic type parameters (`TData`, `TGuides`) were designed to eventually support non-GeoJSON data and non-geographic coordinate systems. However, every concrete mode implementation assumes WGS84 coordinates via turf.js. See [issue #496](https://github.com/visgl/deck.gl-community/issues/496) for the plan to address this.

## Tentative Features

### Problem

During drawing, geometry types used to change as the user added points:

- `drawPolygon`: `Point` (1 click) → `LineString` (2 clicks) → `Polygon` (3+ clicks)

This was confusing for applications that expected type stability (e.g. a map editor that only allows `Polygon` features would see intermediate `Point` and `LineString` objects in its data).

### Decision: Separate tentative state from committed data

Work-in-progress geometry (the "tentative feature") is stored internally, separate from the `data` FeatureCollection. The `onEdit` callback only fires when the feature reaches its target geometry type.

**Drawing flow (polygon example):**

1. User moves pointer → tentative feature is a `Point` following the mouse (no `onEdit`)
2. First click → tentative feature becomes a `LineString` (no `onEdit`)
3. Second click → tentative feature becomes a `Polygon` triangle with third vertex following mouse (no `onEdit`)
4. User clicks starting point → `onEdit` fires with a complete `Polygon` in `updatedData`

The application never sees intermediate geometry types. Tentative features are rendered via the `guides` sub-layer and can be identified by `properties.guideType === 'tentative'`.

### Geometry validation consequence

Because geometry types are stable, the library can enforce type-preserving constraints. For example, a `Polygon` cannot have positions removed below the minimum (3 vertices / triangle), since that would require downgrading to a `LineString`.

### Alternative considered and rejected

Using `GeometryCollection` to hold interim geometries during editing was considered and rejected. GeoJSON doesn't support a `MultiPolygon` containing mixed types (e.g. a `Polygon` and a `Point`), making `GeometryCollection` awkward for representing intermediate drawing states. It would also exacerbate the "surprising type changes" problem.

## Multi-Geometry Editing

### Problem

Users cannot add additional `LineString`s to a `MultiLineString` feature, or additional `Polygon`s to a `MultiPolygon` feature. The tentative feature mechanism (above) is a prerequisite for solving this — without it, there's no clean way to isolate a new sub-geometry being drawn from the already-committed parts of a `Multi*` feature.

### Status

This was identified as a goal in 2018 but the detailed design was never specified. The tentative feature mechanism provides the foundation, but the editing UX for appending to `Multi*` features remains unimplemented.

## Guide System

Guides are transient visual aids rendered during editing. They are returned by `EditMode.getGuides()` as a `FeatureCollection` with two types:

| `guideType`  | `editHandleType` | Purpose                                                              |
| ------------ | ---------------- | -------------------------------------------------------------------- |
| `tentative`  | —                | Uncommitted geometry following the cursor during drawing             |
| `editHandle` | `existing`       | Draggable point at an existing vertex                                |
| `editHandle` | `intermediate`   | Point rendered between existing vertices (click to add a new vertex) |
| `editHandle` | `snap`           | Visual indicator for snapping targets                                |

This separation allows the rendering layer to style guides independently from committed features (e.g. dashed lines for tentative geometry, colored dots for edit handles).

## react-map-gl-draw (not ported)

nebula.gl included a `react-map-gl-draw` module — a stateless React component for geo editing without deck.gl. Key design points:

- **Stateless**: unlike `mapbox-gl-draw` which manages internal state, `react-map-gl-draw` was fully controlled by props (`features`, `selectedFeatureId`, `mode`), compatible with React/Redux patterns.
- **Feature states**: `INACTIVE` → `SELECTED` → `HOVERED` → `UNCOMMITTED` — a state machine for styling features based on interaction state.
- **`renderType` property**: distinguished visual intent from GeoJSON type (e.g. a Rectangle has `renderType: 'Rectangle'` but `geometry.type: 'Polygon'`).

This module was **not ported** to `@deck.gl-community/editable-layers`. The `EditMode` interface's framework independence means the mode logic is reusable, but the SVG rendering layer would need to be rebuilt. See the [upgrade guide](/docs/modules/editable-layers/README#upgrading-from-nebulagl-to-editable-layers-v90) for migration notes.

## References

- [Original RFCs](https://github.com/visgl/deck.gl-community/tree/a6ec81d571ee2224291e83a0d0dc0419297b2c0b/dev-docs/RFCs/editable-layers) (archived at commit `a6ec81d`)
- [Non-geospatial coordinate support RFC (issue #496)](https://github.com/visgl/deck.gl-community/issues/496)
- [v9.3 tracker (issue #38)](https://github.com/visgl/deck.gl-community/issues/38)
- [GeoJSON types discussion (PR #450)](https://github.com/visgl/deck.gl-community/pull/450)
