// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type MapViewState} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {CORTAOEffect, type CORTAOEffectProps} from '@deck.gl-community/experimental';
import {A5Grid, GlobalGridLayer} from '@deck.gl-community/geo-layers';

/** San Francisco bike parking counts per A5 cell. The global-grid-layer docs use the same file. */
const DATA_URL =
  'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/sf.bike.parking.a5.json';

/** A camera that looks across the extruded cells at a low angle. */
const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -122.418,
  latitude: 37.772,
  zoom: 13.2,
  pitch: 60,
  bearing: -25
};

/** A flat ground under the cells, so that the cells cast contact occlusion on it. */
const GROUND: [number, number][][] = [
  [
    [-122.53, 37.69],
    [-122.35, 37.69],
    [-122.35, 37.83],
    [-122.53, 37.83]
  ]
];

/** One A5 cell of the data. */
type BikeParkingCell = {pentagon: string; count: number};

/** Options of {@link mountAmbientOcclusionExample}. */
export type AmbientOcclusionExampleOptions = {
  /** Start with the effect on. Default `true`. */
  ambientOcclusion?: boolean;
  /** Initial effect props. */
  effectProps?: CORTAOEffectProps;
  /** Show the settings panel. Default `true`. */
  controls?: boolean;
  /** Initial camera. */
  initialViewState?: MapViewState;
  /** Called when the data is loaded and the first frame with the data is drawn. */
  onReady?: (deck: Deck<MapView>) => void;
};

/** The handle that the example returns. */
export type AmbientOcclusionExample = {
  /** The deck.gl instance. */
  deck: Deck<MapView>;
  /** The effect. It stays the same object when it is turned off and on. */
  effect: CORTAOEffect;
  /** Turns the effect on or off. Off removes it from the effects list. */
  setAmbientOcclusion: (enabled: boolean) => void;
  /** Updates the effect props. */
  setEffectProps: (props: CORTAOEffectProps) => void;
  /** Removes the example. */
  finalize: () => void;
  /** True when the data is loaded and drawn. */
  readonly ready: boolean;
};

/**
 * Mounts a deck.gl map of extruded A5 cells over a flat ground, with CORTAO ambient occlusion.
 */
export function mountAmbientOcclusionExample(
  container: HTMLElement,
  options: AmbientOcclusionExampleOptions = {}
): AmbientOcclusionExample {
  const effect = new CORTAOEffect(options.effectProps);
  let ambientOcclusion = options.ambientOcclusion ?? true;
  let isReady = false;

  const layers = [
    new SolidPolygonLayer({
      id: 'ground',
      data: GROUND,
      getPolygon: polygon => polygon,
      getFillColor: [236, 233, 226]
    }),
    new GlobalGridLayer<BikeParkingCell>({
      id: 'bike-parking',
      data: DATA_URL,
      globalGrid: A5Grid,
      extruded: true,
      getCellId: cell => cell.pentagon,
      getFillColor: cell => {
        const value = cell.count / 211;
        return [(1 - value) * 235, 255 - 85 * value, 255 - 170 * value];
      },
      getElevation: cell => cell.count,
      elevationScale: 4,
      onDataLoad: () => {
        // The cells are drawn in the next frame.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            isReady = true;
            options.onReady?.(deck);
          })
        );
      }
    })
  ];

  const deck = new Deck<MapView>({
    parent: container as HTMLDivElement,
    views: new MapView({controller: true}),
    initialViewState: options.initialViewState ?? INITIAL_VIEW_STATE,
    effects: ambientOcclusion ? [effect] : [],
    layers
  });

  const setAmbientOcclusion = (enabled: boolean) => {
    ambientOcclusion = enabled;
    deck.setProps({effects: enabled ? [effect] : []});
  };
  const setEffectProps = (props: CORTAOEffectProps) => {
    effect.setProps(props);
    deck.redraw('CORTAO props changed');
  };

  const panel = options.controls === false ? null : createControls(container);
  if (panel) {
    panel.ambientOcclusion.checked = ambientOcclusion;
    panel.ambientOcclusion.onchange = () => setAmbientOcclusion(panel.ambientOcclusion.checked);
    panel.showOcclusion.onchange = () =>
      setEffectProps({showOcclusion: panel.showOcclusion.checked});
    panel.filter.onchange = () => setEffectProps({filter: panel.filter.checked});
    panel.sampleCount.onchange = () =>
      setEffectProps({sampleCount: Number(panel.sampleCount.value)});
  }

  return {
    deck,
    effect,
    setAmbientOcclusion,
    setEffectProps,
    finalize: () => {
      panel?.root.remove();
      deck.finalize();
      isReady = false;
    },
    get ready() {
      return isReady;
    }
  };
}

/** Creates the settings panel. */
function createControls(container: HTMLElement) {
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:1;padding:8px 12px;border-radius:6px;' +
    'background:rgba(255,255,255,0.9);font:13px sans-serif;line-height:1.8';
  root.innerHTML = `
    <label><input type="checkbox" name="ambientOcclusion"> Ambient occlusion</label><br>
    <label><input type="checkbox" name="showOcclusion"> Show occlusion only</label><br>
    <label><input type="checkbox" name="filter" checked> Bilateral filter</label><br>
    <label>Samples <select name="sampleCount">
      <option>4</option><option>8</option><option>12</option>
      <option selected>16</option><option>24</option><option>32</option>
    </select></label>`;
  container.style.position = 'relative';
  container.append(root);
  const get = <T extends HTMLElement>(name: string) => root.querySelector(`[name="${name}"]`) as T;
  return {
    root,
    ambientOcclusion: get<HTMLInputElement>('ambientOcclusion'),
    showOcclusion: get<HTMLInputElement>('showOcclusion'),
    filter: get<HTMLInputElement>('filter'),
    sampleCount: get<HTMLSelectElement>('sampleCount')
  };
}
