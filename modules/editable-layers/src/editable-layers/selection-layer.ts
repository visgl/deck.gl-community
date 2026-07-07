// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps, DefaultProps, Layer, PickingInfo} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import {point, polygon} from '@turf/helpers';

import {DrawPolygonMode} from '../edit-modes/draw-polygon-mode';
import {DrawRectangleMode} from '../edit-modes/draw-rectangle-mode';
import {ViewMode} from '../edit-modes/view-mode';
import {EditableGeoJsonLayer} from './editable-geojson-layer';

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
        const data = layer.props.data;
        if (!Array.isArray(data)) return [];
        return data.flatMap((object, index): SelectionPickingInfo[] => {
          const position = extractPosition(layer, object, index, data);
          if (position === null) return [];
          if (!booleanPointInPolygon(point(position), selectionPolygon)) return [];
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

function extractPosition(
  layer: Layer,
  object: unknown,
  index: number,
  data: unknown
): [number, number] | null {
  const props = layer.props;
  if ('getPosition' in props && typeof props.getPosition === 'function') {
    const result = props.getPosition(object, {index, data, target: []});
    if (Array.isArray(result) && typeof result[0] === 'number' && typeof result[1] === 'number') {
      return [result[0], result[1]];
    }
  }
  if (typeof object === 'object' && object !== null) {
    if ('position' in object) {
      const p = object.position;
      if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') {
        return [p[0], p[1]];
      }
    }
    if ('coordinates' in object) {
      const c = object.coordinates;
      if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
        return [c[0], c[1]];
      }
    }
  }
  return null;
}
