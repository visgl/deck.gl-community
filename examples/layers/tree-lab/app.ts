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
import {
  TreeLayer,
  type CropConfig,
  type Season,
  type TreeSpec,
  type TreeType
} from '@deck.gl-community/layers';
import './style.css';

const SPECIES: TreeType[] = [
  'citrus',
  'banyan',
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'mangrove'
];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
type Scene = 'specimen' | 'grove';
type ShowcaseTree = TreeSpec & {label?: string};
type TreeLabControls = {
  scene: Scene;
  species: TreeType;
  season: Season;
  height: number;
  spread: number;
  depth: number;
  branchDensity: number;
  leafSize: number;
  wind: boolean;
};
const DEFAULT_CONTROLS: TreeLabControls = {
  scene: 'specimen',
  species: 'citrus',
  season: 'summer',
  height: 1,
  spread: 1,
  depth: 1,
  branchDensity: 1,
  leafSize: 1,
  wind: false
};
const controlsByContainer = new WeakMap<HTMLElement, TreeLabControls>();
const TREE_HEIGHTS: Record<TreeType, number> = {
  citrus: 4.8,
  banyan: 18,
  pine: 12,
  oak: 14,
  palm: 12,
  birch: 14,
  cherry: 8,
  mangrove: 8
};
const GROVE_TREES: ShowcaseTree[] = [
  {species: 'citrus', position: [-10, -9, 0], label: 'Citrus'},
  {species: 'banyan', position: [0, -10, 0], label: 'Banyan'},
  {species: 'pine', position: [10, -9, 0], label: 'Pine'},
  {species: 'oak', position: [-11, 1, 0], label: 'Oak'},
  {species: 'palm', position: [0, 1, 0], label: 'Palm'},
  {species: 'birch', position: [11, 1, 0], label: 'Birch'},
  {species: 'cherry', position: [-6, 11, 0], label: 'Cherry'},
  {species: 'mangrove', position: [6, 11, 0], label: 'Mangrove'}
];
const TREE_TRAITS = [
  {name: 'height', label: 'Height', min: 0.5, max: 1.8, step: 0.1, value: 1, unit: '×'},
  {name: 'spread', label: 'Crown spread', min: 0.6, max: 1.5, step: 0.1, value: 1, unit: '×'},
  {name: 'depth', label: 'Crown depth', min: 0.6, max: 1.4, step: 0.1, value: 1, unit: '×'},
  {
    name: 'branch-density',
    label: 'Branch density',
    min: 0.5,
    max: 1.5,
    step: 0.1,
    value: 1,
    unit: '×'
  },
  {name: 'leaf-size', label: 'Leaf size', min: 0.5, max: 1.8, step: 0.1, value: 1, unit: '×'}
] as const;
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

/** Mount the single TreeLayer showcase, with an editable specimen and mixed-species grove. */
export function mountTreeLabExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const controls = {...DEFAULT_CONTROLS, ...controlsByContainer.get(container)};
  const traitValues = {
    height: controls.height,
    spread: controls.spread,
    depth: controls.depth,
    'branch-density': controls.branchDensity,
    'leaf-size': controls.leafSize
  };
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.innerHTML = `<div class="trees-controls">
    <div class="trees-heading"><strong>TreeLayer</strong><span>One showcase · every species and season</span></div>
    <label class="trees-select"><span>Scene</span><select name="scene"><option value="specimen"${controls.scene === 'specimen' ? ' selected' : ''}>Citrus specimen</option><option value="grove"${controls.scene === 'grove' ? ' selected' : ''}>Mixed-species grove · 8 trees</option></select></label>
    <label class="trees-select trees-species"><span>Species</span><select name="species">${SPECIES.map(
      species =>
        `<option value="${species}"${species === controls.species ? ' selected' : ''}>${species}</option>`
    ).join('')}</select></label>
    <label class="trees-select"><span>Season</span><select name="season">${SEASONS.map(
      season => `<option${season === controls.season ? ' selected' : ''}>${season}</option>`
    ).join('')}</select></label>
    ${TREE_TRAITS.map(
      trait =>
        `<label class="trees-range"><span>${trait.label}</span><input name="${trait.name}" type="range" min="${trait.min}" max="${trait.max}" step="${trait.step}" value="${traitValues[trait.name]}"><output name="${trait.name}-value">${traitValues[trait.name].toFixed(1)}${trait.unit}</output></label>`
    ).join('')}
    <label class="trees-toggle"><input name="wind" type="checkbox"${controls.wind ? ' checked' : ''}><span>Gentle breeze</span></label>
  </div><div class="trees-stage"></div>`;
  container.append(root);
  const stage = root.querySelector<HTMLDivElement>('.trees-stage')!;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
    root.querySelector<T>(`[name="${name}"]`)!;
  const output = (name: string) => root.querySelector<HTMLOutputElement>(`[name="${name}-value"]`)!;
  const speciesControl = root.querySelector<HTMLLabelElement>('.trees-species')!;
  const groundMesh = new PlaneGeometry({type: 'x,y', xlen: 1000, ylen: 1000});
  const lighting = new LightingEffect({
    ambient: new AmbientLight({intensity: 1}),
    sun: new DirectionalLight({intensity: 0.5, direction: [0.8, 0.2, -1.6]})
  });
  let cachedSpecies: TreeType | undefined;
  let cachedData: TreeSpec[] = [];
  const initialViewState =
    options.initialViewState ??
    getViewState(
      stage.clientWidth,
      stage.clientHeight,
      controls.scene,
      controls.species,
      controls.height,
      controls.spread,
      controls.depth
    );
  let currentViewState = initialViewState;
  const deck = new Deck<MapView>({
    ...options,
    parent: stage,
    views: new MapView(),
    initialViewState,
    controller: true,
    useDevicePixels: 1,
    onViewStateChange: params => {
      currentViewState = params.viewState;
      return options.onViewStateChange?.(params) ?? params.viewState;
    },
    getTooltip: ({object}) => object?.species ?? null,
    effects: [lighting],
    layers: []
  });
  options.onDeckInitialized?.(deck);
  const render = () => {
    const scene = control<HTMLSelectElement>('scene').value as Scene;
    const species = control<HTMLSelectElement>('species').value as TreeType;
    const season = control<HTMLSelectElement>('season').value as Season;
    const heightScale = Number(control<HTMLInputElement>('height').value);
    const spread = Number(control<HTMLInputElement>('spread').value);
    const depth = Number(control<HTMLInputElement>('depth').value);
    const branchDensity = Number(control<HTMLInputElement>('branch-density').value);
    const leafSize = Number(control<HTMLInputElement>('leaf-size').value);
    const wind = control<HTMLInputElement>('wind').checked;
    if (species !== cachedSpecies) {
      cachedSpecies = species;
      cachedData = [{species, position: [0, 0, 0]}];
    }
    speciesControl.hidden = scene === 'grove';
    const trees: ShowcaseTree[] = scene === 'grove' ? GROVE_TREES : cachedData;
    output('height').textContent = `${heightScale.toFixed(1)}×`;
    output('spread').textContent = `${spread.toFixed(1)}×`;
    output('depth').textContent = `${depth.toFixed(1)}×`;
    output('branch-density').textContent = `${branchDensity.toFixed(1)}×`;
    output('leaf-size').textContent = `${leafSize.toFixed(1)}×`;
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
        new TreeLayer<ShowcaseTree>({
          ...coordinateProps,
          id: 'trees',
          data: trees,
          getTree: tree => ({
            ...tree,
            height: TREE_HEIGHTS[tree.species ?? species] * heightScale,
            season,
            wind,
            crop: getSeasonalCrop(tree.species ?? species, season),
            characteristics: {
              crownSpread: spread,
              crownDepth: depth,
              branchDensity,
              leafSize
            }
          }),
          pickable: true,
          updateTriggers: {
            getTree: [scene, heightScale, season, spread, depth, branchDensity, leafSize, wind]
          }
        }),
        new TextLayer<ShowcaseTree>({
          ...coordinateProps,
          id: 'labels',
          data: trees,
          getPosition: tree => [
            tree.position![0],
            tree.position![1] -
              (scene === 'grove' ? 2.5 : Math.max(2, TREE_HEIGHTS[species] * 0.5)),
            0.2
          ],
          getText: tree => tree.label ?? tree.species![0].toUpperCase() + tree.species!.slice(1),
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
          getBackgroundColor: [250, 252, 247, 245],
          visible: scene === 'grove'
        })
      ]
    });
  };
  const onInput = (event: Event) => {
    const name = (event.target as HTMLInputElement | HTMLSelectElement).name;
    controls.scene = control<HTMLSelectElement>('scene').value as Scene;
    controls.species = control<HTMLSelectElement>('species').value as TreeType;
    controls.season = control<HTMLSelectElement>('season').value as Season;
    controls.height = Number(control<HTMLInputElement>('height').value);
    controls.spread = Number(control<HTMLInputElement>('spread').value);
    controls.depth = Number(control<HTMLInputElement>('depth').value);
    controls.branchDensity = Number(control<HTMLInputElement>('branch-density').value);
    controls.leafSize = Number(control<HTMLInputElement>('leaf-size').value);
    controls.wind = control<HTMLInputElement>('wind').checked;
    controlsByContainer.set(container, {...controls});
    if (['scene', 'species', 'height', 'spread', 'depth'].includes(name)) {
      const fittedViewState = getViewState(
        stage.clientWidth,
        stage.clientHeight,
        controls.scene,
        controls.species,
        controls.height,
        controls.spread,
        controls.depth
      );
      deck.setProps({
        initialViewState: {
          ...fittedViewState,
          longitude: currentViewState.longitude ?? fittedViewState.longitude,
          latitude: currentViewState.latitude ?? fittedViewState.latitude,
          bearing: currentViewState.bearing ?? fittedViewState.bearing,
          pitch: currentViewState.pitch ?? fittedViewState.pitch
        }
      });
    }
    render();
  };
  root.addEventListener('input', onInput);
  render();
  return () => {
    root.removeEventListener('input', onInput);
    deck.finalize();
    root.remove();
  };
}

function getViewState(
  width: number,
  height: number,
  scene: Scene,
  species: TreeType,
  heightScale: number,
  spread: number,
  depth: number
) {
  const scale = Math.max(0.25, Math.min(width / 400, height / 600));
  const speciesScale = scene === 'specimen' ? TREE_HEIGHTS[species] / TREE_HEIGHTS.citrus : 1;
  const treeScale = Math.max(speciesScale * heightScale, spread, depth);
  return {
    longitude: 0,
    latitude: 0,
    maxZoom: 24,
    zoom: (scene === 'specimen' ? 22.4 : 20.2) + Math.log2(scale) - Math.log2(treeScale) * 0.8,
    pitch: scene === 'specimen' ? 45 : 38,
    bearing: scene === 'specimen' ? 20 : 0
  };
}

function getSeasonalCrop(species: TreeType, season: Season): CropConfig | null {
  if (species === 'citrus' && ['autumn', 'winter'].includes(season)) {
    return {kind: 'fruit', color: [255, 151, 18, 255], count: 18, radius: 0.18};
  }
  if (species === 'cherry' && season === 'spring') {
    return {kind: 'flower', color: [255, 205, 222, 255], count: 20, radius: 0.24};
  }
  return null;
}
