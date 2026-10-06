// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SnappingStrategy} from './snapping/snapping-strategy';

import {StartDraggingEvent, ModeProps} from './types';
import {SimpleFeatureCollection} from '../utils/geojson-types';
import {TranslateMode} from './translate-mode';

export class DuplicateMode extends TranslateMode {
  handleStartDragging(event: StartDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    super.handleStartDragging(event, props);

    if (this._geometryBeforeTranslate) {
      props.onEdit(this.getAddManyFeaturesAction(this._geometryBeforeTranslate, props.data));
    }
  }

  updateCursor(props: ModeProps<SimpleFeatureCollection>) {
    if (this._isTranslatable) {
      props.onUpdateCursor('copy');
    } else {
      props.onUpdateCursor(null);
    }
  }

  /** Returns the snapping policy for this mode, or undefined to opt out. */
  getSnappingStrategy(): SnappingStrategy | undefined {
    return undefined;
  }
}
