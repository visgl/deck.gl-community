// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  OrbitView,
  type DeckProps
} from '@deck.gl/core';
import {SolidPolygonLayer, TextLayer} from '@deck.gl/layers';
import {
  TreeLayer,
  type CropConfig,
  type Season,
  type TreeSpec,
  type TreeType
} from '@deck.gl-community/layers';
import './style.css';

const SPECIES: TreeType[] = [
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus'
];
const CROPS: CropConfig[] = [
  {kind: 'cone', color: [132, 91, 49], radius: 0.08, count: 24},
  {kind: 'acorn', color: [166, 111, 53], radius: 0.025, count: 24},
  {kind: 'fruit', color: [151, 103, 57], radius: 0.14, count: 24},
  {kind: 'catkin', color: [165, 150, 73], radius: 0.055, count: 24},
  {kind: 'fruit', color: [163, 24, 43], radius: 0.025, count: 24},
  {kind: 'fruit', color: [190, 74, 45], radius: 0.012, count: 24},
  {kind: 'propagule', color: [122, 112, 47], radius: 0.15, count: 24},
  {kind: 'fruit', color: [248, 141, 24], radius: 0.045, count: 24}
];
const TREES: TreeSpec[] = SPECIES.map((species, i) => ({
  species,
  position: [((i % 4) - 1.5) * 22, (Math.floor(i / 4) - 0.5) * 26, 0],
  crop: CROPS[i]
}));
type MountOptions = Pick<
  DeckProps<OrbitView>,
  'device' | 'initialViewState' | 'widgets' | 'onViewStateChange'
> & {
  onDeckInitialized?: (deck: Deck<OrbitView>) => void;
};

/** Mount a small species garden using TreeLayer's public traits and lighting APIs. */
export function mountTreeLabExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.innerHTML = `<div class="trees-controls">
    <strong>TreeLayer</strong>
    <label>Species <select name="species"><option value="all">All eight</option>${SPECIES.map(s => `<option>${s}</option>`).join('')}</select></label>
    <label>Season <select name="season">${['spring', 'summer', 'autumn', 'winter'].map(s => `<option${s === 'summer' ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>Crown spread <input name="spread" type="range" min="0.6" max="1.5" step="0.1" value="1"></label>
    <label><input name="wind" type="checkbox" checked>Wind</label>
    <label><input name="attached" type="checkbox" checked>Attached crops</label>
    <label><input name="fallen" type="checkbox">Fallen crops</label>
    <label><input name="shadows" type="checkbox">Wood shadows</label>
    <span>Drag to orbit · scroll to zoom · hover to identify</span>
  </div><div class="trees-stage"></div>`;
  container.append(root);
  const stage = root.querySelector<HTMLDivElement>('.trees-stage')!;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
    root.querySelector<T>(`[name="${name}"]`)!;
  const shadows = control<HTMLInputElement>('shadows');
  shadows.disabled = options.device?.type === 'webgpu';
  const deck = new Deck<OrbitView>({
    ...options,
    parent: stage,
    views: new OrbitView({orbitAxis: 'Z', orthographic: true}),
    initialViewState: options.initialViewState ?? {
      target: [0, 0, 6],
      rotationX: 30,
      rotationOrbit: 20,
      zoom: Math.log2(
        Math.max(1, Math.min(container.clientWidth / 110, container.clientHeight / 80))
      )
    },
    controller: true,
    useDevicePixels: 1,
    getTooltip: ({object}) => object?.species ?? null
  });
  options.onDeckInitialized?.(deck);
  const render = () => {
    const selected = control<HTMLSelectElement>('species').value;
    const season = control<HTMLSelectElement>('season').value as Season;
    const spread = Number(control<HTMLInputElement>('spread').value);
    const data = TREES.filter(tree => selected === 'all' || tree.species === selected);
    const lighting = new LightingEffect({
      ambient: new AmbientLight({intensity: 1}),
      sun: new DirectionalLight({
        intensity: 1.5,
        direction: [-1, -1, -2],
        _shadow: shadows.checked && !shadows.disabled
      })
    });
    deck.setProps({
      effects: [lighting],
      layers: [
        new SolidPolygonLayer({
          id: 'ground',
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          data: [
            [
              [-65, -42, -0.02],
              [65, -42, -0.02],
              [65, 42, -0.02],
              [-65, 42, -0.02]
            ]
          ],
          getPolygon: polygon => polygon,
          getFillColor: [219, 228, 210],
          material: {ambient: 0.7, diffuse: 0.6},
          shadowEnabled: false
        }),
        new TreeLayer<TreeSpec>({
          id: 'trees',
          data,
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          getTree: tree => ({
            ...tree,
            season,
            wind: control<HTMLInputElement>('wind').checked,
            characteristics: {crownSpread: spread},
            crop: {
              ...tree.crop!,
              count: control<HTMLInputElement>('attached').checked ? 24 : 0,
              droppedCount: control<HTMLInputElement>('fallen').checked ? 8 : 0
            }
          }),
          pickable: true,
          updateTriggers: {
            getTree: [
              season,
              spread,
              control<HTMLInputElement>('wind').checked,
              control<HTMLInputElement>('attached').checked,
              control<HTMLInputElement>('fallen').checked
            ]
          }
        }),
        new TextLayer<TreeSpec>({
          id: 'labels',
          data,
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          getPosition: tree => [tree.position![0], tree.position![1] - 9, 0.2],
          getText: tree => {
            const species = tree.species!;
            return species[0].toUpperCase() + species.slice(1);
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
  root.addEventListener('input', render);
  render();
  return () => {
    root.removeEventListener('input', render);
    deck.finalize();
    root.remove();
  };
}
