// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps, DefaultProps, FilterContext} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';

import {EditableGeoJsonLayer} from './editable-geojson-layer';
import {DrawRectangleMode} from '../edit-modes/draw-rectangle-mode';
import {DrawPolygonMode} from '../edit-modes/draw-polygon-mode';
import {ViewMode} from '../edit-modes/view-mode';
import {projectOnTargetPlane} from '../utils/camera-target';

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
  /** IDs of the pickable layers to select, including their sublayers. */
  layerIds: any[];
  /** Receives deck.gl picking infos after the selection gesture completes. */
  onSelect: (info: any) => any;
  /** Draw a rectangle or polygon; null disables selection. */
  selectionType: string | null;
  /**
   * Element receiving selection input when it differs from deck.gl's render canvas.
   * For an overlaid MapboxOverlay, pass the base map's public getCanvas() result.
   */
  eventTarget?: HTMLElement | null;
  /**
   * Keep selection gestures from bubbling into the parent map.
   * Set to false when the application coordinates map interactions itself.
   * @default true
   */
  autoPreventMapInteractions?: boolean;
}

const defaultProps: DefaultProps<SelectionLayerProps<any>> = {
  selectionType: SELECTION_TYPE.RECTANGLE,
  eventTarget: {type: 'object', value: null, compare: 0},
  autoPreventMapInteractions: true,
  layerIds: [],
  onSelect: () => {}
};

const EMPTY_DATA = {
  type: 'FeatureCollection',
  features: []
};

const EMPTY_MASK = [];
const LAYER_ID_GEOJSON = 'selection-geojson';
const LAYER_ID_BLOCKER = 'selection-blocker';

function filterFeaturePicks(pickingInfos: any[]) {
  const seenObjects = new Set<unknown>();
  return pickingInfos.filter(info => {
    if (info.isGuide) return false;
    const object = info.object;
    if (object == null) return true;
    if (seenObjects.has(object)) return false;
    seenObjects.add(object);
    return true;
  });
}

const PASS_THROUGH_PROPS = [
  'eventTarget',
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
/** Draws a selection gesture over pickable layers placed before this layer. */
export class SelectionLayer<DataT, ExtraPropsT> extends CompositeLayer<
  ExtraPropsT & Required<SelectionLayerProps<DataT>>
> {
  static layerName = 'SelectionLayer';
  static defaultProps = defaultProps;

  state: {
    selectionMask: number[][][][];
    isSelecting: boolean;
  } = undefined!;

  _selectRectangleObjects(coordinates: any) {
    const {layerIds, onSelect} = this.props;
    // The corners are pointer map coordinates, so they project back from the camera target's plane.
    const [x1, y1] = projectOnTargetPlane(this.context.viewport, coordinates[0][0]);
    const [x2, y2] = projectOnTargetPlane(this.context.viewport, coordinates[0][2]);
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
    const mousePoints = coordinates[0].map(c => projectOnTargetPlane(this.context.viewport, c));

    const allX = mousePoints.map(mousePoint => mousePoint[0]);
    const allY = mousePoints.map(mousePoint => mousePoint[1]);
    const x = Math.min(...allX);
    const y = Math.min(...allY);
    const maxX = Math.max(...allX);
    const maxY = Math.max(...allY);

    // The blocker must cover the entire picking rectangle, regardless of the
    // lasso's geographic size or shape. Unproject a padded screen-space rectangle
    // instead of using a fixed-distance buffer that leaves holes in wide lassos.
    // The blocker draws its 2D rings at sea level, so both rings unproject there
    // from screen pixels; the lasso's own coordinates lie on the camera target's plane.
    const outerRing = [
      [x - 1, y - 1],
      [maxX + 1, y - 1],
      [maxX + 1, maxY + 1],
      [x - 1, maxY + 1],
      [x - 1, y - 1]
    ].map(position => this.context.viewport.unproject(position));
    const innerRing = mousePoints.map(position => this.context.viewport.unproject(position));

    this.setState({selectionMask: [[outerRing, innerRing]], isSelecting: true});
    let pickingInfos;
    try {
      // Picking renders its own framebuffer. Initialize the new blocker now,
      // rather than guessing when the next animation frame will have rendered it.
      this.context.layerManager.updateLayers();
      pickingInfos = this.context.deck.pickObjects({
        x,
        y,
        width: maxX - x,
        height: maxY - y,
        layerIds: [`${this.props.id}-${LAYER_ID_BLOCKER}`, ...layerIds]
      });
    } finally {
      this.setState({isSelecting: false});
      this.context.layerManager.updateLayers();
    }

    onSelect({
      pickingInfos: filterFeaturePicks(
        pickingInfos.filter(info => info.layer?.id !== this.props.id)
      )
    });
  }

  /** Draws the selection mask only during the active GPU picking pass. */
  filterSubLayer({layer, isPicking}: FilterContext): boolean {
    if (layer.id === `${this.props.id}-${LAYER_ID_BLOCKER}`) {
      return isPicking && Boolean(this.state.isSelecting);
    }
    return true;
  }

  renderLayers() {
    const {selectionMask} = this.state;

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

    // Keep the hidden mask layer initialized between gestures so repeated
    // selections reuse its GPU model instead of compiling a new one each time.
    layers.push(
      new PolygonLayer(
        this.getSubLayerProps({
          id: LAYER_ID_BLOCKER,
          pickable: true,
          stroked: false,
          data: selectionMask || EMPTY_MASK,
          getPolygon: coordinates => coordinates,
          // Cover elevated and extruded targets too; the SelectionLayer must
          // follow its target layers in the deck layer list.
          parameters: {depthCompare: 'always', depthWriteEnabled: false}
        })
      )
    );

    return layers;
  }

  shouldUpdateState({changeFlags: {stateChanged, propsOrDataChanged}}: Record<string, any>) {
    return stateChanged || propsOrDataChanged;
  }
}
