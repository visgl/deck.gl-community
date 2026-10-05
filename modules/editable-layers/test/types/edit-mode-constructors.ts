// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Compile against the built package exports, without the repository's source aliases.
import * as EditableLayers from '@deck.gl-community/editable-layers';
import type {
  ClickEvent,
  EditAction,
  GeoJsonEditModeConstructor,
  GeoJsonEditModeType,
  GuideFeatureCollection,
  ModeProps,
  SimpleFeature,
  SimpleFeatureCollection
} from '@deck.gl-community/editable-layers';
import type {FeatureCollection} from 'geojson';

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
