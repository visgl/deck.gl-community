// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps, DefaultProps, Layer, PickingInfo} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import lineIntersect from '@turf/line-intersect';
import {lineString, point, polygon} from '@turf/helpers';

import {EditableGeoJsonLayer} from './editable-geojson-layer';
import {DrawRectangleMode} from '../edit-modes/draw-rectangle-mode';
import {DrawPolygonMode} from '../edit-modes/draw-polygon-mode';
import {ViewMode} from '../edit-modes/view-mode';

export const SELECTION_TYPE = {
  NONE: null,
  RECTANGLE: 'rectangle',
  POLYGON: 'polygon'
};

const MODE_MAP = {
  [SELECTION_TYPE.RECTANGLE]: DrawRectangleMode,
  [SELECTION_TYPE.POLYGON]: DrawPolygonMode
};

const MODE_CONFIG_MAP = {
  [SELECTION_TYPE.RECTANGLE]: {dragToDraw: true}
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface SelectionLayerProps<_DataT> extends CompositeLayerProps {
  layerIds: any[];
  onSelect: (info: any) => any;
  selectionType: string | null;
}

const defaultProps: DefaultProps<SelectionLayerProps<any>> = {
  selectionType: SELECTION_TYPE.RECTANGLE,
  layerIds: [],
  onSelect: () => {}
};

const EMPTY_DATA = {
  type: 'FeatureCollection',
  features: []
};

const LAYER_ID_GEOJSON = 'selection-geojson';

const PASS_THROUGH_PROPS = [
  'lineWidthScale',
  'lineWidthMinPixels',
  'lineWidthMaxPixels',
  'lineWidthUnits',
  'lineJointRounded',
  'lineCapRounded',
  'lineMiterLimit',
  'pointRadiusScale',
  'pointRadiusMinPixels',
  'pointRadiusMaxPixels',
  'lineDashJustified',
  'getLineColor',
  'getFillColor',
  'getRadius',
  'getLineWidth',
  'getLineDashArray',
  'getTentativeLineDashArray',
  'getTentativeLineColor',
  'getTentativeFillColor',
  'getTentativeLineWidth'
];
export class SelectionLayer<DataT, ExtraPropsT> extends CompositeLayer<
  ExtraPropsT & Required<SelectionLayerProps<DataT>>
> {
  static layerName = 'SelectionLayer';
  static defaultProps = defaultProps;

  _selectRectangleObjects(coordinates: any) {
    const {layerIds, onSelect} = this.props;
    const [x1, y1] = this.context.viewport.project(coordinates[0][0]);
    const [x2, y2] = this.context.viewport.project(coordinates[0][2]);
    const pickingInfos = this.context.deck.pickObjects({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      layerIds
    });

    onSelect({pickingInfos});
  }

  _selectPolygonObjects(coordinates: any) {
    const {layerIds, onSelect} = this.props;

    const selectionPolygon = polygon(coordinates);
    const pickingInfos: SelectionPickingInfo[] = this.context.layerManager
      .getLayers()
      .filter(layer => layerIds.includes(layer.id))
      .flatMap(layer => {
        const candidates = getSelectionCandidates(layer);
        return candidates.flatMap(({object, index, data}): SelectionPickingInfo[] => {
          if (!isObjectInsideSelection(layer, object, index, data, selectionPolygon)) {
            return [];
          }

          return [{object, layer, index}];
        });
      });

    onSelect({pickingInfos});
  }

  renderLayers() {
    const mode = MODE_MAP[this.props.selectionType] || ViewMode;
    const modeConfig = MODE_CONFIG_MAP[this.props.selectionType];

    const inheritedProps = {};
    PASS_THROUGH_PROPS.forEach(p => {
      if (this.props[p] !== undefined) inheritedProps[p] = this.props[p];
    });

    return [
      new EditableGeoJsonLayer(
        this.getSubLayerProps({
          id: LAYER_ID_GEOJSON,
          pickable: true,
          mode,
          modeConfig,
          selectedFeatureIndexes: [],
          data: EMPTY_DATA,
          onEdit: ({updatedData, editType}) => {
            if (editType === 'addFeature') {
              const {coordinates} = updatedData.features[0].geometry;

              if (this.props.selectionType === SELECTION_TYPE.RECTANGLE) {
                this._selectRectangleObjects(coordinates);
              } else if (this.props.selectionType === SELECTION_TYPE.POLYGON) {
                this._selectPolygonObjects(coordinates);
              }
            }
          },
          ...inheritedProps
        })
      )
    ];
  }

  shouldUpdateState({changeFlags: {stateChanged, propsOrDataChanged}}: Record<string, any>) {
    return stateChanged || propsOrDataChanged;
  }
}

type SelectionPickingInfo = Pick<PickingInfo, 'object' | 'layer' | 'index'>;
type SelectionCandidate = {object: unknown; index: number; data: unknown};
type Position2D = [number, number];
type SelectionPolygon = ReturnType<typeof polygon>;

function getSelectionCandidates(layer: Layer): SelectionCandidate[] {
  const data = layer.props.data;
  if (Array.isArray(data)) {
    return data.map((object, index) => ({object, index, data}));
  }

  if (isFeatureCollection(data)) {
    return data.features.map((object, index) => ({object, index, data: data.features}));
  }

  return [];
}

function isObjectInsideSelection(
  layer: Layer,
  object: unknown,
  index: number,
  data: unknown,
  selectionPolygon: SelectionPolygon
): boolean {
  const position = extractPosition(layer, object, index, data);
  if (position !== null) {
    return booleanPointInPolygon(point(position), selectionPolygon);
  }

  if (!isFeature(object)) {
    return false;
  }

  return isGeometryInsideSelection(object.geometry, selectionPolygon);
}

function isGeometryInsideSelection(geometry: unknown, selectionPolygon: SelectionPolygon): boolean {
  if (!isGeometry(geometry)) {
    return false;
  }

  if (geometry.type === 'Point') {
    return isPositionInsideSelection(geometry.coordinates, selectionPolygon);
  }

  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
    return positionsContainSelectedPoint(geometry.coordinates, selectionPolygon);
  }

  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
    return geometry.coordinates.some(coordinates =>
      pathIntersectsSelection(coordinates, selectionPolygon)
    );
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygonCoordinates =>
      polygonCoordinates.some(coordinates => pathIntersectsSelection(coordinates, selectionPolygon))
    );
  }

  return false;
}

function pathIntersectsSelection(
  coordinates: unknown,
  selectionPolygon: SelectionPolygon
): boolean {
  if (!isPositionArray(coordinates)) {
    return false;
  }

  if (positionsContainSelectedPoint(coordinates, selectionPolygon)) {
    return true;
  }

  const isClosedRing =
    coordinates.length >= 4 &&
    coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
    coordinates[0][1] === coordinates[coordinates.length - 1][1];
  const selectionRing = selectionPolygon.geometry.coordinates[0];
  if (
    isClosedRing &&
    selectionRing.some(position => booleanPointInPolygon(point(position), polygon([coordinates])))
  ) {
    return true;
  }

  if (coordinates.length < 2) {
    return false;
  }

  return lineIntersect(lineString(coordinates), selectionPolygon).features.length > 0;
}

function extractPosition(
  layer: Layer,
  object: unknown,
  index: number,
  data: unknown
): [number, number] | null {
  const props = layer.props as Record<string, unknown>;
  const getPosition = props.getPosition;

  if (typeof getPosition === 'function') {
    const result = getPosition(object, {index, data, target: []});
    if (isPosition(result)) {
      return [result[0], result[1]];
    }
  }

  if (typeof object === 'object' && object !== null) {
    if ('position' in object && isPosition(object.position)) {
      return [object.position[0], object.position[1]];
    }

    if ('coordinates' in object && isPosition(object.coordinates)) {
      return [object.coordinates[0], object.coordinates[1]];
    }
  }

  return null;
}

function positionsContainSelectedPoint(
  coordinates: unknown[],
  selectionPolygon: SelectionPolygon
): boolean {
  return coordinates.some(position => isPositionInsideSelection(position, selectionPolygon));
}

function isPositionInsideSelection(value: unknown, selectionPolygon: SelectionPolygon): boolean {
  return isPosition(value) && booleanPointInPolygon(point(value), selectionPolygon);
}

function isFeatureCollection(value: unknown): value is {
  type: 'FeatureCollection';
  features: unknown[];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'FeatureCollection' &&
    'features' in value &&
    Array.isArray(value.features)
  );
}

function isFeature(value: unknown): value is {type: 'Feature'; geometry: unknown} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'Feature' &&
    'geometry' in value
  );
}

function isGeometry(value: unknown): value is {type: string; coordinates: any} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'coordinates' in value
  );
}

function isPosition(value: unknown): value is Position2D {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number';
}

function isPositionArray(value: unknown): value is Position2D[] {
  return Array.isArray(value) && value.every(isPosition);
}
