// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type MapViewState} from '@deck.gl/core';
import {ThemeWidget, DarkTheme, LightTheme} from '@deck.gl/widgets';
import {ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {
  AccordeonPanel,
  BoxWidget,
  ColumnPanel,
  MarkdownPanel,
  StatsPanel
} from '../../../modules/widgets/src';
import {SharedTile2DLayer, TileGridLayer} from '../../../modules/geo-layers/src';
import {SharedTileset2D} from '../../../modules/geo-layers/src/tileset';
import {TableTileSource} from '@loaders.gl/mvt';
import type {TileSource} from '@loaders.gl/loader-utils';

import '@deck.gl/widgets/stylesheet.css';

type SharedFeatureProperties = {
  corridorId: string;
  lane: 'north' | 'south';
  severity: number;
  priority: number;
  label: string;
};

type SharedPointFeature = {
  type: 'Feature';
  id: string;
  properties: SharedFeatureProperties;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
};

type TileContent = SharedPointFeature[] & {byteLength?: number};
type ThemeMode = 'light' | 'dark';
type ThemeWidgetWithSetter = ThemeWidget & {
  _setThemeMode: (nextThemeMode: ThemeMode) => void;
};
type TileIndex = {
  x: number;
  y: number;
  z: number;
};

const INITIAL_VIEW_STATE: Record<string, MapViewState> = {
  severity: {longitude: -122.43, latitude: 37.77, zoom: 11.5, pitch: 35, bearing: -10},
  priority: {longitude: -122.43, latitude: 37.77, zoom: 11.5, pitch: 35, bearing: 10},
  minimap: {longitude: -122.43, latitude: 37.77, zoom: 8.75, pitch: 0, bearing: 10}
};

type SharedTile2DLayerExampleOptions = {
  mode?: 'full' | 'compact';
  showInfoWidget?: boolean;
};

function deriveMinimapViewState(viewState: MapViewState): MapViewState {
  return {
    ...viewState,
    zoom: Math.max(0, viewState.zoom - 2.75),
    pitch: 0
  };
}

function getMinimapFrame(mode: 'full' | 'compact') {
  return mode === 'compact'
    ? {right: 18, bottom: 18, width: 168, height: 132}
    : {right: 28, bottom: 28, width: 248, height: 176};
}

function createViews(mode: 'full' | 'compact', themeMode: ThemeMode) {
  const minimap = getMinimapFrame(mode);
  return [
    new MapView({
      id: 'severity',
      controller: true,
      clear: true,
      clearColor: getViewBackgroundColor('severity', themeMode),
      x: 0,
      y: 0,
      width: mode === 'compact' ? '100%' : '50%',
      height: mode === 'compact' ? '50%' : '100%'
    }),
    new MapView({
      id: 'priority',
      clear: true,
      clearColor: getViewBackgroundColor('priority', themeMode),
      x: mode === 'compact' ? 0 : '50%',
      y: mode === 'compact' ? '50%' : 0,
      width: mode === 'compact' ? '100%' : '50%',
      height: mode === 'compact' ? '50%' : '100%',
      controller: true
    }),
    new MapView({
      id: 'minimap',
      x: `calc(100% - ${minimap.right + minimap.width}px)`,
      y: `calc(100% - ${minimap.bottom + minimap.height}px)`,
      width: minimap.width,
      height: minimap.height,
      controller: false,
      clear: true,
      clearColor: getViewBackgroundColor('minimap', themeMode)
    })
  ];
}

const THEME_WIDGET_STYLE = `
  .shared-tile-2d-layer .deck-widget.deck-widget-theme .deck-widget-button {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--button-stroke, rgba(255, 255, 255, 0.3));
    border-radius: 10px;
    box-shadow: var(--button-shadow, 0 8px 22px rgba(15, 23, 42, 0.14));
  }

  .shared-tile-2d-layer .deck-widget.deck-widget-theme .deck-widget-button > button {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 9px;
    background: var(--button-background, #fff);
    cursor: pointer;
  }

  .shared-tile-2d-layer .deck-widget.deck-widget-theme .deck-widget-icon {
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--button-icon-idle, #616166);
    background-position: center;
    background-repeat: no-repeat;
    mask-position: center;
    -webkit-mask-position: center;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-size: 70%;
    -webkit-mask-size: 70%;
  }

  .shared-tile-2d-layer .deck-widget.deck-widget-theme button.deck-widget-sun .deck-widget-icon {
    mask-image: var(--icon-sun, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"5\" fill=\"black\"/><g stroke=\"black\" stroke-width=\"2\" stroke-linecap=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"5\"/><line x1=\"12\" y1=\"19\" x2=\"12\" y2=\"22\"/><line x1=\"2\" y1=\"12\" x2=\"5\" y2=\"12\"/><line x1=\"19\" y1=\"12\" x2=\"22\" y2=\"12\"/><line x1=\"5\" y1=\"5\" x2=\"7.5\" y2=\"7.5\"/><line x1=\"16.5\" y1=\"16.5\" x2=\"19\" y2=\"19\"/><line x1=\"5\" y1=\"19\" x2=\"7.5\" y2=\"16.5\"/><line x1=\"16.5\" y1=\"7.5\" x2=\"19\" y2=\"5\"/></g></svg>'));
    -webkit-mask-image: var(--icon-sun, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"5\" fill=\"black\"/><g stroke=\"black\" stroke-width=\"2\" stroke-linecap=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"5\"/><line x1=\"12\" y1=\"19\" x2=\"12\" y2=\"22\"/><line x1=\"2\" y1=\"12\" x2=\"5\" y2=\"12\"/><line x1=\"19\" y1=\"12\" x2=\"22\" y2=\"12\"/><line x1=\"5\" y1=\"5\" x2=\"7.5\" y2=\"7.5\"/><line x1=\"16.5\" y1=\"16.5\" x2=\"19\" y2=\"19\"/><line x1=\"5\" y1=\"19\" x2=\"7.5\" y2=\"16.5\"/><line x1=\"16.5\" y1=\"7.5\" x2=\"19\" y2=\"5\"/></g></svg>'));
  }

  .shared-tile-2d-layer .deck-widget.deck-widget-theme button.deck-widget-moon .deck-widget-icon {
    mask-image: var(--icon-moon, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><path fill=\"black\" d=\"M21 14.5A8.5 8.5 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5Z\"/></svg>'));
    -webkit-mask-image: var(--icon-moon, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><path fill=\"black\" d=\"M21 14.5A8.5 8.5 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5Z\"/></svg>'));
  }

  .shared-tile-2d-layer .deck-widget.deck-widget-theme {
    margin-top: 12px;
  }
`;

function getPalette(themeMode: ThemeMode) {
  return themeMode === 'dark'
    ? {
        background: 'linear-gradient(180deg, #0f172a 0%, #111827 100%)',
        text: '#f8fafc',
        muted: 'rgba(226, 232, 240, 0.78)',
        divider: 'rgba(148, 163, 184, 0.28)',
        codeBackground: 'rgba(148, 163, 184, 0.18)',
        codeBorder: 'rgba(148, 163, 184, 0.32)',
        codeText: '#e2e8f0'
      }
    : {
        background: 'linear-gradient(180deg, #f0f5ff 0%, #dfe9ff 100%)',
        text: '#0f172a',
        muted: 'rgba(15, 23, 42, 0.72)',
        divider: 'rgba(15, 23, 42, 0.12)',
        codeBackground: 'rgba(255, 255, 255, 0.9)',
        codeBorder: 'rgba(15, 23, 42, 0.12)',
        codeText: '#1e293b'
      };
}

function getViewBackgroundColor(viewId: 'severity' | 'priority' | 'minimap', themeMode: ThemeMode) {
  if (themeMode === 'dark') {
    switch (viewId) {
      case 'severity':
        return [16, 24, 39, 245];
      case 'priority':
        return [28, 24, 44, 245];
      default:
        return [15, 23, 42, 220];
    }
  }

  switch (viewId) {
    case 'severity':
      return [235, 245, 255, 240];
    case 'priority':
      return [248, 240, 255, 240];
    default:
      return [219, 234, 254, 235];
  }
}

function createSharedGeojsonTable() {
  const corridors = [
    {id: 'golden-gate', anchor: [-122.515, 37.808] as [number, number], delta: [0.0105, -0.0042] as [number, number]},
    {id: 'market', anchor: [-122.514, 37.793] as [number, number], delta: [0.0135, -0.0012] as [number, number]},
    {id: 'mission', anchor: [-122.500, 37.759] as [number, number], delta: [0.0128, 0.0014] as [number, number]},
    {id: 'bay-shore', anchor: [-122.470, 37.726] as [number, number], delta: [0.0118, -0.0016] as [number, number]},
    {id: 'east-bay', anchor: [-122.330, 37.804] as [number, number], delta: [0.0112, -0.0046] as [number, number]},
    {id: 'oakland-port', anchor: [-122.315, 37.786] as [number, number], delta: [0.0104, -0.0033] as [number, number]},
    {id: 'berkeley', anchor: [-122.321, 37.879] as [number, number], delta: [0.0095, -0.0027] as [number, number]},
    {id: 'peninsula', anchor: [-122.401, 37.641] as [number, number], delta: [0.0124, 0.0011] as [number, number]}
  ];

  const features: SharedPointFeature[] = [];

  for (const [corridorIndex, corridor] of corridors.entries()) {
    for (let segment = 0; segment < 42; segment++) {
      const lane = segment % 2 === 0 ? 'north' : 'south';
      const wave = Math.sin((segment + 1) * (corridorIndex + 1) * 0.37) * 0.0065;
      const bend = Math.cos((segment + 2) * 0.22 + corridorIndex * 0.4) * 0.0042;
      const laneOffset = lane === 'north' ? 0.0032 : -0.0032;
      const longitude = corridor.anchor[0] + corridor.delta[0] * segment + bend;
      const latitude = corridor.anchor[1] + corridor.delta[1] * segment + wave + laneOffset;
      const severity = ((segment + corridorIndex * 2) % 5) + 1;
      const priority = ((segment * 11 + corridorIndex * 17) % 100) + 1;

      features.push({
        type: 'Feature',
        id: `${corridor.id}-${segment}-${lane}`,
        properties: {
          corridorId: corridor.id,
          lane,
          severity,
          priority,
          label: `${corridor.id.replace('-', ' ')} ${segment + 1}`
        },
        geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        }
      });
    }
  }

  return {
    shape: 'geojson-table' as const,
    type: 'FeatureCollection' as const,
    features
  };
}

function estimateFeatureByteLength(feature: SharedPointFeature): number {
  return (
    32 +
    feature.geometry.coordinates.length * 8 +
    feature.id.length * 2 +
    feature.properties.corridorId.length * 2 +
    feature.properties.label.length * 2 +
    24
  );
}

function attachEstimatedByteLength(features: SharedPointFeature[]): TileContent {
  const tileContent = features as TileContent;
  tileContent.byteLength = features.reduce((sum, feature) => sum + estimateFeatureByteLength(feature), 0);
  return tileContent;
}

function createSharedTileSource(): TileSource {
  const source = TableTileSource.createDataSource(createSharedGeojsonTable(), {
    table: {
      coordinates: 'local',
      maxZoom: 14,
      indexMaxZoom: 5,
      maxPointsPerTile: 1000
    }
  });

  return {
    getMetadata: () => source.getMetadata(),
    getTile: parameters => source.getTile(parameters),
    async getTileData(parameters) {
      const data = await source.getTileData(parameters);
      return Array.isArray(data) ? attachEstimatedByteLength(data as SharedPointFeature[]) : data;
    }
  };
}

function getFeatureProps(feature: SharedPointFeature): SharedFeatureProperties {
  return feature.properties;
}

function projectLocalTilePositionToLngLat(
  coordinates: [number, number],
  tileIndex: TileIndex
): [number, number] {
  const scale = Math.pow(2, tileIndex.z);
  const longitude = ((coordinates[0] + tileIndex.x) * 360) / scale - 180;
  const y2 = 180 - ((coordinates[1] + tileIndex.y) * 360) / scale;
  const latitude = (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
  return [longitude, latitude];
}

function getProjectedFeaturePosition(tileIndex: TileIndex) {
  return (feature: SharedPointFeature): [number, number] =>
    projectLocalTilePositionToLngLat(feature.geometry.coordinates, tileIndex);
}

function createThemeWidget(onThemeModeChange: (nextThemeMode: ThemeMode) => void): ThemeWidgetWithSetter {
  const themeWidget = new ThemeWidget({
    id: 'shared-tile-2d-layer-theme',
    placement: 'top-left',
    initialThemeMode: 'light',
    lightModeTheme: {...LightTheme},
    darkModeTheme: {...DarkTheme}
  }) as ThemeWidgetWithSetter;

  const originalSetThemeMode = (ThemeWidget.prototype as ThemeWidgetWithSetter)._setThemeMode;
  themeWidget._setThemeMode = (nextThemeMode: ThemeMode) => {
    originalSetThemeMode.call(themeWidget, nextThemeMode);
    onThemeModeChange(nextThemeMode);
  };

  return themeWidget;
}

function buildInfoPanel(tileset: SharedTileset2D<TileContent>, hoveredId: string | null, selectedId: string | null) {
  return new ColumnPanel({
    id: 'shared-tile-2d-layer-panel',
    title: '',
    panels: {
      overview: new MarkdownPanel({
        id: 'shared-tile-2d-layer-overview',
        title: '',
        markdown: [
          'One shared auto-tiled GeoJSON `TableTileSource` and one shared `SharedTileset2D` feed styled `SharedTile2DLayer` comparisons plus a minimap.',
          `Hovered feature: **${hoveredId ?? 'none'}**`,
          `Selected feature: **${selectedId ?? 'none'}**`
        ].join('\n\n')
      }),
      stats: new AccordeonPanel({
        id: 'shared-tile-2d-layer-stats-accordion',
        title: '',
        panels: {
          stats: new StatsPanel({
            id: 'shared-tile-2d-layer-stats',
            title: 'Stats',
            stats: tileset.stats,
            statNames: [
              'Tiles In Cache',
              'Cache Size',
              'Visible Tiles',
              'Loading Tiles',
              'Unloaded Tiles'
            ],
            labels: {
              'Tiles In Cache': 'Total tiles in cache',
              'Cache Size': 'Cache size (bytes)',
              'Visible Tiles': 'Visible tiles across views',
              'Loading Tiles': 'Tiles loading',
              'Unloaded Tiles': 'Tiles evicted from cache'
            }
          })
        }
      })
    }
  });
}

function appendThemeStyle(root: HTMLElement): HTMLStyleElement {
  const styleElement = root.ownerDocument.createElement('style');
  styleElement.textContent = THEME_WIDGET_STYLE;
  root.appendChild(styleElement);
  return styleElement;
}

export function mountSharedTile2DLayerExample(
  container: HTMLElement,
  options: SharedTile2DLayerExampleOptions = {}
): () => void {
  const mode = options.mode || 'full';
  const root = container.ownerDocument.createElement('div');
  root.className = 'shared-tile-2d-layer';
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.minHeight = '100%';
  root.style.background = getPalette('light').background;
  root.style.borderRadius = mode === 'compact' ? '18px' : '0';
  root.style.overflow = 'hidden';
  container.replaceChildren(root);

  const styleElement = appendThemeStyle(root);

  const source = createSharedTileSource();
  const tileset = SharedTileset2D.fromTileSource<TileContent>(source);
  let hoveredId: string | null = null;
  let selectedId: string | null = null;
  const state = {themeMode: 'light' as ThemeMode};
  let viewState: Record<string, MapViewState> = {
    ...INITIAL_VIEW_STATE,
    minimap: deriveMinimapViewState(INITIAL_VIEW_STATE.priority)
  };

  const infoWidget =
    options.showInfoWidget === false
      ? null
      : new BoxWidget({
          id: 'shared-tile-2d-layer-info',
          placement: 'top-left',
          widthPx: mode === 'compact' ? 286 : 340,
          title: 'SharedTile2DLayer',
          collapsible: true,
          panel: buildInfoPanel(tileset, hoveredId, selectedId)
        });
  const themeWidget = createThemeWidget(nextThemeMode => {
    if (state.themeMode !== nextThemeMode) {
      state.themeMode = nextThemeMode;
      render();
    }
  });

  const deck = new Deck({
    parent: root,
    width: '100%',
    height: '100%',
    views: createViews(mode, state.themeMode),
    viewState,
    controller: true,
    onViewStateChange: ({viewId, viewState: nextViewState}) => {
      const nextState = {
        ...viewState,
        [viewId]: nextViewState
      };

      if (viewId === 'priority') {
        nextState.minimap = deriveMinimapViewState(nextViewState as MapViewState);
      } else if (viewId === 'minimap') {
        nextState.minimap = deriveMinimapViewState(nextState.priority);
      }

      viewState = nextState;
      deck.setProps({viewState});
      render();
    },
    widgets: [...(infoWidget ? [infoWidget] : []), themeWidget],
    layerFilter: ({layer, viewport}) =>
      layer.id.startsWith('severity-')
        ? viewport.id === 'severity'
        : layer.id.startsWith('priority-')
          ? viewport.id === 'priority'
        : layer.id.startsWith('minimap-')
            ? viewport.id === 'minimap'
            : true,
    getTooltip: ({object}: {object?: SharedPointFeature}) =>
      object
        ? {
            text: `${getFeatureProps(object).label}\nCorridor ${getFeatureProps(object).corridorId}\nSeverity ${getFeatureProps(object).severity}\nPriority ${getFeatureProps(object).priority}`
          }
        : null
  });

  const render = () => {
    root.style.background = getPalette(state.themeMode).background;
    infoWidget?.setProps({
      widthPx: mode === 'compact' ? 286 : 340,
      panel: buildInfoPanel(tileset, hoveredId, selectedId)
    });
    deck.setProps({
      viewState,
      views: createViews(mode, state.themeMode),
      widgets: [...(infoWidget ? [infoWidget] : []), themeWidget],
      layers: [
        new SharedTile2DLayer<TileContent>({
          id: 'severity-grid',
          data: tileset,
          pickable: false,
          renderSubLayers: props =>
            new TileGridLayer(props, {
              tile: props.tile,
              borderColor:
                state.themeMode === 'dark' ? [148, 163, 184, 170] : [71, 85, 105, 170],
              labelColor: state.themeMode === 'dark' ? [241, 245, 249, 255] : [15, 23, 42, 255],
              labelBackgroundColor:
                state.themeMode === 'dark' ? [15, 23, 42, 220] : [255, 255, 255, 220]
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'severity-points',
          data: tileset,
          pickable: true,
          onViewportLoad: () => render(),
          onHover: info => {
            hoveredId = (info.object as SharedPointFeature | undefined)?.id ?? null;
            render();
          },
          onClick: info => {
            selectedId = (info.object as SharedPointFeature | undefined)?.id ?? null;
            render();
          },
          renderSubLayers: props =>
            new ScatterplotLayer<SharedPointFeature>(props, {
              data: props.data,
              getPosition: getProjectedFeaturePosition(props.tile.index),
              getRadius: d => 350 + getFeatureProps(d).severity * 120,
              radiusUnits: 'meters',
              stroked: true,
              lineWidthMinPixels: 1,
              getLineColor: d => (d.id === selectedId ? [20, 24, 36, 255] : [255, 255, 255, 180]),
              getFillColor: d =>
                d.id === selectedId
                  ? [238, 94, 85, 255]
                  : d.id === hoveredId
                    ? [255, 197, 61, 255]
                    : getFeatureProps(d).lane === 'north'
                      ? state.themeMode === 'dark'
                        ? [96, 165, 250, 220]
                        : [58, 134, 255, 210]
                      : state.themeMode === 'dark'
                        ? [192, 132, 252, 220]
                        : [131, 56, 236, 210]
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'priority-grid',
          data: tileset,
          pickable: false,
          renderSubLayers: props =>
            new TileGridLayer(props, {
              tile: props.tile,
              borderColor:
                state.themeMode === 'dark' ? [167, 139, 250, 165] : [124, 58, 237, 150],
              labelColor: state.themeMode === 'dark' ? [245, 243, 255, 255] : [46, 16, 101, 255],
              labelBackgroundColor:
                state.themeMode === 'dark' ? [36, 25, 56, 220] : [250, 245, 255, 220]
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'priority-points',
          data: tileset,
          pickable: true,
          onHover: info => {
            hoveredId = (info.object as SharedPointFeature | undefined)?.id ?? null;
            render();
          },
          onClick: info => {
            selectedId = (info.object as SharedPointFeature | undefined)?.id ?? null;
            render();
          },
          renderSubLayers: props =>
            new ScatterplotLayer<SharedPointFeature>(props, {
              data: props.data,
              getPosition: getProjectedFeaturePosition(props.tile.index),
              getRadius: d => 160 + getFeatureProps(d).priority * 9,
              radiusUnits: 'meters',
              stroked: true,
              lineWidthMinPixels: 2,
              filled: true,
              getLineColor: d =>
                d.id === selectedId
                  ? [255, 255, 255, 255]
                  : d.id === hoveredId
                    ? [255, 197, 61, 255]
                    : state.themeMode === 'dark'
                      ? [148, 163, 184, 220]
                      : [71, 85, 105, 220],
              getFillColor: d => {
                const alpha = d.id === selectedId ? 245 : d.id === hoveredId ? 200 : 130;
                return getFeatureProps(d).priority > 66
                  ? [239, 68, 68, alpha]
                  : getFeatureProps(d).priority > 33
                    ? [245, 158, 11, alpha]
                    : [16, 185, 129, alpha];
              }
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'severity-labels',
          data: tileset,
          pickable: false,
          visible: Boolean(hoveredId || selectedId),
          renderSubLayers: props =>
            new TextLayer<SharedPointFeature>(props, {
              data: (props.data || []).filter(d => d.id === hoveredId || d.id === selectedId),
              getPosition: getProjectedFeaturePosition(props.tile.index),
              getText: d => getFeatureProps(d).label,
              getSize: 14,
              sizeUnits: 'pixels',
              getColor: state.themeMode === 'dark' ? [241, 245, 249, 255] : [10, 14, 22, 255],
              getBackgroundColor:
                state.themeMode === 'dark' ? [15, 23, 42, 235] : [255, 255, 255, 235],
              background: true,
              getTextAnchor: 'start',
              getAlignmentBaseline: 'bottom',
              getPixelOffset: [10, -10]
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'priority-labels',
          data: tileset,
          pickable: false,
          visible: Boolean(hoveredId || selectedId),
          renderSubLayers: props =>
            new TextLayer<SharedPointFeature>(props, {
              data: (props.data || []).filter(d => d.id === hoveredId || d.id === selectedId),
              getPosition: getProjectedFeaturePosition(props.tile.index),
              getText: d => `${getFeatureProps(d).label} | P${getFeatureProps(d).priority}`,
              getSize: 14,
              sizeUnits: 'pixels',
              getColor: state.themeMode === 'dark' ? [241, 245, 249, 255] : [10, 14, 22, 255],
              getBackgroundColor:
                state.themeMode === 'dark' ? [15, 23, 42, 235] : [255, 255, 255, 235],
              background: true,
              getTextAnchor: 'start',
              getAlignmentBaseline: 'bottom',
              getPixelOffset: [10, -10]
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'minimap-grid',
          data: tileset,
          pickable: false,
          renderSubLayers: props =>
            new TileGridLayer(props, {
              tile: props.tile,
              borderColor:
                state.themeMode === 'dark' ? [226, 232, 240, 120] : [30, 41, 59, 120],
              labelColor: state.themeMode === 'dark' ? [226, 232, 240, 230] : [15, 23, 42, 230],
              labelBackgroundColor:
                state.themeMode === 'dark' ? [15, 23, 42, 170] : [255, 255, 255, 190],
              borderWidthMinPixels: 1,
              labelSize: 11
            })
        }),
        new SharedTile2DLayer<TileContent>({
          id: 'minimap-points',
          data: tileset,
          pickable: false,
          renderSubLayers: props =>
            new ScatterplotLayer<SharedPointFeature>(props, {
              data: props.data,
              getPosition: getProjectedFeaturePosition(props.tile.index),
              getRadius: 180,
              radiusUnits: 'meters',
              stroked: false,
              getFillColor: d =>
                d.id === selectedId
                  ? [238, 94, 85, 255]
                  : d.id === hoveredId
                    ? [255, 197, 61, 220]
                    : state.themeMode === 'dark'
                      ? [226, 232, 240, 148]
                      : [30, 41, 59, 148]
            })
        })
      ]
    });
  };

  const unsubscribeTileset = tileset.subscribe({
    onTileLoad: () => render(),
    onTileUnload: () => render(),
    onTileError: () => render(),
    onUpdate: () => render()
  });

  render();

  return () => {
    unsubscribeTileset();
    deck.finalize();
    tileset.finalize();
    styleElement.remove();
    root.remove();
    container.replaceChildren();
  };
}
