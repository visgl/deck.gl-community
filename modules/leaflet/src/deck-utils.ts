// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as L from 'leaflet';
import {Deck} from '@deck.gl/core';
import type {DeckProps, View, ViewStateMap, MapView} from '@deck.gl/core';

export type ViewOrViews = View | View[] | null;

function getViewState(map: L.Map): ViewStateMap<MapView> {
  return {
    longitude: map.getCenter().lng,
    latitude: map.getCenter().lat,
    zoom: map.getZoom() - 1,
    pitch: 0,
    bearing: 0
  };
}

export function createDeckInstance(
  map: L.Map,
  container: HTMLDivElement,
  deck: Deck<ViewOrViews> | undefined,
  props: DeckProps<ViewOrViews>
): Deck<ViewOrViews> {
  if (!deck) {
    const viewState = getViewState(map);
    deck = new Deck({
      ...props,
      parent: container,
      controller: false,
      style: {zIndex: 'auto'},
      viewState
    });
  }
  return deck;
}

export function updateDeckView(deck: Deck<ViewOrViews>, map: L.Map): void {
  const viewState = getViewState(map);
  // console.log(viewState);

  deck.setProps({viewState});
  deck.redraw();
}
