// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Map} from 'maplibre-gl';

type ToggleableMapHandler = {
  enable: () => void;
  disable: () => void;
  isEnabled?: () => boolean;
};

type MapInteractionState = {
  dragPanWasEnabled: boolean;
  dragRotateWasEnabled: boolean;
};

const mapInteractionStates = new WeakMap<Map, MapInteractionState>();

export function syncMapEditInteractions(map: Map, isEditing: boolean): void {
  if (isEditing) {
    if (!mapInteractionStates.has(map)) {
      mapInteractionStates.set(map, {
        dragPanWasEnabled: isMapHandlerEnabled(map.dragPan),
        dragRotateWasEnabled: isMapHandlerEnabled(map.dragRotate)
      });
    }

    map.dragPan.disable();
    map.dragRotate.disable();
    return;
  }

  const previousState = mapInteractionStates.get(map);
  if (!previousState) {
    return;
  }

  if (previousState.dragPanWasEnabled) {
    map.dragPan.enable();
  }
  if (previousState.dragRotateWasEnabled) {
    map.dragRotate.enable();
  }

  mapInteractionStates.delete(map);
}

function isMapHandlerEnabled(handler: ToggleableMapHandler): boolean {
  return typeof handler.isEnabled === 'function' ? handler.isEnabled() : true;
}
