// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  MapView,
  MapController,
  WebMercatorViewport,
  type DeckProps,
  type MapViewState,
  type PickingInfo,
  type Widget
} from '@deck.gl/core';
import {LineLayer, PolygonLayer, TextLayer} from '@deck.gl/layers';
import type {Device} from '@luma.gl/core';
import {TreeLayer, type Season} from '@deck.gl-community/three';
import {
  createFarmPlots,
  SEASONS,
  createTreeSamples,
  getFarmPosition,
  getFoliageColor,
  getBarkColor,
  getSeasonalCanopyRadius,
  getSeasonalCrop,
  createWinterBranches,
  type FarmTree,
  type FarmPlot
} from './farm-data';
import './style.css';

export type WildForestExampleOptions = {
  showControlsWidget?: boolean;
  /** Reuse the website's selected graphics device and widgets. */
  device?: Device;
  widgets?: Widget[];
  /** Restore and publish the camera when switching website graphics backends. */
  initialViewState?: MapViewState;
  onViewStateChange?: DeckProps<MapView>['onViewStateChange'];
  onDeckInitialized?: (deck: Deck<MapView>) => void;
};

const FARMS = [2, 3].map(columns => {
  const plots = createFarmPlots(columns);
  const trees = createTreeSamples(plots);
  return {
    plots: plots.map(plot => ({
      ...plot,
      trees: trees.filter(tree => tree.plotId === plot.species)
    })),
    trees,
    branches: createWinterBranches(trees)
  };
});
// Keep the season when the website remounts for a graphics backend switch.
const HOST_SEASON = new WeakMap<HTMLElement, Season>();
const VIEW_LIMITS = {maxZoom: 23, maxPitch: 80};

/** Frame the initial planting and refit when its responsive layout changes. */
function getFarmView(width: number, height: number, plots: FarmPlot[]): MapViewState {
  const view = new WebMercatorViewport({
    width: Math.max(180, width),
    height: Math.max(300, height)
  }).fitBounds(
    [
      getFarmPosition(-12, -12).slice(0, 2) as [number, number],
      getFarmPosition(plots[6].bounds[2] + 12, plots[6].bounds[3] + 12).slice(0, 2) as [
        number,
        number
      ]
    ],
    {
      padding: {top: 100, bottom: 80, left: 24, right: 24}
    }
  );
  return {
    ...VIEW_LIMITS,
    longitude: view.longitude,
    latitude: view.latitude,
    zoom: view.zoom,
    pitch: 35,
    bearing: 0
  };
}

/** Mount a compact demonstration farm with seasonal trees and labelled plots. */
export function mountWildForestExample(
  container: HTMLElement,
  options: WildForestExampleOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'forest-farm';
  root.dataset.managedDevice = String(Boolean(options.device));
  root.innerHTML = `
    <div class="farm-canvas"></div>
    <header class="farm-title"><h1>Seasonal farm</h1><p>7 plots · ${FARMS[0].trees.length} trees · hover to inspect</p></header>
    <div class="farm-seasons" role="group" aria-label="Season" ${options.showControlsWidget === false ? 'hidden' : ''}>
      ${SEASONS.map(season => `<button type="button" data-season="${season}" aria-pressed="false">${season[0].toUpperCase() + season.slice(1)}</button>`).join('')}
    </div>
    <small class="farm-note">Illustrative planting · fruit and flowers enlarged</small>`;
  container.replaceChildren(root);
  let season = HOST_SEASON.get(container) ?? 'spring';
  let farm = FARMS[container.clientWidth < 600 ? 0 : 1];
  let currentView: MapViewState = {
    ...(options.initialViewState ??
      getFarmView(container.clientWidth, container.clientHeight, farm.plots)),
    ...VIEW_LIMITS
  };
  const deck = new Deck({
    parent: root.querySelector<HTMLDivElement>('.farm-canvas')!,
    device: options.device,
    widgets: options.widgets ?? [],
    views: new MapView({id: 'farm'}),
    initialViewState: currentView,
    controller: {type: MapController, touchRotate: true},
    onViewStateChange(params) {
      currentView = options.onViewStateChange?.(params) || params.viewState;
      return currentView as typeof params.viewState;
    },
    useDevicePixels: Math.min(2, container.ownerDocument.defaultView?.devicePixelRatio || 1),
    layers: createLayers(),
    onResize() {
      // A website-managed device starts with a 1×1 canvas before reparenting.
      const {clientWidth: width, clientHeight: height} = container;
      const next = FARMS[width < 600 ? 0 : 1];
      if (next === farm) return;
      farm = next;
      const viewState = getFarmView(width, height, farm.plots);
      currentView =
        options.onViewStateChange?.({
          viewId: 'farm',
          viewState,
          oldViewState: currentView,
          interactionState: {}
        }) || viewState;
      deck.setProps({initialViewState: currentView, layers: createLayers()});
    },
    getTooltip(info: PickingInfo) {
      const viewport = deck.getViewports()[0];
      if (!viewport) return null;
      // Inspect projected crowns directly: no GPU picking pass or readback needed.
      const tree = farm.trees.find(tree => {
        const crown = [
          tree.position[0],
          tree.position[1],
          tree.height * (0.5 + tree.trunkFraction * 0.5)
        ];
        const [x, y] = viewport.project(crown);
        const [edgeX, edgeY] = viewport.project(
          getFarmPosition(tree.canopyRadius, 0).map((value, index) => value + crown[index])
        );
        return Math.hypot(info.x - x, info.y - y) < Math.max(4, Math.hypot(edgeX - x, edgeY - y));
      });
      if (tree) {
        const crop = getSeasonalCrop(tree, season);
        return {
          text: `${tree.label} · ${tree.maturity}\n${tree.height.toFixed(1)} m tall · ${Math.round(tree.vigor * 100)}% vigour\n${crop ? `${crop.count} fruit / flowers · ${crop.droppedCount} fallen` : 'No fruit or flowers this season'}`
        };
      }
      const [lng, lat] = viewport.unproject([info.x, info.y]);
      const plot = farm.plots.find(
        ({polygon: [sw, , ne]}) => lng >= sw[0] && lng <= ne[0] && lat >= sw[1] && lat <= ne[1]
      );
      return plot
        ? {
            text: `${plot.label} plot\n${plot.trees.length} trees · ${season}\nVaried ages, sizes, and crop loads`
          }
        : null;
    }
  });
  options.onDeckInitialized?.(deck);
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-season]');
  const updateControls = () => {
    root.dataset.season = season;
    buttons.forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.season === season))
    );
  };
  buttons.forEach(button => {
    button.onclick = () => {
      season = button.dataset.season as Season;
      deck.setProps({layers: createLayers()});
      updateControls();
    };
  });
  updateControls();
  return () => {
    HOST_SEASON.set(container, season);
    deck.finalize();
    root.remove();
  };

  function createLayers() {
    return [
      new PolygonLayer({
        id: 'farm-plots',
        data: farm.plots,
        getPolygon: plot => plot.polygon,
        getFillColor: season === 'winter' ? [234, 235, 222, 255] : [224, 231, 204, 255],
        getLineColor: [128, 145, 107, 255],
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels'
      }),
      ...farm.plots.map(
        plot =>
          new TreeLayer<FarmTree>({
            id: `farm-trees-${plot.species}`,
            data: plot.trees,
            getPosition: tree => tree.position,
            getTreeType: tree => tree.type,
            getHeight: tree => tree.height,
            getTrunkRadius: tree => tree.trunkRadius,
            getCanopyRadius: tree => getSeasonalCanopyRadius(tree, season),
            getTrunkColor: getBarkColor,
            getTrunkHeightFraction: tree => tree.trunkFraction,
            getBranchLevels: tree => tree.branchLevels,
            getCanopyColor: tree => getFoliageColor(tree, season),
            getCrop: tree => getSeasonalCrop(tree, season),
            _subLayerProps:
              season === 'winter' && ['cherry', 'birch', 'almond'].includes(plot.species)
                ? {[`canopy-${plot.trees[0].type}`]: {visible: false}}
                : {},
            parameters: {cullMode: 'none'},
            updateTriggers: {getCanopyRadius: season, getCanopyColor: season, getCrop: season}
          })
      ),
      new LineLayer({
        id: 'farm-winter',
        data: season === 'winter' ? farm.branches : [],
        getSourcePosition: branch => branch.source,
        getTargetPosition: branch => branch.target,
        getColor: [113, 92, 69, 255],
        getWidth: 1.2
      }),
      new TextLayer({
        id: 'farm-labels',
        data: farm.plots,
        getPosition: plot =>
          getFarmPosition((plot.bounds[0] + plot.bounds[2]) / 2, plot.bounds[1] + 3, 0.2),
        getText: plot => plot.label,
        getSize: 12,
        getColor: [57, 75, 47, 255],
        fontFamily: 'system-ui',
        fontWeight: 600,
        background: true,
        getBackgroundColor: [248, 249, 241, 240],
        backgroundPadding: [5, 3],
        parameters: {depthCompare: 'always', depthWriteEnabled: false}
      })
    ];
  }
}
