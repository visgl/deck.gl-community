// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  type Layer,
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
const MAX_GROVE_TREES = 10000;
const SCENES = ['forest', 'grove'] as const;
type Scene = (typeof SCENES)[number];
type ShowcaseTree = TreeSpec & {label?: string; variationIndex?: number};
type CropProfile = {
  seasons: Season[];
  kind: CropKind;
  color: [number, number, number, number];
  count: number;
  radius: number;
};
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
  cropLoad: number;
  cropSize: number;
  treeCount: number;
  groveVariation: number;
};

const DEFAULT_CONTROLS: TreeLabControls = {
  scene: 'forest',
  species: 'citrus',
  season: 'autumn',
  height: 1,
  spread: 1,
  depth: 1,
  branchDensity: 1,
  leafSize: 1,
  wind: false,
  cropLoad: 100,
  cropSize: 1,
  treeCount: MAX_GROVE_TREES,
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
const TREE_CROWN_RADII: Record<TreeType, number> = {
  citrus: 2.112,
  banyan: 8.64,
  pine: 3,
  oak: 4.48,
  palm: 4.2,
  birch: 3.08,
  cherry: 2.4,
  mangrove: 2.88
};
const FOREST_TREES: ShowcaseTree[] = SPECIES.map((species, index) => ({
  species,
  position: [((index % 4) - 1.5) * 24, (index < 4 ? -1 : 1) * 22, 0],
  label: species[0].toUpperCase() + species.slice(1),
  variationIndex: index
}));
const CROP_PROFILES: Record<TreeType, CropProfile[]> = {
  citrus: [
    {
      seasons: ['autumn', 'winter'],
      kind: 'fruit',
      color: [236, 132, 28, 255],
      count: 18,
      radius: 0.09
    }
  ],
  banyan: [
    {
      seasons: ['summer', 'autumn'],
      kind: 'fruit',
      color: [146, 55, 63, 255],
      count: 32,
      radius: 0.035
    }
  ],
  pine: [
    {
      seasons: SEASONS,
      kind: 'cone',
      color: [112, 79, 49, 255],
      count: 14,
      radius: 0.075
    }
  ],
  oak: [
    {
      seasons: ['autumn'],
      kind: 'acorn',
      color: [137, 93, 47, 255],
      count: 24,
      radius: 0.03
    }
  ],
  palm: [
    {
      seasons: ['summer', 'autumn'],
      kind: 'fruit',
      color: [181, 108, 37, 255],
      count: 28,
      radius: 0.055
    }
  ],
  birch: [
    {
      seasons: ['spring'],
      kind: 'catkin',
      color: [164, 134, 90, 255],
      count: 24,
      radius: 0.04
    }
  ],
  cherry: [
    {
      seasons: ['spring'],
      kind: 'flower',
      color: [255, 195, 216, 255],
      count: 28,
      radius: 0.055
    },
    {
      seasons: ['summer'],
      kind: 'fruit',
      color: [151, 34, 52, 255],
      count: 26,
      radius: 0.03
    }
  ],
  mangrove: [
    {
      seasons: ['summer', 'autumn'],
      kind: 'propagule',
      color: [106, 126, 65, 255],
      count: 18,
      radius: 0.085
    }
  ]
};
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
  {name: 'crop-load', label: 'Crop load', min: 0, max: 100, step: 10, value: 100, unit: '%'},
  {name: 'crop-size', label: 'Crop size', min: 0.7, max: 1.3, step: 0.1, value: 1, unit: '×'}
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

/** Mount the mixed-species TreeLayer forest and a scalable, single-species grove. */
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
    'crop-load': controls.cropLoad,
    'crop-size': controls.cropSize,
    'tree-count': controls.treeCount,
    'grove-variation': controls.groveVariation
  };
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.innerHTML = `<section class="trees-panel" aria-label="TreeLayer controls">
    <header class="trees-panel-header">
      <div class="trees-panel-title"><strong>TreeLayer</strong><span>Interactive showcase</span></div>
      <button class="trees-panel-toggle" type="button" aria-label="Collapse TreeLayer controls" aria-expanded="true">▾</button>
    </header>
    <div class="trees-panel-content">
      <div class="trees-controls">
        <p class="trees-intro">Mixed-species forest and a row-planted grove of up to 10,000 trees.</p>
        <label class="trees-select"><span>Scene</span><select name="scene"><option value="forest"${controls.scene === 'forest' ? ' selected' : ''}>Mixed-species forest · 8 trees</option><option value="grove"${controls.scene === 'grove' ? ' selected' : ''}>Tree grove · up to 10,000</option></select></label>
        <label class="trees-select trees-species"><span>Grove species</span><select name="species">${SPECIES.map(
          species =>
            `<option value="${species}"${species === controls.species ? ' selected' : ''}>${species}</option>`
        ).join('')}</select></label>
        <label class="trees-select"><span>Season</span><select name="season">${SEASONS.map(
          season => `<option${season === controls.season ? ' selected' : ''}>${season}</option>`
        ).join('')}</select></label>
        ${TREE_TRAITS.map(
          trait =>
            `<label class="trees-range${trait.name.startsWith('crop-') ? ' trees-crop-control' : ''}"><span>${trait.label}</span><input name="${trait.name}" type="range" min="${trait.min}" max="${trait.max}" step="${trait.step}" value="${traitValues[trait.name]}"><output name="${trait.name}-value">${formatTraitValue(trait.name, traitValues[trait.name])}</output></label>`
        ).join('')}
        <label class="trees-range trees-tree-count"><span>Trees in grove</span><input name="tree-count" type="range" min="1" max="${MAX_GROVE_TREES}" step="1" value="${controls.treeCount}"><output name="tree-count-value">${controls.treeCount.toLocaleString()}</output></label>
        <label class="trees-range trees-grove-variation"><span>Natural variation</span><input name="grove-variation" type="range" min="0" max="1" step="0.1" value="${controls.groveVariation}"><output name="grove-variation-value">${formatTraitValue('grove-variation', controls.groveVariation)}</output></label>
        <label class="trees-toggle"><input name="wind" type="checkbox"${controls.wind ? ' checked' : ''}><span>Gentle breeze</span></label>
        <p class="trees-note trees-crop-note">Crop type and natural size follow each species; these controls adjust the whole forest.</p>
        <p class="trees-note trees-grove-note">Rows stay in place as the count changes. Crops and labels are omitted in the high-count scene.</p>
      </div>
    </div>
  </section><div class="trees-stage"></div>`;
  container.append(root);
  const controlsElement = root.querySelector<HTMLDivElement>('.trees-controls')!;
  const panelContent = root.querySelector<HTMLDivElement>('.trees-panel-content')!;
  const panelToggle = root.querySelector<HTMLButtonElement>('.trees-panel-toggle')!;
  const stage = root.querySelector<HTMLDivElement>('.trees-stage')!;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
    controlsElement.querySelector<T>(`[name="${name}"]`)!;
  const groundMesh = new PlaneGeometry({type: 'x,y', xlen: 6000, ylen: 6000});
  const lighting = new LightingEffect({
    ambient: new AmbientLight({intensity: 1}),
    sun: new DirectionalLight({intensity: 0.5, direction: [0.8, 0.2, -1.6]})
  });
  const groveDataBySpecies = new Map<TreeType, ShowcaseTree[]>();
  const initialViewState =
    options.initialViewState ??
    getViewState(
      stage.clientWidth,
      stage.clientHeight,
      controls.scene,
      controls.species,
      controls.treeCount
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
    const {
      scene,
      species,
      season,
      height: heightScale,
      spread,
      depth,
      branchDensity,
      leafSize,
      wind,
      cropLoad,
      cropSize,
      treeCount,
      groveVariation
    } = controls;
    if (!groveDataBySpecies.has(species)) {
      groveDataBySpecies.set(
        species,
        createGrovePositions(TREE_CROWN_RADII[species] * 2.4).map((position, variationIndex) => ({
          species,
          position,
          variationIndex
        }))
      );
    }
    controlsElement.querySelector<HTMLLabelElement>('.trees-species')!.hidden = scene === 'forest';
    controlsElement.querySelector<HTMLLabelElement>('.trees-tree-count')!.hidden =
      scene !== 'grove';
    controlsElement.querySelector<HTMLLabelElement>('.trees-grove-variation')!.hidden =
      scene !== 'grove';
    controlsElement.querySelector<HTMLLabelElement>('.trees-toggle')!.hidden = scene !== 'forest';
    controlsElement.querySelectorAll<HTMLLabelElement>('.trees-crop-control').forEach(control => {
      control.hidden = scene !== 'forest';
    });
    controlsElement.querySelector<HTMLParagraphElement>('.trees-crop-note')!.hidden =
      scene !== 'forest';
    controlsElement.querySelector<HTMLParagraphElement>('.trees-grove-note')!.hidden =
      scene !== 'grove';
    const trees: ShowcaseTree[] =
      scene === 'grove' ? groveDataBySpecies.get(species)!.slice(0, treeCount) : FOREST_TREES;
    const layers: Layer[] = [
      new SimpleMeshLayer({
        ...coordinateProps,
        id: 'ground',
        data: [{position: [0, 0, -0.05]}],
        mesh: groundMesh,
        getColor: [219, 228, 210],
        material: {ambient: 1, diffuse: 0, shininess: 0}
      })
    ];
    if (scene === 'forest') {
      // Labels belong to the ground pass so TreeLayer's sorted canopy resolves over them.
      layers.push(
        new TextLayer<ShowcaseTree>({
          ...coordinateProps,
          id: 'labels',
          data: FOREST_TREES,
          getPosition: tree => [
            tree.position![0],
            tree.position![1] + (tree.position![1] < 0 ? -12 : 12),
            0.1
          ],
          getText: tree => tree.label!,
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
      );
    }
    layers.push(
      new TreeLayer<ShowcaseTree>({
        ...coordinateProps,
        id: 'trees',
        data: trees,
        getTree: tree => {
          const treeSpecies = tree.species ?? species;
          const variation =
            scene === 'grove' && tree.variationIndex !== undefined
              ? getTreeVariation(tree.variationIndex, groveVariation)
              : undefined;
          const speciesHeight = TREE_HEIGHTS[treeSpecies];
          const crop =
            scene === 'forest' ? getSpeciesCrop(treeSpecies, season, cropLoad, cropSize) : null;
          return {
            species: treeSpecies,
            position: tree.position,
            height: speciesHeight * heightScale * (variation?.height ?? 1),
            crownRadius: TREE_CROWN_RADII[treeSpecies] * spread * (variation?.crown ?? 1),
            season,
            wind: wind && scene === 'forest',
            crop,
            characteristics: {
              crownSpread: 1,
              crownDepth: depth,
              branchDensity,
              leafSize
            }
          };
        },
        pickable: scene === 'forest',
        updateTriggers: {
          getTree: [
            scene,
            species,
            season,
            heightScale,
            spread,
            depth,
            branchDensity,
            leafSize,
            wind,
            cropLoad,
            cropSize,
            treeCount,
            groveVariation
          ]
        }
      })
    );
    deck.setProps({layers});
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
    controls.cropLoad = Number(control<HTMLInputElement>('crop-load').value);
    controls.cropSize = Number(control<HTMLInputElement>('crop-size').value);
    controls.treeCount = Number(control<HTMLInputElement>('tree-count').value);
    controls.groveVariation = Number(control<HTMLInputElement>('grove-variation').value);
    controlsByContainer.set(container, {...controls});
    if (['scene', 'species', 'height', 'spread', 'depth', 'tree-count'].includes(name)) {
      const refitCenter = ['scene', 'species', 'tree-count'].includes(name);
      const fittedViewState = getViewState(
        stage.clientWidth,
        stage.clientHeight,
        controls.scene,
        controls.species,
        controls.treeCount
      );
      deck.setProps({
        initialViewState: {
          ...fittedViewState,
          longitude: refitCenter
            ? fittedViewState.longitude
            : (currentViewState.longitude ?? fittedViewState.longitude),
          latitude: refitCenter
            ? fittedViewState.latitude
            : (currentViewState.latitude ?? fittedViewState.latitude),
          bearing: refitCenter
            ? fittedViewState.bearing
            : (currentViewState.bearing ?? fittedViewState.bearing),
          pitch:
            refitCenter || currentViewState.pitch == null
              ? fittedViewState.pitch
              : currentViewState.pitch,
          transitionDuration: name === 'tree-count' ? 300 : 0
        }
      });
    }
    render();
  };
  const onPanelToggle = () => {
    const expanded = panelToggle.getAttribute('aria-expanded') === 'true';
    panelToggle.setAttribute('aria-expanded', String(!expanded));
    panelToggle.setAttribute(
      'aria-label',
      expanded ? 'Expand TreeLayer controls' : 'Collapse TreeLayer controls'
    );
    panelToggle.textContent = expanded ? '▸' : '▾';
    panelContent.hidden = expanded;
  };
  controlsElement.addEventListener('input', onInput);
  panelToggle.addEventListener('click', onPanelToggle);
  render();
  return () => {
    controlsElement.removeEventListener('input', onInput);
    panelToggle.removeEventListener('click', onPanelToggle);
    deck.finalize();
    root.remove();
  };
}

function formatTraitValue(name: string, value: number): string {
  if (name === 'grove-variation') return `${Math.round(value * 100)}%`;
  if (name === 'crop-load') return `${Math.round(value)}%`;
  if (name === 'crop-size') return `${value.toFixed(1)}×`;
  return `${value.toFixed(1)}×`;
}

function getViewState(
  width: number,
  height: number,
  scene: Scene,
  species: TreeType,
  treeCount: number
) {
  const groveSpacing = TREE_CROWN_RADII[species] * 1.9;
  const groveCells = Math.ceil(Math.sqrt(Math.max(1, treeCount)));
  const extent =
    scene === 'forest'
      ? 92
      : treeCount === 1
        ? Math.max(TREE_CROWN_RADII[species] * 3.7, TREE_HEIGHTS[species] * 3.5)
        : groveSpacing * groveCells * 1.15;
  const pixels = Math.max(1, Math.min(width * 0.82, height * 0.72));
  const zoom =
    Math.log2((156543.0339 * pixels) / extent) +
    (scene === 'grove' && treeCount === 1 ? 0.6 : 0) +
    (scene === 'grove' ? Math.log2(Math.max(1, TREE_HEIGHTS[species] / 12)) * 0.35 : 0);
  const pitch =
    scene === 'forest'
      ? 38
      : treeCount === 1
        ? 58
        : Math.max(20, 38 - Math.log10(Math.max(1, treeCount)) * 4.5);
  const latitude =
    scene === 'grove' && treeCount === 1 ? (height * 0.27 * (156543.0339 / 2 ** zoom)) / 111320 : 0;
  return {
    longitude: 0,
    latitude,
    maxZoom: 26,
    zoom,
    pitch,
    bearing: scene === 'forest' ? 18 : 0
  };
}

function getTreeVariation(index: number, strength: number) {
  const vary = (salt: number, amount: number) => 1 + randomUnit(index, salt) * amount * strength;
  return {
    height: vary(1, 0.12),
    crown: vary(2, 0.2)
  };
}

function createGrovePositions(spacing: number): [number, number, number][] {
  const positions: [number, number, number][] = [];
  positions.push([0, 0, 0]);
  let index = 1;
  for (let ring = 1; index < MAX_GROVE_TREES; ring++) {
    // Fill each square ring in horizontal runs so the full grove reads as planted rows.
    for (let row = -ring; row <= ring && index < MAX_GROVE_TREES; row++) {
      const columns = row === -ring || row === ring ? 2 * ring + 1 : 2;
      for (let column = 0; column < columns && index < MAX_GROVE_TREES; column++) {
        const x = row === -ring || row === ring ? column - ring : column === 0 ? -ring : ring;
        const y = row;
        positions.push([
          x * spacing + randomUnit(index, 4) * spacing * 0.14,
          y * spacing + randomUnit(index, 5) * spacing * 0.14,
          0
        ]);
        index++;
      }
    }
  }
  return positions;
}

function randomUnit(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = (value ^ (value >>> 16)) >>> 0;
  return (value / 0xffffffff) * 2 - 1;
}

function getSpeciesCrop(
  species: TreeType,
  season: Season,
  load: number,
  size: number
): CropConfig | null {
  const profile = CROP_PROFILES[species].find(candidate => candidate.seasons.includes(season));
  const count = Math.round((profile?.count ?? 0) * (load / 100));
  if (!profile || count <= 0) return null;
  return {
    kind: profile.kind,
    color: profile.color,
    count,
    radius: profile.radius * size
  };
}
