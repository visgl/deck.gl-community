// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Layer, PickingInfo, MapViewState} from '@deck.gl/core';
import {MapboxOverlay} from '@deck.gl/mapbox';
import * as arrow from 'apache-arrow';
import maplibregl from 'maplibre-gl';

import 'maplibre-gl/dist/maplibre-gl.css';

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%'
} as const;

const MAP_STYLE = {
  position: 'absolute',
  inset: '0'
} as const;

const DEFAULT_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json';

type AnimationState = {
  currentTime: number;
};

type AnimationOptions = {
  loopLength: number;
  animationSpeed: number;
};

type GeoArrowMapExampleConfig = {
  dataUrl: string;
  initialViewState: MapViewState;
  getLayers: (table: arrow.Table, animationState: AnimationState) => Layer[];
  onClick?: (info: PickingInfo) => void;
  mapStyle?: string;
  animation?: AnimationOptions;
};

/**
 * Mounts a GeoArrow example into the provided container using MapLibre and MapboxOverlay.
 */
export function mountGeoArrowMapExample(
  container: HTMLElement,
  config: GeoArrowMapExampleConfig
): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const map = new maplibregl.Map({
    container: mapElement,
    style: config.mapStyle ?? DEFAULT_MAP_STYLE,
    center: [config.initialViewState.longitude ?? 0, config.initialViewState.latitude ?? 0],
    zoom: config.initialViewState.zoom ?? 0,
    pitch: config.initialViewState.pitch ?? 0,
    bearing: config.initialViewState.bearing ?? 0
  });

  const overlay = new MapboxOverlay({
    interleaved: false,
    onClick: config.onClick,
    layers: []
  });
  map.addControl(overlay);
  map.addControl(new maplibregl.NavigationControl(), 'top-left');

  let animationFrame = 0;
  let isDisposed = false;
  let table: arrow.Table | null = null;
  const animationState: AnimationState = {currentTime: 0};

  const updateLayers = () => {
    overlay.setProps({
      onClick: config.onClick,
      layers: table ? config.getLayers(table, animationState) : []
    });
  };

  const tick = () => {
    if (isDisposed || !config.animation) {
      return;
    }
    animationState.currentTime =
      (animationState.currentTime + config.animation.animationSpeed) % config.animation.loopLength;
    updateLayers();
    animationFrame = window.requestAnimationFrame(tick);
  };

  void fetch(config.dataUrl)
    .then((response) => response.arrayBuffer())
    .then((buffer) => {
      if (isDisposed) {
        return;
      }
      table = arrow.tableFromIPC(buffer);
      updateLayers();
      if (config.animation) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    })
    .catch((error) => {
      console.error(error);
    });

  return () => {
    isDisposed = true;
    window.cancelAnimationFrame(animationFrame);
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
