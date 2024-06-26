// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent} from '../edit-modes/types';
import {ModeHandler, EditAction} from './mode-handler';

// TODO edit-modes: delete handlers once EditMode fully implemented
export class ThreeClickPolygonHandler extends ModeHandler {
  handleClick(event: ClickEvent): EditAction | null | undefined {
    super.handleClick(event);

    const tentativeFeature = this.getTentativeFeature();
    const clickSequence = this.getClickSequence();

    if (
      clickSequence.length > 2 &&
      tentativeFeature &&
      tentativeFeature.geometry.type === 'Polygon'
    ) {
      const editAction = this.getAddFeatureOrBooleanPolygonAction(tentativeFeature.geometry);
      this.resetClickSequence();
      this._setTentativeFeature(null);
      return editAction;
    }

    return null;
  }
}
