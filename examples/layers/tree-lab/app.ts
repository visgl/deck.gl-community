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
  type CropKind,
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
const CROP_CHOICES: {value: CropChoice; label: string}[] = [
  {value: 'seasonal', label: 'Seasonal'},
  {value: 'none', label: 'None'},
  {value: 'fruit', label: 'Fruit'},
  {value: 'lemon', label: 'Lemon'},
  {value: 'cone', label: 'Cone'},
  {value: 'acorn', label: 'Acorn'},
  {value: 'catkin', label: 'Catkin'},
  {value: 'flower', label: 'Flower'},
  {value: 'propagule', label: 'Propagule'}
];
type Scene = 'specimen' | 'grove' | 'forest';
type CropChoice = 'seasonal' | 'none' | CropKind;
type ShowcaseTree = TreeSpec & {label?: string; variationIndex?: number};
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
  cropKind: CropChoice;
  cropCount: number;
  droppedCropCount: number;
  cropRadius: number;
  groveVariation: number;
};
const DEFAULT_CONTROLS: TreeLabControls = {
  scene: 'specimen',
  species: 'citrus',
  season: 'autumn',
  height: 1,
  spread: 1,
  depth: 1,
  branchDensity: 1,
  leafSize: 1,
  wind: false,
  cropKind: 'seasonal',
  cropCount: 18,
  droppedCropCount: 0,
  cropRadius: 0.18,
  groveVariation: 0.7
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
const GROVE_POSITIONS: [number, number, number][] = [
  [-6.5, -9.5, 0],
  [6.5, -9.5, 0],
  [-6.5, 0, 0],
  [6.5, 0, 0],
  [-6.5, 9.5, 0],
  [6.5, 9.5, 0]
];
const FOREST_TREES: ShowcaseTree[] = [
  {species: 'citrus', position: [-12, -12, 0], label: 'Citrus'},
  {species: 'pine', position: [12, -12, 0], label: 'Pine'},
  {species: 'oak', position: [-12, 12, 0], label: 'Oak'},
  {species: 'cherry', position: [12, 12, 0], label: 'Cherry'}
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
  {name: 'leaf-size', label: 'Leaf size', min: 0.5, max: 1.8, step: 0.1, value: 1, unit: '×'},
  {name: 'crop-count', label: 'Attached crops', min: 0, max: 40, step: 1, value: 18, unit: ''},
  {name: 'dropped-crops', label: 'Fallen crops', min: 0, max: 12, step: 1, value: 0, unit: ''},
  {name: 'crop-radius', label: 'Crop size', min: 0.06, max: 0.3, step: 0.02, value: 0.18, unit: 'm'}
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

/** Mount the single TreeLayer showcase, with an editable specimen, species grove, and forest. */
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
    'leaf-size': controls.leafSize,
    'crop-count': controls.cropCount,
    'dropped-crops': controls.droppedCropCount,
    'crop-radius': controls.cropRadius,
    'grove-variation': controls.groveVariation
  };
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.innerHTML = `<div class="trees-controls">
    <div class="trees-heading"><strong>TreeLayer</strong><span>One showcase · traits, crops, and seasons</span></div>
    <label class="trees-select"><span>Scene</span><select name="scene"><option value="specimen"${controls.scene === 'specimen' ? ' selected' : ''}>Citrus specimen</option><option value="grove"${controls.scene === 'grove' ? ' selected' : ''}>Species grove · 6 trees in rows</option><option value="forest"${controls.scene === 'forest' ? ' selected' : ''}>Mixed-species forest · 4 trees</option></select></label>
    <label class="trees-select trees-species"><span>Species</span><select name="species">${SPECIES.map(
      species =>
        `<option value="${species}"${species === controls.species ? ' selected' : ''}>${species}</option>`
    ).join('')}</select></label>
    <label class="trees-select"><span>Season</span><select name="season">${SEASONS.map(
      season => `<option${season === controls.season ? ' selected' : ''}>${season}</option>`
    ).join('')}</select></label>
    <label class="trees-select"><span>Crop</span><select name="crop-kind">${CROP_CHOICES.map(
      choice =>
        `<option value="${choice.value}"${choice.value === controls.cropKind ? ' selected' : ''}>${choice.label}</option>`
    ).join('')}</select></label>
    ${TREE_TRAITS.map(
      trait =>
        `<label class="trees-range"><span>${trait.label}</span><input name="${trait.name}" type="range" min="${trait.min}" max="${trait.max}" step="${trait.step}" value="${traitValues[trait.name]}"><output name="${trait.name}-value">${formatTraitValue(trait.name, traitValues[trait.name])}</output></label>`
    ).join('')}
    <label class="trees-range trees-grove-variation"><span>Grove variation</span><input name="grove-variation" type="range" min="0" max="1" step="0.1" value="${controls.groveVariation}"><output name="grove-variation-value">${formatTraitValue('grove-variation', controls.groveVariation)}</output></label>
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
  let cachedGroveSpecies: TreeType | undefined;
  let cachedGroveData: ShowcaseTree[] = [];
  const initialViewState =
    options.initialViewState ??
    getViewState(
      stage.clientWidth,
      stage.clientHeight,
      controls.scene,
      controls.species,
      controls.height,
      controls.spread,
      controls.depth,
      controls.groveVariation
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
    const cropKind = control<HTMLSelectElement>('crop-kind').value as CropChoice;
    const cropCount = Number(control<HTMLInputElement>('crop-count').value);
    const droppedCropCount = Number(control<HTMLInputElement>('dropped-crops').value);
    const cropRadius = Number(control<HTMLInputElement>('crop-radius').value);
    const groveVariation = Number(control<HTMLInputElement>('grove-variation').value);
    if (species !== cachedSpecies) {
      cachedSpecies = species;
      cachedData = [{species, position: [0, 0, 0]}];
    }
    if (species !== cachedGroveSpecies) {
      cachedGroveSpecies = species;
      cachedGroveData = GROVE_POSITIONS.map((position, variationIndex) => ({
        species,
        position,
        label: `${species} ${variationIndex + 1}`,
        variationIndex
      }));
    }
    speciesControl.hidden = scene === 'forest';
    root.querySelector<HTMLLabelElement>('.trees-grove-variation')!.hidden = scene !== 'grove';
    const trees: ShowcaseTree[] =
      scene === 'grove' ? cachedGroveData : scene === 'forest' ? FOREST_TREES : cachedData;
    const traitValues = {
      height: heightScale,
      spread,
      depth,
      'branch-density': branchDensity,
      'leaf-size': leafSize,
      'crop-count': cropCount,
      'dropped-crops': droppedCropCount,
      'crop-radius': cropRadius
    };
    for (const trait of TREE_TRAITS) {
      output(trait.name).textContent = formatTraitValue(trait.name, traitValues[trait.name]);
    }
    output('grove-variation').textContent = `${Math.round(groveVariation * 100)}%`;
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
          getTree: tree => {
            const variationIndex = tree.variationIndex;
            const variation =
              scene === 'grove' && variationIndex !== undefined
                ? getTreeVariation(variationIndex, groveVariation)
                : undefined;
            return {
              species: tree.species,
              position: tree.position,
              height:
                TREE_HEIGHTS[tree.species ?? species] * heightScale * (variation?.height ?? 1),
              season,
              wind,
              crop: getCrop(
                tree.species ?? species,
                season,
                cropKind,
                cropCount,
                droppedCropCount,
                cropRadius * (variation?.cropSize ?? 1)
              ),
              characteristics: {
                crownSpread: spread * (variation?.spread ?? 1),
                crownDepth: depth * (variation?.depth ?? 1),
                branchDensity: branchDensity * (variation?.branchDensity ?? 1),
                leafSize: leafSize * (variation?.leafSize ?? 1)
              }
            };
          },
          pickable: true,
          updateTriggers: {
            getTree: [
              scene,
              heightScale,
              season,
              spread,
              depth,
              branchDensity,
              leafSize,
              wind,
              cropKind,
              cropCount,
              droppedCropCount,
              cropRadius,
              groveVariation
            ]
          }
        }),
        new TextLayer<ShowcaseTree>({
          ...coordinateProps,
          id: 'labels',
          data: trees,
          getPosition: tree => [
            tree.position![0],
            tree.position![1] -
              (scene === 'specimen' ? Math.max(2, TREE_HEIGHTS[species] * 0.5) : 2),
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
          visible: scene !== 'specimen'
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
    controls.cropKind = control<HTMLSelectElement>('crop-kind').value as CropChoice;
    controls.cropCount = Number(control<HTMLInputElement>('crop-count').value);
    controls.droppedCropCount = Number(control<HTMLInputElement>('dropped-crops').value);
    controls.cropRadius = Number(control<HTMLInputElement>('crop-radius').value);
    controls.groveVariation = Number(control<HTMLInputElement>('grove-variation').value);
    controlsByContainer.set(container, {...controls});
    if (['scene', 'species', 'height', 'spread', 'depth', 'grove-variation'].includes(name)) {
      const fittedViewState = getViewState(
        stage.clientWidth,
        stage.clientHeight,
        controls.scene,
        controls.species,
        controls.height,
        controls.spread,
        controls.depth,
        controls.groveVariation
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

function formatTraitValue(name: string, value: number): string {
  if (name === 'grove-variation') return `${Math.round(value * 100)}%`;
  if (name === 'crop-radius') return `${value.toFixed(2)} m`;
  if (name === 'crop-count' || name === 'dropped-crops') return String(Math.round(value));
  return `${value.toFixed(1)}×`;
}

function getViewState(
  width: number,
  height: number,
  scene: Scene,
  species: TreeType,
  heightScale: number,
  spread: number,
  depth: number,
  groveVariation: number
) {
  const fitHeight = scene === 'specimen' ? 600 : 900;
  const scale = Math.max(0.25, Math.min(width / 400, height / fitHeight));
  const speciesScale = scene === 'specimen' ? TREE_HEIGHTS[species] / TREE_HEIGHTS.citrus : 1;
  const treeScale = Math.max(
    speciesScale * heightScale * (scene === 'grove' ? 1 + 0.28 * groveVariation : 1),
    spread,
    depth
  );
  const sceneZoom = scene === 'specimen' ? 22.4 : scene === 'grove' ? 20.8 : 20.4;
  return {
    longitude: 0,
    latitude: 0,
    maxZoom: 24,
    zoom: sceneZoom + Math.log2(scale) - Math.log2(treeScale) * 0.8,
    pitch: scene === 'specimen' ? 45 : 38,
    bearing: scene === 'specimen' ? 20 : 0
  };
}

function getTreeVariation(index: number, strength: number) {
  const vary = (salt: number, amount: number) => 1 + randomUnit(index, salt) * amount * strength;
  return {
    height: vary(1, 0.28),
    spread: vary(2, 0.3),
    depth: vary(3, 0.24),
    branchDensity: vary(4, 0.26),
    leafSize: vary(5, 0.24),
    cropSize: vary(6, 0.5)
  };
}

function randomUnit(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = (value ^ (value >>> 16)) >>> 0;
  return (value / 0xffffffff) * 2 - 1;
}

function getCrop(
  species: TreeType,
  season: Season,
  choice: CropChoice,
  count: number,
  droppedCount: number,
  radius: number
): CropConfig | null {
  if (choice === 'none') return null;
  const crop =
    choice === 'seasonal'
      ? getSeasonalCrop(species, season)
      : {kind: choice, color: getCropColor(choice, species), count, radius};
  return crop ? {...crop, count, droppedCount, radius} : null;
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

function getCropColor(kind: CropKind, species: TreeType): [number, number, number, number] {
  if (kind === 'fruit' && species === 'cherry') return [159, 35, 52, 255];
  switch (kind) {
    case 'fruit':
      return [255, 151, 18, 255];
    case 'lemon':
      return [245, 211, 37, 255];
    case 'cone':
      return [121, 85, 52, 255];
    case 'acorn':
      return [137, 93, 47, 255];
    case 'catkin':
      return [164, 134, 90, 255];
    case 'flower':
      return [255, 205, 222, 255];
    case 'propagule':
      return [101, 127, 70, 255];
    default:
      return [255, 151, 18, 255];
  }
}
