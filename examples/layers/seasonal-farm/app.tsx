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
import {PolygonLayer} from '@deck.gl/layers';
import type {Device} from '@luma.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {SettingsPanel, type SettingsState} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {
  createFarmPlots,
  createTreeSamples,
  getFarmPosition,
  getFoliageColor,
  getBarkColor,
  getSeasonalCanopyRadius,
  getSeasonalCrop,
  getTreeSeason,
  type FarmTree,
  type FarmPlot
} from './farm-data';
import {DEFAULT_FARM_SETTINGS, SETTINGS_SCHEMA, type FarmSettings} from './settings';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

export type SeasonalFarmExampleOptions = {
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
    trees
  };
});
// Keep the settings when the website remounts for a graphics backend switch.
const HOST_SETTINGS = new WeakMap<HTMLElement, FarmSettings>();
const VIEW_LIMITS = {maxZoom: 23, maxPitch: 80};
const NARROW_WIDTH = 600;

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
      padding: {top: 48, bottom: 24, left: 24, right: 24}
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

/** Mount a compact demonstration farm whose TreeLayer props are driven by a settings panel. */
export function mountSeasonalFarmExample(
  container: HTMLElement,
  options: SeasonalFarmExampleOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'seasonal-farm';
  root.setAttribute('aria-label', 'Farm plots planted with seasonal trees');
  container.replaceChildren(root);
  let settings = HOST_SETTINGS.get(container) ?? DEFAULT_FARM_SETTINGS;
  root.dataset.season = settings.season;
  let farm = FARMS[container.clientWidth < NARROW_WIDTH ? 0 : 1];
  let currentView: MapViewState = {
    ...(options.initialViewState ??
      getFarmView(container.clientWidth, container.clientHeight, farm.plots)),
    ...VIEW_LIMITS
  };
  const controls = new BoxPanelWidget({
    id: 'seasonal-farm-controls',
    title: 'TreeLayer',
    placement: 'top-left',
    widthPx: 320,
    collapsible: true,
    defaultOpen: container.clientWidth >= NARROW_WIDTH,
    panel: new SettingsPanel({
      id: 'seasonal-farm-settings',
      schema: SETTINGS_SCHEMA,
      settings: settings as unknown as SettingsState,
      onSettingsChange(nextSettings) {
        settings = nextSettings as unknown as FarmSettings;
        updateLayers();
      }
    })
  });
  const deck = new Deck({
    parent: root,
    device: options.device,
    widgets: [
      ...(options.widgets ?? []),
      ...(options.showControlsWidget === false ? [] : [controls])
    ],
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
      const next = FARMS[width < NARROW_WIDTH ? 0 : 1];
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
      const {season, crops, sizeScale} = settings;
      // Inspect projected crowns directly: no GPU picking pass or readback needed.
      const tree = farm.trees.find(tree => {
        const crown = [
          tree.position[0],
          tree.position[1],
          tree.height * sizeScale * (0.5 + tree.trunkFraction * 0.5)
        ];
        const [x, y] = viewport.project(crown);
        const [edgeX, edgeY] = viewport.project(
          getFarmPosition(tree.canopyRadius * sizeScale, 0).map(
            (value, index) => value + crown[index]
          )
        );
        return Math.hypot(info.x - x, info.y - y) < Math.max(4, Math.hypot(edgeX - x, edgeY - y));
      });
      if (tree) {
        const crop = crops ? getSeasonalCrop(tree, season) : null;
        return {
          text: `${tree.label} · ${tree.maturity}\n${(tree.height * sizeScale).toFixed(1)} m tall · ${Math.round(tree.vigor * 100)}% vigour\n${crop ? `${crop.count} fruit / flowers · ${crop.droppedCount} fallen` : 'No fruit or flowers'}`
        };
      }
      const [lng, lat] = viewport.unproject([info.x, info.y]);
      const plot = farm.plots.find(
        ({polygon: [sw, , ne]}) => lng >= sw[0] && lng <= ne[0] && lat >= sw[1] && lat <= ne[1]
      );
      return plot ? {text: `${plot.label} plot\n${plot.trees.length} trees · ${season}`} : null;
    }
  });
  options.onDeckInitialized?.(deck);
  return () => {
    HOST_SETTINGS.set(container, settings);
    deck.finalize();
    root.remove();
  };

  function updateLayers() {
    root.dataset.season = settings.season;
    deck.setProps({layers: createLayers()});
  }

  function createLayers() {
    const {season, crops, windStrength, sizeScale, characteristics} = settings;
    return [
      new PolygonLayer<FarmPlot>({
        id: 'farm-plots',
        data: farm.plots,
        getPolygon: plot => plot.polygon,
        getFillColor: season === 'winter' ? [234, 235, 222, 255] : [224, 231, 204, 255],
        getLineColor: [128, 145, 107, 255],
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels'
      }),
      new TreeLayer<FarmTree>({
        id: 'farm-trees',
        data: farm.trees,
        getPosition: tree => tree.position,
        getTreeType: tree => tree.type,
        getHeight: tree => tree.height,
        getTrunkRadius: tree => tree.trunkRadius,
        getCanopyRadius: tree => getSeasonalCanopyRadius(tree, season),
        getTrunkColor: getBarkColor,
        getTrunkHeightFraction: tree => tree.trunkFraction,
        getBranchLevels: tree => tree.branchLevels,
        getCanopyColor: tree => getFoliageColor(tree, season),
        getSeason: tree => getTreeSeason(tree, season),
        getCrop: tree => (crops ? getSeasonalCrop(tree, season) : null),
        sizeScale,
        characteristics,
        windStrength,
        parameters: {cullMode: 'none'},
        updateTriggers: {
          getCanopyRadius: season,
          getCanopyColor: season,
          getSeason: season,
          getCrop: [season, crops]
        }
      })
    ];
  }
}
