// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SnappingStrategy} from './snapping/snapping-strategy';
import type {EditModeCoordinateSystem} from './coordinate-system';

import {SimpleFeatureCollection} from '../utils/geojson-types';
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
import {GeoCoordinateSystem, getEditModeCoordinateSystem} from './coordinate-system';
import {SnappableEditMode} from './snappable-edit-mode';
import {ClickSnappingStrategy} from './snapping/click-snapping-strategy';

/**
 * Measures a path with cumulative distance tooltips and per-segment measurement callbacks.
 * Built-in geographic output uses modeConfig.turfOptions.units (kilometers by default).
 * Native distances retain their values; use modeConfig.formatTooltip for custom labels.
 */
export class MeasureDistanceMode extends GeoJsonEditMode implements SnappableEditMode {
  _isMeasuringSessionFinished = false;
  _currentTooltips: Tooltip[] = [];
  _currentDistance = 0;
  _currentUnits?: string;

  _calculateDistanceForTooltip = ({positionA, positionB, modeConfig, coordinateSystem}) => {
    const {turfOptions, measurementCallback} = modeConfig || {};
    const distance = getEditModeCoordinateSystem(coordinateSystem).distance(
      positionA,
      positionB,
      turfOptions
    );

    if (measurementCallback) {
      measurementCallback(distance);
    }

    return distance;
  };

  _formatTooltip(distance: number, modeConfig?: any, coordinateSystem?: EditModeCoordinateSystem) {
    const {formatTooltip, turfOptions} = modeConfig || {};
    // Only the built-in distance implementation guarantees Turf's output units.
    const units =
      getEditModeCoordinateSystem(coordinateSystem).distance ===
      GeoCoordinateSystem.prototype.distance
        ? turfOptions?.units || 'kilometers'
        : 'units';

    let text;
    if (formatTooltip) {
      text = formatTooltip(distance);
    } else {
      // By default, round to 2 decimal places and append units
      text = `${distance.toFixed(2)} ${units}`;
    }

    return text;
  }

  _updateCachedMeasurements(props: ModeProps<SimpleFeatureCollection>) {
    const {modeConfig} = props;
    const {turfOptions, centerTooltipsOnLine = false} = modeConfig || {};
    const units = turfOptions?.units;
    if (units === this._currentUnits) return;

    const positions = this.getClickSequence();
    const coordSys = getEditModeCoordinateSystem(props.coordinateSystem);
    let distance = 0;
    const tooltips: Tooltip[] = positions.slice(1).map((position, index) => {
      const previousPosition = positions[index];
      distance += coordSys.distance(previousPosition, position, turfOptions);
      return {
        position: centerTooltipsOnLine ? coordSys.midpoint(previousPosition, position) : position,
        text: this._formatTooltip(distance, modeConfig, coordSys)
      };
    });

    this._currentDistance = distance;
    this._currentTooltips = tooltips;
    this._currentUnits = units;
  }

  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    const {modeConfig, data, onEdit} = props;
    const {centerTooltipsOnLine = false} = modeConfig || {};
    const coordSys = getEditModeCoordinateSystem(props.coordinateSystem);

    // restart measuring session
    if (this._isMeasuringSessionFinished) {
      this._isMeasuringSessionFinished = false;
      this.resetClickSequence();
      this._currentTooltips = [];
      this._currentDistance = 0;
    }

    this._updateCachedMeasurements(props);

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
          text: this._formatTooltip(this._currentDistance, modeConfig, coordSys)
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

  handleKeyUp(event: KeyboardEvent, props: ModeProps<SimpleFeatureCollection>) {
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

  getGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
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

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<SimpleFeatureCollection>) {
    props.onUpdateCursor('cell');
  }

  getTooltips(props: ModeProps<SimpleFeatureCollection>): Tooltip[] {
    this._updateCachedMeasurements(props);
    const {lastPointerMoveEvent, modeConfig} = props;
    const {centerTooltipsOnLine = false} = modeConfig || {};
    const positions = this.getClickSequence();
    const coordSys = getEditModeCoordinateSystem(props.coordinateSystem);

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
          text: this._formatTooltip(this._currentDistance + distance, modeConfig, coordSys)
        }
      ];
    }

    return this._currentTooltips;
  }

  /** Returns the snapping policy for this mode, or undefined to opt out. */
  getSnappingStrategy(): SnappingStrategy | undefined {
    return new ClickSnappingStrategy();
  }
}
