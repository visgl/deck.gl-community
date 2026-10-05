// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps, DefaultProps} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {featureCollection, polygon} from '@turf/helpers';
import {buffer} from '@turf/buffer';
import {difference} from '@turf/difference';

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
  /**
   * Keep selection gestures from bubbling into the parent map.
   * Set to false when the application coordinates map interactions itself.
   * @default true
   */
  autoPreventMapInteractions?: boolean;
}

const defaultProps: DefaultProps<SelectionLayerProps<any>> = {
  selectionType: SELECTION_TYPE.RECTANGLE,
  autoPreventMapInteractions: true,
  layerIds: [],
  onSelect: () => {}
};

const EMPTY_DATA = {
  type: 'FeatureCollection',
  features: []
};

const EXPANSION_KM = 50;
const LAYER_ID_GEOJSON = 'selection-geojson';
const LAYER_ID_BLOCKER = 'selection-blocker';

// Picking must wait for the mask to be drawn, rather than an arbitrary timer.
class SelectionBlockerLayer extends SolidPolygonLayer<any, {onRendered: () => void}> {
  static layerName = 'SelectionBlockerLayer';

  draw(options: Parameters<SolidPolygonLayer['draw']>[0]) {
    super.draw(options);
    this.props.onRendered();
  }
}

function filterFeaturePicks(pickingInfos: any[]) {
  const seen = new Set<string>();
  return pickingInfos.filter(info => {
    if (info.isGuide || info.object?.properties?.guideType) return false;
    const key = `${info.layer?.id}:${info.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PASS_THROUGH_PROPS = [
  'autoPreventMapInteractions',
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

  state: {
    pendingPolygonSelection: {
      bigPolygon: ReturnType<typeof difference>;
      complete: () => void;
      scheduled: boolean;
    } | null;
  } = undefined!;

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

    onSelect({pickingInfos: filterFeaturePicks(pickingInfos)});
  }

  _selectPolygonObjects(coordinates: any) {
    const {layerIds, onSelect} = this.props;
    const mousePoints = coordinates[0].map(c => this.context.viewport.project(c));

    const allX = mousePoints.map(mousePoint => mousePoint[0]);
    const allY = mousePoints.map(mousePoint => mousePoint[1]);
    const x = Math.min(...allX);
    const y = Math.min(...allY);
    const maxX = Math.max(...allX);
    const maxY = Math.max(...allY);

    // Use a polygon to hide the outside, because pickObjects()
    // does not support polygons
    const landPointsPoly = polygon(coordinates);
    const bigBuffer = buffer(landPointsPoly, EXPANSION_KM);
    let bigPolygon;
    try {
      // turfDifference throws an exception if the polygon
      // intersects with itself (TODO: check if true in all versions)
      bigPolygon = difference(featureCollection([bigBuffer, landPointsPoly]));
    } catch (e) {
      // invalid selection polygon
      console.log('turfDifference() error', e); // eslint-disable-line
      return;
    }

    const blockerId = `${this.props.id}-${LAYER_ID_BLOCKER}`;
    const pendingSelection = {
      bigPolygon,
      scheduled: false,
      complete: () => {
        const currentLayer = (this.getCurrentLayer() || this) as SelectionLayer<DataT, ExtraPropsT>;
        if (
          currentLayer.state.pendingPolygonSelection !== pendingSelection ||
          currentLayer.props.selectionType !== SELECTION_TYPE.POLYGON
        )
          return;
        const pickingInfos = currentLayer.context.deck.pickObjects({
          x,
          y,
          width: maxX - x,
          height: maxY - y,
          layerIds: [blockerId, ...layerIds]
        });

        currentLayer.setState({pendingPolygonSelection: null});
        onSelect({
          pickingInfos: filterFeaturePicks(
            pickingInfos.filter(item => item.layer.id !== this.props.id)
          )
        });
      }
    };
    this.setState({pendingPolygonSelection: pendingSelection});
  }

  finalizeState() {
    this.state.pendingPolygonSelection = null;
  }

  renderLayers() {
    const {pendingPolygonSelection} = this.state;

    const mode = MODE_MAP[this.props.selectionType] || ViewMode;
    const modeConfig = MODE_CONFIG_MAP[this.props.selectionType];

    const inheritedProps = {};
    PASS_THROUGH_PROPS.forEach(p => {
      if (this.props[p] !== undefined) inheritedProps[p] = this.props[p];
    });

    const layers: any[] = [
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

    if (pendingPolygonSelection) {
      const {bigPolygon} = pendingPolygonSelection as any;
      layers.push(
        new SelectionBlockerLayer(
          this.getSubLayerProps({
            id: LAYER_ID_BLOCKER,
            pickable: true,
            opacity: 1.0,
            data: [bigPolygon],
            getLineColor: _obj => [0, 0, 0, 1],
            getFillColor: _obj => [0, 0, 0, 1],
            getPolygon: o => o.geometry.coordinates,
            onRendered: () => {
              if (!pendingPolygonSelection.scheduled) {
                pendingPolygonSelection.scheduled = true;
                queueMicrotask(pendingPolygonSelection.complete);
              }
            }
          })
        )
      );
    }

    return layers;
  }

  shouldUpdateState({changeFlags: {stateChanged, propsOrDataChanged}}: Record<string, any>) {
    return stateChanged || propsOrDataChanged;
  }
}
