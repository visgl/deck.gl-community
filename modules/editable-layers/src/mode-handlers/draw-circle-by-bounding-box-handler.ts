// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import circle from '@turf/circle';
import distance from '@turf/distance';
import {PointerMoveEvent} from '../edit-modes/types';
import {EditAction, getIntermediatePosition} from './mode-handler';
import {TwoClickPolygonHandler} from './two-click-polygon-handler';

// TODO edit-modes: delete handlers once EditMode fully implemented
export class DrawCircleByBoundingBoxHandler extends TwoClickPolygonHandler {
  handlePointerMove(event: PointerMoveEvent): {
    editAction: EditAction | null | undefined;
    cancelMapPan: boolean;
  } {
    const result = {editAction: null, cancelMapPan: false};
    const clickSequence = this.getClickSequence();

    if (clickSequence.length === 0) {
      // nothing to do yet
      return result;
    }

    const modeConfig = this.getModeConfig() || {};
    // Default turf value for circle is 64
    const {steps = 64} = modeConfig;
    const options = {steps};

    if (steps < 4) {
      console.warn('Minimum steps to draw a circle is 4 '); // eslint-disable-line no-console,no-undef
      options.steps = 4;
    }

    const firstClickedPoint = clickSequence[0];
    const centerCoordinates = getIntermediatePosition(firstClickedPoint, event.mapCoords);
    const radius = Math.max(distance(firstClickedPoint, centerCoordinates), 0.001);
    // @ts-expect-error turf types diff
    this._setTentativeFeature(circle(centerCoordinates, radius, options));

    return result;
  }
}
