// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SimpleGeometry} from '../utils/geojson-types';
import {ClickEvent} from '../edit-modes/types';
import {EditAction, ModeHandler} from './mode-handler';

// TODO edit-modes: delete handlers once EditMode fully implemented
export class DrawPointHandler extends ModeHandler {
  handleClick({mapCoords}: ClickEvent): EditAction | null | undefined {
    const geometry: SimpleGeometry = {
      type: 'Point',
      coordinates: mapCoords
    };

    return this.getAddFeatureAction(geometry);
  }
}
