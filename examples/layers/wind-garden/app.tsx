// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  type DeckProps,
  type Effect,
  type MapViewState,
  type PickingInfo,
  type Widget
} from '@deck.gl/core';
import {
  ColumnLayer,
  GridCellLayer,
  PointCloudLayer,
  PolygonLayer,
  TextLayer
} from '@deck.gl/layers';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {CubeGeometry} from '@luma.gl/engine';
import type {Device} from '@luma.gl/core';
import {
  TreeLayer,
  WindEffect,
  WindExtension,
  type TreeSpec,
  type WindExtensionProps
} from '@deck.gl-community/layers';
import {SettingsPanel, type SettingsState} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {EXAMPLE_PANEL_STYLE} from '../../utils/panel-theme';
import {DEFAULT_GARDEN_SETTINGS, SETTINGS_SCHEMA, type GardenSettings} from './settings';
import {GARDEN_STATION_WIND} from './station-wind';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

export type WindGardenExampleOptions = {
  showControlsWidget?: boolean;
  /** Reuse the website's selected graphics device and widgets. */
  device?: Device;
  widgets?: Widget[];
  /** Restore and publish the camera when switching website graphics backends. */
  initialViewState?: MapViewState;
  onViewStateChange?: DeckProps<MapView>['onViewStateChange'];
  onDeckInitialized?: (deck: Deck<MapView>) => void;
};

type Instance = {position: [number, number, number]; height: number; phase: number};

const METER_OFFSETS = {
  coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Frame the rows to the right of the settings panel.
const INITIAL_VIEW: MapViewState = {
  longitude: -0.00019,
  latitude: 0.00003,
  zoom: 18.85,
  pitch: 55,
  bearing: -15,
  maxZoom: 23,
  maxPitch: 80
};
// Keep the settings when the website remounts for a graphics backend switch.
const HOST_SETTINGS = new WeakMap<HTMLElement, GardenSettings>();

/** A deterministic [0, 1) sequence, so every visit plants the same garden. */
function createRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const ROWS = {trees: -44, reeds: -25, columns: -8, cells: 8, scan: 30};
const LABELS = [
  {x: ROWS.trees, text: 'TreeLayer'},
  {x: ROWS.reeds, text: 'SimpleMeshLayer'},
  {x: ROWS.columns, text: 'ColumnLayer'},
  {x: ROWS.cells + 3, text: 'GridCellLayer'},
  {x: ROWS.scan, text: 'PointCloudLayer'}
];
const TREES: TreeSpec[] = (['oak', 'birch', 'pine', 'palm', 'cherry', 'citrus'] as const).map(
  (species, i) => ({position: [ROWS.trees, -20 + i * 8, 0], species})
);
const REEDS: Instance[] = (() => {
  const random = createRandom(7);
  return Array.from({length: 196}, (_, i) => ({
    position: [
      ROWS.reeds + ((i % 14) - 6.5) * 0.6 + (random() - 0.5) * 0.4,
      (Math.floor(i / 14) - 6.5) * 0.6 + (random() - 0.5) * 0.4,
      0
    ],
    height: 1.6 + random() * 1.4,
    phase: i * GOLDEN_ANGLE
  }));
})();
const COLUMNS: Instance[] = [4, 9, 14, 7, 11].map((height, i) => ({
  position: [ROWS.columns, -16 + i * 8, 0],
  height,
  phase: i * GOLDEN_ANGLE
}));
const CELLS: Instance[] = (() => {
  const random = createRandom(11);
  return Array.from({length: 16}, (_, i) => ({
    position: [ROWS.cells + (i % 4) * 2.5, -5 + Math.floor(i / 4) * 2.5, 0],
    height: 2 + random() * 8,
    phase: i * GOLDEN_ANGLE
  }));
})();
// A scanned shrub: a stem and an ellipsoidal crown. Every point shares one phase, so the scan bends
// as one plant; `windBase: 'ground'` measures each point's height from z = 0.
const SCAN = (() => {
  const random = createRandom(23);
  const points: {position: [number, number, number]; color: [number, number, number]}[] = [];
  for (let i = 0; i < 120; i++)
    points.push({position: [ROWS.scan, 0, (i / 120) * 3.5], color: [110, 82, 60]});
  for (let i = 0; i < 3200; i++) {
    const theta = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const r = Math.cbrt(random());
    const ring = Math.sqrt(1 - z * z) * r;
    points.push({
      position: [
        ROWS.scan + Math.cos(theta) * ring * 3,
        Math.sin(theta) * ring * 3,
        6 + z * r * 2.6
      ],
      color: [60 + z * 30, 140 + r * 50, 60]
    });
  }
  return points;
})();

/** Mount a garden where one WindEffect bends trees, meshes, columns, cells and a point cloud. */
export function mountWindGardenExample(
  container: HTMLElement,
  options: WindGardenExampleOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'wind-garden';
  root.setAttribute('aria-label', 'A garden of deck.gl layers bending in one wind');
  container.replaceChildren(root);
  let settings = HOST_SETTINGS.get(container) ?? DEFAULT_GARDEN_SETTINGS;
  const controls = new BoxPanelWidget({
    style: EXAMPLE_PANEL_STYLE,
    id: 'wind-garden-controls',
    title: 'WindEffect',
    placement: 'top-left',
    widthPx: 300,
    collapsible: true,
    defaultOpen: !(container.clientWidth > 0 && container.clientWidth < 600),
    panel: new SettingsPanel({
      id: 'wind-garden-settings',
      schema: SETTINGS_SCHEMA,
      settings: settings as unknown as SettingsState,
      onSettingsChange(nextSettings) {
        settings = nextSettings as unknown as GardenSettings;
        deck.setProps({effects: createEffects(), layers: createLayers()});
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
    views: new MapView({id: 'garden'}),
    initialViewState: options.initialViewState ?? INITIAL_VIEW,
    controller: {touchRotate: true},
    onViewStateChange(params) {
      return (options.onViewStateChange?.(params) || params.viewState) as typeof params.viewState;
    },
    useDevicePixels: Math.min(2, container.ownerDocument.defaultView?.devicePixelRatio || 1),
    effects: createEffects(),
    layers: createLayers(),
    getTooltip: (info: PickingInfo) =>
      info.layer ? {text: `${info.layer.id} · bent by the scene's WindEffect`} : null
  });
  options.onDeckInitialized?.(deck);
  return () => {
    HOST_SETTINGS.set(container, settings);
    deck.finalize();
    root.remove();
  };

  // deck.gl keeps the registered effects and passes them the new props.
  function createEffects(): Effect[] {
    // One wind for the whole scene: the panel's, or the station field's at the garden centre.
    const time = settings.frozen ? 2 : null;
    const wind = new WindEffect(
      settings.source === 'stations'
        ? {...settings.wind, ...GARDEN_STATION_WIND, time}
        : {...settings.wind, time}
    );
    if (!settings.shadows) return [wind];
    return [
      new LightingEffect({
        ambient: new AmbientLight({intensity: 0.9}),
        sun: new DirectionalLight({direction: [-1, -2, -3], intensity: 1.6, _shadow: true})
      }),
      wind
    ];
  }

  function createLayers() {
    const {layers: visible} = settings;
    const extensions = [new WindExtension()];
    const instance = (d: Instance) => d.position;
    const wind = (flex: number) => (d: Instance) =>
      [d.height, d.phase, flex] as [number, number, number];
    return [
      new PolygonLayer({
        ...METER_OFFSETS,
        id: 'ground',
        data: [
          [
            [-58, -30],
            [44, -30],
            [44, 30],
            [-58, 30]
          ]
        ],
        getPolygon: d => d,
        getFillColor: [222, 230, 204],
        stroked: false
      }),
      visible.trees &&
        new TreeLayer({...METER_OFFSETS, id: 'TreeLayer', data: TREES, pickable: true}),
      visible.reeds &&
        new SimpleMeshLayer<Instance, WindExtensionProps<Instance>>({
          ...METER_OFFSETS,
          id: 'SimpleMeshLayer',
          data: REEDS,
          mesh: new CubeGeometry(),
          getPosition: instance,
          getScale: d => [0.035, 0.035, d.height / 2],
          getTranslation: d => [0, 0, d.height / 2],
          getColor: d => [150 + d.height * 20, 170, 70],
          extensions,
          // Reeds are slender: they bend further than a tree in the same wind.
          getWind: wind(3),
          pickable: true
        }),
      visible.columns &&
        new ColumnLayer<Instance, WindExtensionProps<Instance>>({
          ...METER_OFFSETS,
          id: 'ColumnLayer',
          data: COLUMNS,
          getPosition: instance,
          getElevation: d => d.height,
          radius: 1.2,
          diskResolution: 24,
          getFillColor: [214, 120, 72],
          extensions,
          getWind: wind(1),
          pickable: true
        }),
      visible.cells &&
        new GridCellLayer<Instance, WindExtensionProps<Instance>>({
          ...METER_OFFSETS,
          id: 'GridCellLayer',
          data: CELLS,
          getPosition: instance,
          getElevation: d => d.height,
          cellSize: 2.2,
          getFillColor: d => [70, 110 + d.height * 12, 200],
          extensions,
          getWind: wind(1),
          pickable: true
        }),
      visible.scan &&
        new PointCloudLayer<(typeof SCAN)[number], WindExtensionProps>({
          ...METER_OFFSETS,
          id: 'PointCloudLayer',
          data: SCAN,
          getPosition: d => d.position,
          getColor: d => d.color,
          getNormal: [0, 0, 1],
          pointSize: 3,
          extensions,
          windBase: 'ground',
          getWind: [8.6, 0.4, 1],
          pickable: true
        }),
      new TextLayer({
        ...METER_OFFSETS,
        id: 'labels',
        data: LABELS,
        getPosition: d => [d.x, -26, 0.3],
        getText: d => d.text,
        getSize: 13,
        getColor: [44, 58, 38],
        fontFamily: 'system-ui',
        fontWeight: 600,
        background: true,
        getBackgroundColor: [248, 249, 241, 230],
        backgroundPadding: [5, 3],
        parameters: {depthCompare: 'always', depthWriteEnabled: false}
      })
    ];
  }
}
