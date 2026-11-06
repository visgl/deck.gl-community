// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Compile against the built package exports, without the repository's source aliases.
import * as EditableLayers from '@deck.gl-community/editable-layers';
import type {
  EditModeProjection,
  ClickEvent,
  EditAction,
  EditModeCoordinateSystem,
  GeoJsonEditModeConstructor,
  GeoJsonEditModeType,
  GuideFeatureCollection,
  ModeProps,
  Position,
  SimpleFeature,
  SimpleFeatureCollection
} from '@deck.gl-community/editable-layers';
import type {FeatureCollection} from 'geojson';
import type {Units} from '@turf/helpers';

class CustomMode extends EditableLayers.GeoJsonEditMode {
  override handleClick(_event: ClickEvent, props: ModeProps<SimpleFeatureCollection>): void {
    const action: EditAction<SimpleFeatureCollection> = {
      updatedData: props.data,
      editType: 'custom',
      editContext: {}
    };
    props.onEdit(action);
  }

  override getGuides(_props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {type: 'Point', coordinates: [0, 0]},
          properties: {guideType: 'editHandle', editHandleType: 'existing', featureIndex: 0}
        }
      ]
    };
  }
}

// Every exported mode with a zero-argument constructor must meet the public contract.
const modeConstructors: GeoJsonEditModeConstructor[] = [
  EditableLayers.GeoJsonEditMode,
  EditableLayers.ViewMode,
  EditableLayers.DeleteMode,
  EditableLayers.ModifyMode,
  EditableLayers.ResizeCircleMode,
  EditableLayers.TranslateMode,
  EditableLayers.ScaleMode,
  EditableLayers.RotateMode,
  EditableLayers.DuplicateMode,
  EditableLayers.ExtendLineStringMode,
  EditableLayers.SplitPolygonMode,
  EditableLayers.ExtrudeMode,
  EditableLayers.ElevationMode,
  EditableLayers.TransformMode,
  EditableLayers.DrawPointMode,
  EditableLayers.DrawLineStringMode,
  EditableLayers.DrawPolygonMode,
  EditableLayers.DrawRectangleMode,
  EditableLayers.DrawSquareMode,
  EditableLayers.DrawRectangleFromCenterMode,
  EditableLayers.DrawSquareFromCenterMode,
  EditableLayers.DrawCircleByDiameterMode,
  EditableLayers.DrawCircleFromCenterMode,
  EditableLayers.DrawEllipseByBoundingBoxMode,
  EditableLayers.DrawEllipseUsingThreePointsMode,
  EditableLayers.DrawRectangleUsingThreePointsMode,
  EditableLayers.Draw90DegreePolygonMode,
  EditableLayers.DrawPolygonByDraggingMode,
  EditableLayers.MeasureDistanceMode,
  EditableLayers.MeasureAreaMode,
  EditableLayers.MeasureAngleMode,
  CustomMode
];

const feature: SimpleFeature = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {}
};
const data: SimpleFeatureCollection = {type: 'FeatureCollection', features: [feature]};

const modes: GeoJsonEditModeType[] = modeConstructors.map(Mode => new Mode());
modes.push(
  new EditableLayers.CompositeMode([new CustomMode(), new EditableLayers.ModifyMode()]),
  new EditableLayers.SnappableMode(new EditableLayers.TranslateMode()),
  new EditableLayers.SnappableMode(new CustomMode()),
  new EditableLayers.SnappableMode(new EditableLayers.TransformMode())
);

declare const props: ModeProps<SimpleFeatureCollection>;
declare const event: ClickEvent;

for (const mode of modes) {
  mode.handleClick(event, props);
  const guides: GuideFeatureCollection | undefined = mode.getGuides(props);
  void guides;
}

for (const Mode of modeConstructors) {
  new EditableLayers.EditableGeoJsonLayer({
    id: 'strict-consumer',
    data,
    mode: Mode,
    onEdit: action => {
      const updatedData: SimpleFeatureCollection = action.updatedData;
      void updatedData;
    }
  });
}

// GeoJSON data narrowed to supported geometries is compatible without changing its import.
const geoJsonData: FeatureCollection<EditableLayers.SimpleGeometry> = data;
const editableData: SimpleFeatureCollection = geoJsonData;
void editableData;

declare const broadData: FeatureCollection;
// @ts-expect-error GeometryCollection must not be accepted as editable data.
const unsupportedData: SimpleFeatureCollection = broadData;
void unsupportedData;

const broadProps: ModeProps<FeatureCollection> = {...props, data: broadData, onEdit: () => {}};
// @ts-expect-error Custom handlers must narrow broader GeoJSON data before editing.
new EditableLayers.TranslateMode().handleClick(event, broadProps);

// Public strategies use the same narrow data contract as edit modes.
for (const strategy of [
  new EditableLayers.ClickSnappingStrategy(),
  new EditableLayers.DragSnappingStrategy(),
  new EditableLayers.SourceSnappingStrategy()
]) {
  strategy.snapClickEvent(props, event);
  strategy.getSnapGuides(props);
}
class NoSnappingPointMode extends EditableLayers.DrawPointMode {
  override getSnappingStrategy(): EditableLayers.SnappingStrategy | undefined {
    return undefined;
  }
}
new EditableLayers.SnappableMode(new NoSnappingPointMode());

const customSnapper: EditableLayers.Snapper = {
  snap(
    event: EditableLayers.BasePointerEvent,
    input: ModeProps<SimpleFeatureCollection>,
    excluded: Set<number>
  ): EditableLayers.SnapResult | null {
    void input;
    void excluded;
    return {mapCoords: event.mapCoords};
  }
};
new EditableLayers.DefaultSnapper().snap(event, props, new Set());
customSnapper.snap(event, props, new Set());
declare const movement: EditableLayers.MovementEvent;
new EditableLayers.ClickSnappingStrategy().snapMovementEvent(props, movement);

// Legacy public wrapper inspection and replacement remain valid for strict consumers.
const legacyWrapper = new EditableLayers.SnappableMode(new CustomMode());
const legacyHandler: EditableLayers.GeoJsonEditMode = legacyWrapper._handler;
legacyWrapper._handler = legacyHandler;

// Strict consumers may provide an atomic render transform pair to standalone modes.
const projection: EditModeProjection = {
  project: position => position,
  unproject: position => (position.every(Number.isFinite) ? position : undefined)
};
const projectedProps: ModeProps<SimpleFeatureCollection> = {...props, projection};
void projectedProps;

// Geographic subclasses forward optional units while preserving two-argument consumers.
class ForwardingGeoCoordinateSystem extends EditableLayers.GeoCoordinateSystem {
  override distance(a: Position, b: Position, options?: {units?: Units}): number {
    return super.distance(a, b, options);
  }
}

// Native subclasses ignore geographic output units and retain their own paired math.
class NativeGeoCoordinateSystem extends EditableLayers.GeoCoordinateSystem {
  override distance(a: Position, b: Position): number {
    return EditableLayers.cartesianCoordinateSystem.distance(a, b);
  }

  override bearing(a: Position, b: Position): number {
    return EditableLayers.cartesianCoordinateSystem.bearing(a, b);
  }

  override destination(origin: Position, distance: number, bearing: number): Position {
    return EditableLayers.cartesianCoordinateSystem.destination(origin, distance, bearing);
  }
}

for (const coordinateSystem of [
  new ForwardingGeoCoordinateSystem(),
  new NativeGeoCoordinateSystem()
]) {
  const customCoordinateSystem: EditModeCoordinateSystem = coordinateSystem;
  const start: Position = [0, 0];
  const end: Position = [1, 1];
  const distance: number = customCoordinateSystem.distance(start, end);
  const selectedDistance: number = customCoordinateSystem.distance(start, end, {units: 'meters'});
  const endpoint: Position = customCoordinateSystem.destination(
    start,
    distance,
    customCoordinateSystem.bearing(start, end)
  );
  const customProps: ModeProps<SimpleFeatureCollection> = {
    ...props,
    coordinateSystem: customCoordinateSystem
  };
  new EditableLayers.MeasureDistanceMode().getTooltips(customProps);
  void endpoint;
  void selectedDistance;
}

const geographicDistance: number = EditableLayers.geoCoordinateSystem.distance([0, 0], [1, 0], {
  units: 'meters'
});
const nativeDistance: number = EditableLayers.cartesianCoordinateSystem.distance([0, 0], [3, 4], {
  units: 'miles'
});
// @ts-expect-error Geographic units use Turf's supported unit names.
EditableLayers.geoCoordinateSystem.distance([0, 0], [1, 0], {units: 'unsupported'});
void geographicDistance;
void nativeDistance;
