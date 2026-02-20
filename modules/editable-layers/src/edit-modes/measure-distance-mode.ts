// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FeatureCollection} from '../utils/geojson-types';
import {
  ClickEvent,
  PointerMoveEvent,
  ModeProps,
  GuideFeatureCollection,
  Tooltip,
  GuideFeature
} from './types';
import {getPickedEditHandle} from './utils';
import {GeoJsonEditMode} from './geojson-edit-mode';
import {getCoordinateSystem} from './coordinate-system';

export class MeasureDistanceMode extends GeoJsonEditMode {
  _isMeasuringSessionFinished = false;
  _currentTooltips: Tooltip[] = [];
  _currentDistance = 0;

  _calculateDistanceForTooltip = ({positionA, positionB, modeConfig, coordinateSystem}) => {
    const {measurementCallback} = modeConfig || {};
    const distance = getCoordinateSystem(coordinateSystem).distance(positionA, positionB);

    if (measurementCallback) {
      measurementCallback(distance);
    }

    return distance;
  };

  _formatTooltip(distance, modeConfig?) {
    const {formatTooltip, turfOptions} = modeConfig || {};
    const units = (turfOptions && turfOptions.units) || 'kilometers';

    let text;
    if (formatTooltip) {
      text = formatTooltip(distance);
    } else {
      // By default, round to 2 decimal places and append units
      text = `${parseFloat(distance).toFixed(2)} ${units}`;
    }

    return text;
  }

  handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    const {modeConfig, data, onEdit} = props;
    const {centerTooltipsOnLine = false} = modeConfig || {};
    const coordSys = getCoordinateSystem(props.coordinateSystem);

    // restart measuring session
    if (this._isMeasuringSessionFinished) {
      this._isMeasuringSessionFinished = false;
      this.resetClickSequence();
      this._currentTooltips = [];
      this._currentDistance = 0;
    }

    const {picks} = event;
    const clickedEditHandle = getPickedEditHandle(picks);

    let positionAdded = false;
    if (!clickedEditHandle) {
      // Don't add another point right next to an existing one
      this.addClickSequence(event);
      positionAdded = true;
    }
    const clickSequence = this.getClickSequence();

    if (
      clickSequence.length > 1 &&
      clickedEditHandle &&
      Array.isArray(clickedEditHandle.properties.positionIndexes) &&
      clickedEditHandle.properties.positionIndexes[0] === clickSequence.length - 1
    ) {
      // They clicked the last point (or double-clicked), so add the LineString
      this._isMeasuringSessionFinished = true;
    } else if (positionAdded) {
      if (clickSequence.length > 1) {
        this._currentDistance += this._calculateDistanceForTooltip({
          positionA: clickSequence[clickSequence.length - 2],
          positionB: clickSequence[clickSequence.length - 1],
          modeConfig,
          coordinateSystem: coordSys
        });

        const tooltipPosition = centerTooltipsOnLine
          ? coordSys.midpoint(
              clickSequence[clickSequence.length - 2],
              clickSequence[clickSequence.length - 1]
            )
          : event.mapCoords;

        this._currentTooltips.push({
          position: tooltipPosition,
          text: this._formatTooltip(this._currentDistance, modeConfig)
        });
      }

      // new tentative point
      onEdit({
        // data is the same
        updatedData: data,
        editType: 'addTentativePosition',
        editContext: {
          position: event.mapCoords
        }
      });
    }
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
    if (this._isMeasuringSessionFinished) return;

    event.stopPropagation();
    const {key} = event;

    const clickSequenceLength = this.getClickSequence().length;

    switch (key) {
      case 'Escape':
        this._isMeasuringSessionFinished = true;
        if (clickSequenceLength === 1) {
          this.resetClickSequence();
          this._currentTooltips = [];
        }
        // force update drawings
        props.onUpdateCursor('cell');
        break;
      case 'Enter':
        this.handleClick(props.lastPointerMoveEvent, props);
        this._isMeasuringSessionFinished = true;
        break;
      default:
        break;
    }
  }

  getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const {lastPointerMoveEvent} = props;
    const clickSequence = this.getClickSequence();

    const lastCoords =
      lastPointerMoveEvent && !this._isMeasuringSessionFinished
        ? [lastPointerMoveEvent.mapCoords]
        : [];

    const guides: GuideFeatureCollection = {
      type: 'FeatureCollection',
      features: []
    };

    if (clickSequence.length > 0) {
      guides.features.push({
        type: 'Feature',
        properties: {
          guideType: 'tentative'
        },
        geometry: {
          type: 'LineString',
          coordinates: [...clickSequence, ...lastCoords]
        }
      });
    }

    const editHandles: GuideFeature[] = clickSequence.map((clickedCoord, index) => ({
      type: 'Feature',
      properties: {
        guideType: 'editHandle',
        editHandleType: 'existing',
        featureIndex: -1,
        positionIndexes: [index]
      },
      geometry: {
        type: 'Point',
        coordinates: clickedCoord
      }
    }));

    guides.features.push(...editHandles);

    return guides;
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    props.onUpdateCursor('cell');
  }

  getTooltips(props: ModeProps<FeatureCollection>): Tooltip[] {
    const {lastPointerMoveEvent, modeConfig} = props;
    const {centerTooltipsOnLine = false} = modeConfig || {};
    const positions = this.getClickSequence();
    const coordSys = getCoordinateSystem(props.coordinateSystem);

    if (positions.length > 0 && lastPointerMoveEvent && !this._isMeasuringSessionFinished) {
      const distance = this._calculateDistanceForTooltip({
        positionA: positions[positions.length - 1],
        positionB: lastPointerMoveEvent.mapCoords,
        modeConfig: props.modeConfig,
        coordinateSystem: coordSys
      });

      const tooltipPosition = centerTooltipsOnLine
        ? coordSys.midpoint(positions[positions.length - 1], lastPointerMoveEvent.mapCoords)
        : lastPointerMoveEvent.mapCoords;

      return [
        ...this._currentTooltips,
        {
          position: tooltipPosition,
          text: this._formatTooltip(this._currentDistance + distance, modeConfig)
        }
      ];
    }

    return this._currentTooltips;
  }
}
