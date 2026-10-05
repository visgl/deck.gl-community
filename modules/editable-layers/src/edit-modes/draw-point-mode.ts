// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SnappingStrategy} from './snapping/snapping-strategy';

import {ClickEvent, PointerMoveEvent, ModeProps, TentativeFeature} from './types';
import {SimpleFeatureCollection, Point} from '../utils/geojson-types';
import {GeoJsonEditMode} from './geojson-edit-mode';
import {ClickSnappingStrategy} from './snapping/click-snapping-strategy';
import {SnappableEditMode} from './snappable-edit-mode';

export class DrawPointMode extends GeoJsonEditMode implements SnappableEditMode {
  createTentativeFeature(props: ModeProps<SimpleFeatureCollection>): TentativeFeature {
    const {lastPointerMoveEvent} = props;
    const lastCoords = lastPointerMoveEvent ? [lastPointerMoveEvent.mapCoords] : [];

    return {
      type: 'Feature',
      properties: {
        guideType: 'tentative'
      },
      geometry: {
        type: 'Point',
        coordinates: lastCoords[0]
      }
    };
  }

  handleClick({mapCoords}: ClickEvent, props: ModeProps<SimpleFeatureCollection>): void {
    const geometry: Point = {
      type: 'Point',
      coordinates: mapCoords
    };

    props.onEdit(this.getAddFeatureAction(geometry, props.data));
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<SimpleFeatureCollection>) {
    props.onUpdateCursor('cell');
    super.handlePointerMove(event, props);
  }

  /** Returns the snapping policy for this mode, or undefined to opt out. */
  getSnappingStrategy(): SnappingStrategy | undefined {
    return new ClickSnappingStrategy();
  }
}
