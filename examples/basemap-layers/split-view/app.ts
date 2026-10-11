// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  MapView,
  WebMercatorViewport,
  FirstPersonView,
  _GlobeView,
  type MapViewState,
  type FirstPersonViewState
} from '@deck.gl/core';
import {addMetersToLngLat} from '@math.gl/web-mercator';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import {Map, getWorkerUrl, setWorkerUrl} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -122.4194,
  latitude: 37.7749,
  zoom: 12,
  pitch: 0,
  bearing: 0,
  minZoom: 0,
  maxZoom: 20,
  maxPitch: 60
};
const STYLE_OPTIONS = ['liberty', 'positron', 'dark'] as const;

/** Mount two independently rendered maps sharing one camera and style selection. */
export function mountBasemapSplitViewExample(container: HTMLElement): () => void {
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;display:flex;background:#eee;';
  container.appendChild(root);
  const createPane = (label: string): HTMLDivElement => {
    const pane = document.createElement('div');
    pane.style.cssText = 'position:relative;flex:1;min-width:0;overflow:hidden;';
    pane.setAttribute('aria-label', label);
    root.appendChild(pane);
    const heading = document.createElement('div');
    heading.textContent = label;
    heading.style.cssText =
      'position:absolute;top:12px;left:12px;z-index:2;background:white;color:#222;padding:6px 10px;border-radius:4px;pointer-events:none;';
    pane.appendChild(heading);
    return pane;
  };
  const deckPane = createPane('basemap-layers · deck.gl');
  const mapPane = createPane('MapLibre GL JS');
  mapPane.style.boxShadow = 'inset 2px 0 #888';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Shared map style');
  select.style.cssText =
    'position:absolute;top:54px;left:12px;z-index:3;padding:4px;color:#222;background:white;';
  for (const style of STYLE_OPTIONS) {
    const option = document.createElement('option');
    option.value = style;
    option.textContent = `OpenFreeMap ${style}`;
    select.appendChild(option);
  }
  deckPane.appendChild(select);
  const attribution = document.createElement('div');
  attribution.style.cssText =
    'position:absolute;bottom:0;right:0;z-index:2;background:white;color:#222;padding:2px 5px;font-size:11px;';
  attribution.innerHTML =
    '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';
  deckPane.appendChild(attribution);
  const viewSelect = document.createElement('select');
  viewSelect.setAttribute('aria-label', 'View mode');
  viewSelect.style.cssText =
    'position:absolute;top:88px;left:12px;z-index:3;padding:4px;color:#222;background:white;';
  for (const [value, label] of [
    ['map', 'Map'],
    ['globe', 'Globe'],
    ['first-person', 'First Person']
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    viewSelect.appendChild(option);
  }
  deckPane.appendChild(viewSelect);
  const hint = document.createElement('div');
  hint.style.cssText =
    'position:absolute;top:122px;left:12px;right:12px;z-index:2;font:12px sans-serif;color:#222;background:#ffffffe0;padding:6px;pointer-events:none;';
  hint.textContent = 'Drag to pan; shift/right-drag to rotate and tilt.';
  deckPane.appendChild(hint);
  const unavailable = document.createElement('div');
  unavailable.setAttribute('role', 'status');
  unavailable.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:28px;background:#eef0f3;color:#222;text-align:center;';
  unavailable.textContent =
    'MapLibre cannot render this camera angle. Tilt down to resume the comparison.';
  mapPane.appendChild(unavailable);
  const mapHost = document.createElement('div');
  mapHost.style.cssText = 'position:absolute;inset:0;';
  mapPane.appendChild(mapHost);
  // MapLibre 6's module worker needs an explicit URL after Vite/website bundling.
  const previousWorkerUrl = getWorkerUrl();
  // A same-origin module bootstrap also avoids bundlers rewriting MapLibre's dynamic URL.
  const workerUrl = URL.createObjectURL(
    new Blob(['import "https://unpkg.com/maplibre-gl@6.4.1/dist/maplibre-gl-worker.mjs";'], {
      type: 'text/javascript'
    })
  );
  setWorkerUrl(workerUrl);
  let viewState = INITIAL_VIEW_STATE;
  let viewMode: 'map' | 'globe' | 'first-person' = 'map';
  let firstPersonState: FirstPersonViewState = {
    longitude: viewState.longitude,
    latitude: viewState.latitude,
    position: [0, 0, 600],
    bearing: 0,
    pitch: 60,
    minPitch: -85,
    maxPitch: 90
  };
  let syncingMap = false;
  let map: Map | null = null;
  const getStyleUrl = () => `https://tiles.openfreemap.org/styles/${select.value}`;
  const getBasemapLayer = () =>
    new BasemapLayer({
      id: `basemap-${select.value}-${viewMode}`,
      style: getStyleUrl(),
      mode: viewMode === 'globe' ? 'globe' : 'map'
    });
  const getFirstPersonCamera = () =>
    addMetersToLngLat(
      [firstPersonState.longitude, firstPersonState.latitude, 0],
      firstPersonState.position
    );
  const syncDeckCamera = () => {
    if (syncingMap || !map) return;
    if (viewMode === 'first-person') {
      const center = map.getCenter();
      const viewport = new WebMercatorViewport({
        width: mapHost.clientWidth,
        height: mapHost.clientHeight,
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
      });
      const camera = viewport.unprojectPosition(viewport.cameraPosition);
      firstPersonState = {
        ...firstPersonState,
        longitude: camera[0],
        latitude: camera[1],
        position: [0, 0, Math.max(10, camera[2])],
        bearing: map.getBearing(),
        pitch: 90 - map.getPitch()
      };
      deck.setProps({viewState: firstPersonState});
    } else {
      const center = map.getCenter();
      viewState = {
        ...viewState,
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
      };
      deck.setProps({viewState});
    }
  };
  const applyProjection = () =>
    map?.setProjection({type: viewMode === 'globe' ? 'globe' : 'mercator'});
  const createMap = () => {
    map = new Map({
      container: mapHost,
      style: getStyleUrl(),
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
      minZoom: 0,
      maxZoom: viewMode === 'first-person' ? 24 : INITIAL_VIEW_STATE.maxZoom,
      maxPitch: viewMode === 'first-person' ? 85 : INITIAL_VIEW_STATE.maxPitch,
      attributionControl: {compact: true}
    });
    map.on('move', syncDeckCamera);
    map.on('style.load', () => {
      applyProjection();
      syncMapCamera();
    });
  };
  const syncMapCamera = () => {
    const canRenderMap = viewMode !== 'first-person' || firstPersonState.pitch >= 5;
    unavailable.style.display = canRenderMap ? 'none' : 'flex';
    mapHost.style.display = canRenderMap ? 'block' : 'none';
    if (!canRenderMap) {
      map?.remove();
      map = null;
      return;
    }
    syncingMap = true;
    try {
      if (!map) createMap();
      const maxZoom = viewMode === 'first-person' ? 24 : INITIAL_VIEW_STATE.maxZoom;
      const maxPitch = viewMode === 'first-person' ? 85 : INITIAL_VIEW_STATE.maxPitch;
      if (map.getMaxZoom() !== maxZoom) map.setMaxZoom(maxZoom);
      if (map.getMaxPitch() !== maxPitch) map.setMaxPitch(maxPitch);
      if (viewMode === 'first-person') {
        const camera = getFirstPersonCamera();
        map.jumpTo(
          map.calculateCameraOptionsFromCameraLngLatAltRotation(
            [camera[0], camera[1]],
            camera[2],
            firstPersonState.bearing,
            90 - firstPersonState.pitch,
            0
          )
        );
      } else {
        map.jumpTo({
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          pitch: viewState.pitch,
          bearing: viewState.bearing
        });
      }
    } finally {
      syncingMap = false;
    }
  };
  let deck: Deck<MapView | FirstPersonView | _GlobeView>;
  let observer: ResizeObserver | undefined;
  try {
    deck = new Deck<MapView | FirstPersonView | _GlobeView>({
      parent: deckPane,
      views: new MapView({repeat: true}),
      viewState,
      controller: true,
      layers: [getBasemapLayer()],
      onViewStateChange: event => {
        if (viewMode === 'first-person') {
          firstPersonState = event.viewState as FirstPersonViewState;
          firstPersonState = {
            ...firstPersonState,
            position: [
              firstPersonState.position[0],
              firstPersonState.position[1],
              Math.max(10, firstPersonState.position[2])
            ]
          };
          deck.setProps({viewState: firstPersonState});
        } else {
          viewState = event.viewState as MapViewState;
          deck.setProps({viewState});
        }
        syncMapCamera();
      }
    });
    syncMapCamera();
    const changeStyle = () => {
      map?.setStyle(getStyleUrl());
      deck.setProps({layers: [getBasemapLayer()]});
    };
    const changeView = () => {
      if (viewMode === 'first-person') {
        const camera = getFirstPersonCamera();
        viewState = {
          ...viewState,
          longitude: camera[0],
          latitude: camera[1],
          bearing: firstPersonState.bearing
        };
      }
      viewMode = viewSelect.value as typeof viewMode;
      if (viewMode === 'first-person') {
        firstPersonState = {
          ...firstPersonState,
          longitude: viewState.longitude,
          latitude: viewState.latitude,
          position: [0, 0, 600],
          bearing: viewState.bearing,
          pitch: 60
        };
        deck.setProps({
          views: new FirstPersonView({
            id: viewMode,
            fovy: 36.86989764584402,
            near: 0.1,
            far: 20000
          }),
          viewState: firstPersonState
        });
        hint.textContent =
          'Drag to look; WASD / arrow keys or scroll to move. Free pitch; MapLibre pauses at unsupported angles.';
      } else {
        viewState = {...viewState, zoom: viewMode === 'globe' ? 1.5 : 12, pitch: 0};
        deck.setProps({
          views:
            viewMode === 'globe'
              ? new _GlobeView({id: viewMode})
              : new MapView({id: viewMode, repeat: true}),
          viewState
        });
        hint.textContent = 'Drag to pan; shift/right-drag to rotate and tilt.';
      }
      applyProjection();
      deck.setProps({layers: [getBasemapLayer()]});
      syncMapCamera();
    };
    select.addEventListener('change', changeStyle);
    viewSelect.addEventListener('change', changeView);
    observer = new ResizeObserver(() => {
      syncingMap = true;
      try {
        map?.resize();
      } finally {
        syncingMap = false;
      }
      syncMapCamera();
    });
    observer.observe(mapPane);
    return () => {
      observer?.disconnect();
      select.removeEventListener('change', changeStyle);
      viewSelect.removeEventListener('change', changeView);
      deck.finalize();
      map?.remove();
      if (getWorkerUrl() === workerUrl) setWorkerUrl(previousWorkerUrl);
      URL.revokeObjectURL(workerUrl);
      root.remove();
    };
  } catch (error) {
    observer?.disconnect();
    deck?.finalize();
    map?.remove();
    if (getWorkerUrl() === workerUrl) setWorkerUrl(previousWorkerUrl);
    URL.revokeObjectURL(workerUrl);
    root.remove();
    throw error;
  }
}
