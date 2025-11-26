// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Position, LineString} from 'geojson';
import {ClickEvent, PointerMoveEvent} from '../edit-modes/types';
import {EditAction, ModeHandler} from './mode-handler';

// TODO edit-modes: delete handlers once EditMode fully implemented
export class DrawLineStringHandler extends ModeHandler {
  handleClick(event: ClickEvent): EditAction | null | undefined {
    super.handleClick(event);

    let editAction: EditAction | null | undefined = null;
    const selectedFeatureIndexes = this.getSelectedFeatureIndexes();
    const selectedGeometry = this.getSelectedGeometry();
    const tentativeFeature = this.getTentativeFeature();
    const clickSequence = this.getClickSequence();

    if (
      selectedFeatureIndexes.length > 1 ||
      (selectedGeometry && selectedGeometry.type !== 'LineString')
    ) {
      console.warn(`drawLineString mode only supported for single LineString selection`); // eslint-disable-line
      this.resetClickSequence();
      return null;
    }

    if (selectedGeometry && selectedGeometry.type === 'LineString') {
      // Extend the LineString
      const lineString: LineString = selectedGeometry;

      let positionIndexes = [lineString.coordinates.length];

      const modeConfig = this.getModeConfig();
      if (modeConfig && modeConfig.drawAtFront) {
        positionIndexes = [0];
      }
      const featureIndex = selectedFeatureIndexes[0];
      const updatedData = this.getImmutableFeatureCollection()
        .addPosition(featureIndex, positionIndexes, event.mapCoords)
        .getObject();

      editAction = {
        updatedData,
        editType: 'addPosition',
        featureIndexes: [featureIndex],
        editContext: {
          positionIndexes,
          position: event.mapCoords
        }
      };

      this.resetClickSequence();
    } else if (clickSequence.length === 2 && tentativeFeature) {
      // Add a new LineString
      const geometry: any = tentativeFeature.geometry;
      editAction = this.getAddFeatureAction(geometry);

      this.resetClickSequence();
    }

    return editAction;
  }

  handlePointerMove(event: PointerMoveEvent): {
    editAction: EditAction | null | undefined;
    cancelMapPan: boolean;
  } {
    const result = {editAction: null, cancelMapPan: false};

    const clickSequence = this.getClickSequence();
    const mapCoords = event.mapCoords;

    let startPosition: Position | null | undefined = null;
    const selectedFeatureIndexes = this.getSelectedFeatureIndexes();
    const selectedGeometry = this.getSelectedGeometry();

    if (
      selectedFeatureIndexes.length > 1 ||
      (selectedGeometry && selectedGeometry.type !== 'LineString')
    ) {
      // unsupported
      return result;
    }

    if (selectedGeometry && selectedGeometry.type === 'LineString') {
      // Draw an extension line starting from one end of the selected LineString
      startPosition = selectedGeometry.coordinates[selectedGeometry.coordinates.length - 1];

      const modeConfig = this.getModeConfig();
      if (modeConfig && modeConfig.drawAtFront) {
        startPosition = selectedGeometry.coordinates[0];
      }
    } else if (clickSequence.length === 1) {
      startPosition = clickSequence[0];
    }

    if (startPosition) {
      this._setTentativeFeature({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [startPosition, mapCoords]
        }
      });
    }

    return result;
  }
}
