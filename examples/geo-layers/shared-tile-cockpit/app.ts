// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type MapViewState} from '@deck.gl/core';
import {_ThemeWidget as ThemeWidget, DarkTheme, LightTheme} from '@deck.gl/widgets';
import {ScatterplotLayer, SolidPolygonLayer, TextLayer} from '@deck.gl/layers';
import {BoxWidget, ColumnWidgetPanel, MarkdownWidgetPanel, StatsWidgetPanel} from '../../../modules/widgets/src';
import {Tile2DLayer, Tile2DTileset} from '../../../modules/geo-layers/src';
import type {TileSource, TileSourceMetadata} from '@loaders.gl/loader-utils';

import '@deck.gl/widgets/stylesheet.css';

type SyntheticFeature = {
  id: string;
  tileId: string;
  lane: 'north' | 'south';
  severity: number;
  priority: number;
  coordinates: [number, number];
  label: string;
};

type TileContent = SyntheticFeature[] & {byteLength?: number};

const INITIAL_VIEW_STATE: Record<string, MapViewState> = {
  severity: {longitude: -122.43, latitude: 37.77, zoom: 11.5, pitch: 35, bearing: -10},
  priority: {longitude: -122.43, latitude: 37.77, zoom: 11.5, pitch: 35, bearing: 10},
  minimap: {longitude: -122.43, latitude: 37.77, zoom: 8.75, pitch: 0, bearing: 10}
};

type SharedTileCockpitExampleOptions = {
  mode?: 'full' | 'compact';
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

function createViews(mode: 'full' | 'compact') {
  const minimap = getMinimapFrame(mode);
  return [
    new MapView({
      id: 'severity',
      controller: true,
      x: 0,
      y: 0,
      width: mode === 'compact' ? '100%' : '50%',
      height: mode === 'compact' ? '50%' : '100%'
    }),
    new MapView({
      id: 'priority',
      x: mode === 'compact' ? 0 : '50%',
      y: mode === 'compact' ? '50%' : 0,
      width: mode === 'compact' ? '100%' : '50%',
      height: mode === 'compact' ? '50%' : '100%',
      controller: true,
      clear: true
    }),
    new MapView({
      id: 'minimap',
      x: `calc(100% - ${minimap.right + minimap.width}px)`,
      y: `calc(100% - ${minimap.bottom + minimap.height}px)`,
      width: minimap.width,
      height: minimap.height,
      controller: false,
      clear: true
    })
  ];
}

const THEME_WIDGET_STYLE = `
  .shared-tile-cockpit .deck-widget.deck-widget-theme .deck-widget-button {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--button-stroke, rgba(255, 255, 255, 0.3));
    border-radius: 10px;
    box-shadow: var(--button-shadow, 0 8px 22px rgba(15, 23, 42, 0.14));
  }

  .shared-tile-cockpit .deck-widget.deck-widget-theme .deck-widget-button > button {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 9px;
    background: var(--button-background, #fff);
    cursor: pointer;
  }

  .shared-tile-cockpit .deck-widget.deck-widget-theme .deck-widget-icon {
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

  .shared-tile-cockpit .deck-widget.deck-widget-theme button.deck-widget-sun .deck-widget-icon {
    mask-image: var(--icon-sun, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"5\" fill=\"black\"/><g stroke=\"black\" stroke-width=\"2\" stroke-linecap=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"5\"/><line x1=\"12\" y1=\"19\" x2=\"12\" y2=\"22\"/><line x1=\"2\" y1=\"12\" x2=\"5\" y2=\"12\"/><line x1=\"19\" y1=\"12\" x2=\"22\" y2=\"12\"/><line x1=\"5\" y1=\"5\" x2=\"7.5\" y2=\"7.5\"/><line x1=\"16.5\" y1=\"16.5\" x2=\"19\" y2=\"19\"/><line x1=\"5\" y1=\"19\" x2=\"7.5\" y2=\"16.5\"/><line x1=\"16.5\" y1=\"7.5\" x2=\"19\" y2=\"5\"/></g></svg>'));
    -webkit-mask-image: var(--icon-sun, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"5\" fill=\"black\"/><g stroke=\"black\" stroke-width=\"2\" stroke-linecap=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"5\"/><line x1=\"12\" y1=\"19\" x2=\"12\" y2=\"22\"/><line x1=\"2\" y1=\"12\" x2=\"5\" y2=\"12\"/><line x1=\"19\" y1=\"12\" x2=\"22\" y2=\"12\"/><line x1=\"5\" y1=\"5\" x2=\"7.5\" y2=\"7.5\"/><line x1=\"16.5\" y1=\"16.5\" x2=\"19\" y2=\"19\"/><line x1=\"5\" y1=\"19\" x2=\"7.5\" y2=\"16.5\"/><line x1=\"16.5\" y1=\"7.5\" x2=\"19\" y2=\"5\"/></g></svg>'));
  }

  .shared-tile-cockpit .deck-widget.deck-widget-theme button.deck-widget-moon .deck-widget-icon {
    mask-image: var(--icon-moon, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><path fill=\"black\" d=\"M21 14.5A8.5 8.5 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5Z\"/></svg>'));
    -webkit-mask-image: var(--icon-moon, url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox=\"0 0 24 24\"><path fill=\"black\" d=\"M21 14.5A8.5 8.5 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5Z\"/></svg>'));
  }

  .shared-tile-cockpit .deck-widget.deck-widget-theme {
    margin-top: 12px;
  }
`;

function getPalette(themeMode: 'light' | 'dark') {
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

class SyntheticVectorTileSource implements TileSource {
  async getMetadata(): Promise<TileSourceMetadata> {
    return {
      minZoom: 0,
      maxZoom: 14,
      boundingBox: [[-180, -85], [180, 85]]
    };
  }

  async getTile(): Promise<null> {
    return null;
  }

  async getTileData(parameters): Promise<TileContent> {
    const {x, y, z} = parameters.index;
    const center =
      'west' in parameters.bbox
        ? [
            (parameters.bbox.west + parameters.bbox.east) / 2,
            (parameters.bbox.south + parameters.bbox.north) / 2
          ]
        : [
            (parameters.bbox.left + parameters.bbox.right) / 2,
            (parameters.bbox.top + parameters.bbox.bottom) / 2
          ];

    const features = Array.from({length: 6}, (_, i) => {
      const offset = (i - 2.5) * 0.045 / Math.max(z, 1);
      const lane = i % 2 === 0 ? 'north' : 'south';
      return {
        id: `${x}-${y}-${z}-${i}`,
        tileId: `${x}-${y}-${z}`,
        lane,
        severity: ((x + y + z + i) % 5) + 1,
        priority: ((x * 7 + y * 5 + i * 3) % 100) + 1,
        coordinates: [center[0] + offset, center[1] + offset * (lane === 'north' ? 1 : -1)] as [number, number],
        label: `Segment ${i + 1}`
      };
    }) as TileContent;
    features.byteLength = features.length * 96;
    return features;
  }
}

export function mountSharedTileCockpitExample(
  container: HTMLElement,
  options: SharedTileCockpitExampleOptions = {}
): () => void {
  const mode = options.mode || 'full';
  const root = container.ownerDocument.createElement('div');
  root.className = 'shared-tile-cockpit';
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.minHeight = '100%';
  root.style.background = getPalette('light').background;
  root.style.borderRadius = mode === 'compact' ? '18px' : '0';
  root.style.overflow = 'hidden';
  container.replaceChildren(root);

  const styleElement = container.ownerDocument.createElement('style');
  styleElement.textContent = THEME_WIDGET_STYLE;
  root.appendChild(styleElement);

  const source = new SyntheticVectorTileSource();
  const tileset = Tile2DTileset.fromTileSource<TileContent>(source);
  let hoveredId: string | null = null;
  let selectedId: string | null = null;
  const state = {themeMode: 'light' as 'light' | 'dark'};
  let viewState: Record<string, MapViewState> = {
    ...INITIAL_VIEW_STATE,
    minimap: deriveMinimapViewState(INITIAL_VIEW_STATE.priority)
  };

  const infoWidget = new BoxWidget({
    id: 'shared-tile-cockpit-info',
    placement: 'top-left',
    widthPx: mode === 'compact' ? 286 : 340,
    title: 'Shared Tileset',
    collapsible: true,
    panel: buildInfoPanel()
  });
  const themeWidget = new ThemeWidget({
    id: 'shared-tile-cockpit-theme',
    placement: 'top-left',
    initialThemeMode: 'light',
    lightModeTheme: {...LightTheme},
    darkModeTheme: {...DarkTheme}
  }) as ThemeWidget & {
    _setThemeMode: (nextThemeMode: 'light' | 'dark') => void;
  };
  const originalSetThemeMode = themeWidget._setThemeMode.bind(themeWidget);
  themeWidget._setThemeMode = (nextThemeMode: 'light' | 'dark') => {
    originalSetThemeMode(nextThemeMode);
    if (state.themeMode !== nextThemeMode) {
      state.themeMode = nextThemeMode;
      render();
    }
  };

  const deck = new Deck({
    parent: root,
    width: '100%',
    height: '100%',
    views: createViews(mode),
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
    widgets: [infoWidget, themeWidget],
    layerFilter: ({layer, viewport}) =>
      layer.id === 'minimap-background'
        ? viewport.id === 'minimap'
        : layer.id.startsWith('severity-')
        ? viewport.id === 'severity'
        : layer.id.startsWith('priority-')
          ? viewport.id === 'priority'
          : layer.id.startsWith('minimap-')
            ? viewport.id === 'minimap'
            : true,
    getTooltip: ({object}: {object?: SyntheticFeature}) =>
      object
        ? {
            text: `${object.label}\nTile ${object.tileId}\nSeverity ${object.severity}\nPriority ${object.priority}`
          }
        : null
  });

  const render = () => {
    root.style.background = getPalette(state.themeMode).background;
    infoWidget.setProps({
      widthPx: mode === 'compact' ? 286 : 340,
      panel: buildInfoPanel()
    });
    deck.setProps({
      viewState,
      widgets: [infoWidget, themeWidget],
      layers: [
        new SolidPolygonLayer({
          id: 'minimap-background',
          data: [
            {
              polygon: [
                [-180, -85],
                [180, -85],
                [180, 85],
                [-180, 85]
              ]
            }
          ],
          pickable: false,
          stroked: false,
          filled: true,
          getPolygon: d => d.polygon,
          getFillColor:
            state.themeMode === 'dark' ? [15, 23, 42, 220] : [219, 234, 254, 235]
        }),
        new Tile2DLayer<TileContent>({
          id: 'severity-points',
          data: tileset,
          pickable: true,
          onViewportLoad: () => render(),
          onHover: info => {
            hoveredId = (info.object as SyntheticFeature | undefined)?.id ?? null;
            render();
          },
          onClick: info => {
            selectedId = (info.object as SyntheticFeature | undefined)?.id ?? null;
            render();
          },
          renderSubLayers: props =>
            new ScatterplotLayer<SyntheticFeature>(props, {
              data: props.data,
              getPosition: d => d.coordinates,
              getRadius: d => 350 + d.severity * 120,
              radiusUnits: 'meters',
              stroked: true,
              lineWidthMinPixels: 1,
              getLineColor: d => (d.id === selectedId ? [20, 24, 36, 255] : [255, 255, 255, 180]),
              getFillColor: d =>
                d.id === selectedId
                  ? [238, 94, 85, 255]
                  : d.id === hoveredId
                    ? [255, 197, 61, 255]
                    : d.lane === 'north'
                      ? state.themeMode === 'dark'
                        ? [96, 165, 250, 220]
                        : [58, 134, 255, 210]
                      : state.themeMode === 'dark'
                        ? [192, 132, 252, 220]
                        : [131, 56, 236, 210]
            })
        }),
        new Tile2DLayer<TileContent>({
          id: 'priority-points',
          data: tileset,
          pickable: true,
          onHover: info => {
            hoveredId = (info.object as SyntheticFeature | undefined)?.id ?? null;
            render();
          },
          onClick: info => {
            selectedId = (info.object as SyntheticFeature | undefined)?.id ?? null;
            render();
          },
          renderSubLayers: props =>
            new ScatterplotLayer<SyntheticFeature>(props, {
              data: props.data,
              getPosition: d => d.coordinates,
              getRadius: d => 160 + d.priority * 9,
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
                return d.priority > 66
                  ? [239, 68, 68, alpha]
                  : d.priority > 33
                    ? [245, 158, 11, alpha]
                    : [16, 185, 129, alpha];
              }
            })
        }),
        new Tile2DLayer<TileContent>({
          id: 'severity-labels',
          data: tileset,
          pickable: false,
          visible: Boolean(hoveredId || selectedId),
          renderSubLayers: props =>
            new TextLayer<SyntheticFeature>(props, {
              data: (props.data || []).filter(d => d.id === hoveredId || d.id === selectedId),
              getPosition: d => d.coordinates,
              getText: d => d.label,
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
        new Tile2DLayer<TileContent>({
          id: 'priority-labels',
          data: tileset,
          pickable: false,
          visible: Boolean(hoveredId || selectedId),
          renderSubLayers: props =>
            new TextLayer<SyntheticFeature>(props, {
              data: (props.data || []).filter(d => d.id === hoveredId || d.id === selectedId),
              getPosition: d => d.coordinates,
              getText: d => `${d.label} | P${d.priority}`,
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
        new Tile2DLayer<TileContent>({
          id: 'minimap-points',
          data: tileset,
          pickable: false,
          renderSubLayers: props =>
            new ScatterplotLayer<SyntheticFeature>(props, {
              data: props.data,
              getPosition: d => d.coordinates,
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

  function buildInfoPanel() {
    return new ColumnWidgetPanel({
      id: 'shared-tileset-panel',
      title: '',
      panels: {
        overview: new MarkdownWidgetPanel({
          id: 'shared-tileset-overview',
          title: '',
          markdown: [
            'One shared `TileSource` and one shared `Tile2DTileset` feed styled `Tile2DLayer` comparisons plus a minimap.',
            `Hovered feature: **${hoveredId ?? 'none'}**`,
            `Selected feature: **${selectedId ?? 'none'}**`
          ].join('\n\n')
        }),
        stats: new StatsWidgetPanel({
          id: 'shared-tileset-stats',
          title: '',
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
            'Unloaded Tiles': 'Unloaded tiles'
          }
        })
      }
    });
  }
}
