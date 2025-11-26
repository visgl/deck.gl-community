// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Utils
export {toDeckColor} from './utils/utils';

// Types
export type {Color, Style, Viewport} from './utils/types';

// Layers
export {EditableGeoJsonLayer} from './editable-layers/editable-geojson-layer';
export {EditableH3ClusterLayer} from './editable-layers/editable-h3-cluster-layer';
export {SelectionLayer} from './editable-layers/selection-layer';
export {ElevatedEditHandleLayer} from './editable-layers/elevated-edit-handle-layer';

// Widgets
export {EditModeTrayWidget} from './widgets/edit-mode-tray-widget';
export type {
  EditModeTrayWidgetProps,
  EditModeTrayWidgetModeOption,
  EditModeTrayWidgetSelectEvent
} from './widgets/edit-mode-tray-widget';

// Layers move to deck.gl-community/layers?
export {JunctionScatterplotLayer} from './editable-layers/junction-scatterplot-layer';

// Types

import * as utils from './utils/utils';

export {utils};

export {getPickedEditHandle, getEditHandlesForGeometry} from './edit-modes/utils';

export type {EditMode} from './edit-modes/edit-mode';
export type {GeoJsonEditModeType} from './edit-modes/geojson-edit-mode';
export type {GeoJsonEditModeConstructor} from './edit-modes/geojson-edit-mode';

export type {EditableGeoJsonLayerProps} from './editable-layers/editable-geojson-layer';
export type {SelectionLayerProps} from './editable-layers/selection-layer';

export {GeoJsonEditMode} from './edit-modes/geojson-edit-mode';

// Alter modes
export {ModifyMode} from './edit-modes/modify-mode';
export {ResizeCircleMode} from './edit-modes/resize-circle-mode';
export {TranslateMode} from './edit-modes/translate-mode';
export {ScaleMode} from './edit-modes/scale-mode';
export {RotateMode} from './edit-modes/rotate-mode';
export {DuplicateMode} from './edit-modes/duplicate-mode';
export {ExtendLineStringMode} from './edit-modes/extend-line-string-mode';
export {SplitPolygonMode} from './edit-modes/split-polygon-mode';
export {ExtrudeMode} from './edit-modes/extrude-mode';
export {ElevationMode} from './edit-modes/elevation-mode';
export {TransformMode} from './edit-modes/transform-mode';

// Draw modes
export {DrawPointMode} from './edit-modes/draw-point-mode';
export {DrawLineStringMode} from './edit-modes/draw-line-string-mode';
export {DrawPolygonMode} from './edit-modes/draw-polygon-mode';
export {DrawRectangleMode} from './edit-modes/draw-rectangle-mode';
export {DrawSquareMode} from './edit-modes/draw-square-mode';
export {DrawRectangleFromCenterMode} from './edit-modes/draw-rectangle-from-center-mode';
export {DrawSquareFromCenterMode} from './edit-modes/draw-square-from-center-mode';
export {DrawCircleByDiameterMode} from './edit-modes/draw-circle-by-diameter-mode';
export {DrawCircleFromCenterMode} from './edit-modes/draw-circle-from-center-mode';
export {DrawEllipseByBoundingBoxMode} from './edit-modes/draw-ellipse-by-bounding-box-mode';
export {DrawEllipseUsingThreePointsMode} from './edit-modes/draw-ellipse-using-three-points-mode';
export {DrawRectangleUsingThreePointsMode} from './edit-modes/draw-rectangle-using-three-points-mode';
export {Draw90DegreePolygonMode} from './edit-modes/draw-90degree-polygon-mode';
export {DrawPolygonByDraggingMode} from './edit-modes/draw-polygon-by-dragging-mode';
export {ImmutableFeatureCollection} from './edit-modes/immutable-feature-collection';

// Other modes
export {ViewMode} from './edit-modes/view-mode';
export {MeasureDistanceMode} from './edit-modes/measure-distance-mode';
export {MeasureAreaMode} from './edit-modes/measure-area-mode';
export {MeasureAngleMode} from './edit-modes/measure-angle-mode';
export {CompositeMode} from './edit-modes/composite-mode';
export {SnappableMode} from './edit-modes/snappable-mode';

export type {
  ScreenCoordinates,
  EditAction,
  Pick,
  ClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  DraggingEvent,
  ModeProps,
  GuideFeatureCollection,
  // Viewport,
  Tooltip
} from './edit-modes/types';

export type {
  SimpleFeature,
  SimpleFeatureCollection,
  SimpleGeometry,
  SimpleGeometryCoordinates,
  PolygonGeometry,
  AnyGeoJson
} from './utils/geojson-types';

// Experimental
export {memoize as _memoize} from './utils/memoize';
