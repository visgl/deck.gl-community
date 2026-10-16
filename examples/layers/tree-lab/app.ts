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
  type DeckProps
} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {PlaneGeometry} from '@luma.gl/engine';
import {TreeLayer, type Season, type TreeSpec, type TreeType} from '@deck.gl-community/layers';
import './style.css';

const SPECIES: TreeType[] = [
  'banyan',
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'mangrove',
  'citrus'
];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const coordinateProps = {
  coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};
type MountOptions = Pick<
  DeckProps<MapView>,
  | 'device'
  | 'initialViewState'
  | 'widgets'
  | 'onViewStateChange'
  | 'onAfterRender'
  | 'onDeviceInitialized'
> & {
  onDeckInitialized?: (deck: Deck<MapView>) => void;
};

/** Mount a focused TreeLayer viewer for one species and its core visual traits. */
export function mountTreeLabExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.innerHTML = `<div class="trees-controls">
    <div class="trees-heading"><strong>TreeLayer</strong><span>One tree · live traits</span></div>
    <label>Species <select name="species">${SPECIES.map(
      species =>
        `<option value="${species}"${species === 'banyan' ? ' selected' : ''}>${species}</option>`
    ).join('')}</select></label>
    <label>Season <select name="season">${SEASONS.map(
      season => `<option${season === 'summer' ? ' selected' : ''}>${season}</option>`
    ).join('')}</select></label>
    <label class="trees-spread">Crown spread <input name="spread" type="range" min="0.6" max="1.5" step="0.1" value="1"><output name="spread-value">1.0×</output></label>
  </div><div class="trees-stage"></div>`;
  container.append(root);
  const stage = root.querySelector<HTMLDivElement>('.trees-stage')!;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
    root.querySelector<T>(`[name="${name}"]`)!;
  const spreadOutput = root.querySelector<HTMLOutputElement>('[name="spread-value"]')!;
  const groundMesh = new PlaneGeometry({type: 'x,y', xlen: 100, ylen: 100});
  const lighting = new LightingEffect({
    ambient: new AmbientLight({intensity: 1}),
    sun: new DirectionalLight({intensity: 0.5, direction: [0.8, 0.2, -1.6]})
  });
  let cachedSpecies: TreeType | undefined;
  let cachedData: TreeSpec[] = [];
  const deck = new Deck<MapView>({
    ...options,
    parent: stage,
    views: new MapView(),
    initialViewState: options.initialViewState ?? {
      longitude: 0,
      latitude: 0,
      zoom:
        20 + Math.log2(Math.max(0.25, Math.min(stage.clientWidth / 400, stage.clientHeight / 600))),
      pitch: 45,
      bearing: 20
    },
    controller: true,
    useDevicePixels: 1,
    getTooltip: ({object}) => object?.species ?? null,
    effects: [lighting],
    layers: []
  });
  options.onDeckInitialized?.(deck);
  const render = () => {
    const species = control<HTMLSelectElement>('species').value as TreeType;
    const season = control<HTMLSelectElement>('season').value as Season;
    const spread = Number(control<HTMLInputElement>('spread').value);
    if (species !== cachedSpecies) {
      cachedSpecies = species;
      cachedData = [{species, position: [0, 0, 0]}];
    }
    spreadOutput.textContent = `${spread.toFixed(1)}×`;
    deck.setProps({
      layers: [
        new SimpleMeshLayer({
          ...coordinateProps,
          id: 'ground',
          data: [{position: [0, 0, -0.05]}],
          mesh: groundMesh,
          getColor: [219, 228, 210],
          material: {ambient: 1, diffuse: 0, shininess: 0}
        }),
        new TreeLayer<TreeSpec>({
          ...coordinateProps,
          id: 'trees',
          data: cachedData,
          getTree: tree => ({
            ...tree,
            season,
            wind: false,
            characteristics: {crownSpread: spread}
          }),
          pickable: true,
          updateTriggers: {getTree: [season, spread]}
        }),
        new TextLayer<TreeSpec>({
          ...coordinateProps,
          id: 'labels',
          data: cachedData,
          getPosition: tree => [tree.position![0], tree.position![1] - 9, 0.2],
          getText: tree => {
            const name = tree.species!;
            return name[0].toUpperCase() + name.slice(1);
          },
          getSize: 18,
          getColor: [35, 48, 36],
          getAlignmentBaseline: 'bottom',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          sizeUnits: 'pixels',
          sizeMinPixels: 16,
          billboard: true,
          background: true,
          backgroundPadding: [6, 3],
          backgroundBorderRadius: 5,
          getBackgroundColor: [250, 252, 247, 245]
        })
      ]
    });
  };
  const onInput = () => render();
  root.addEventListener('input', onInput);
  render();
  return () => {
    root.removeEventListener('input', onInput);
    deck.finalize();
    root.remove();
  };
}
