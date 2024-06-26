// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Position} from '../utils/geojson-types';

export class LayerMouseEvent {
  canceled: boolean = false;
  // original item that this event is related to
  data: Record<string, any>;
  // internal nebula info about the object
  metadata: Record<string, any>;
  // the mouse [lng,lat] raycasted onto the ground
  groundPoint: Position;
  // browser event
  nativeEvent: MouseEvent;
  // reference to nebula
  nebula: Record<string, any>;

  constructor(nativeEvent: MouseEvent, {data, groundPoint, nebula, metadata}: Record<string, any>) {
    this.nativeEvent = nativeEvent;

    this.data = data;
    this.groundPoint = groundPoint;
    this.nebula = nebula;
    this.metadata = metadata;
  }

  stopPropagation() {
    this.nativeEvent.stopPropagation();
    this.canceled = true;
  }
}
