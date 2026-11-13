import {
  TreeLayer,
  type TreeInterpolationSettings,
  type TreeLayerProps,
  type TreeLean,
  type TreeSpec,
  type TreeTransitions,
  type TreeTransitionSettings,
  type CropConfig
} from '@deck.gl-community/layers';
const data = [{position: [0, 0] as [number, number], height: 12}];
const props: TreeLayerProps<(typeof data)[number]> = {
  id: 'orchard',
  data,
  getTreeType: 'citrus',
  getHeight: (tree, {index, data: rows}) =>
    tree.height + index + (Array.isArray(rows) ? rows.length : 0),
  getSeason: 'summer',
  getCrop: {kind: 'lemon', count: 4, radius: 0.05, color: [255, 220, 40]},
  lodBias: 0
};
new TreeLayer(props);
new TreeLayer({data, getTreeType: 'oak', getElevation: -10, getTrunkColor: null});
// @ts-expect-error The Gaussian canopy budget has been removed.
new TreeLayer({data, maxCanopySplats: 20_000});
const crop: CropConfig = {kind: 'acorn', color: [100, 70, 30], count: 4, radius: 0.1};
new TreeLayer({...props, getCrop: crop});
// @ts-expect-error Manual detail modes are no longer part of the canonical API.
new TreeLayer<(typeof data)[number]>({data, detail: 'low'});
// @ts-expect-error Species are constrained to the supported suite.
new TreeLayer<(typeof data)[number]>({data, getTreeType: 'maple'});

const traits: TreeSpec[] = [
  {
    position: [0, 0, 3],
    species: 'citrus',
    height: 5,
    crownRadius: 2,
    wind: true,
    characteristics: {leafSize: 1.2}
  }
];
new TreeLayer({data: traits});
new TreeLayer({
  data,
  getTree: tree => ({position: tree.position, species: 'oak', height: tree.height, wind: false})
});
// @ts-expect-error Per-tree species retain the supported species contract.
const invalidTraits: TreeSpec = {species: 'maple'};
void invalidTraits;

// The lifecycle, on every part of the public API: props, accessors and `TreeSpec` fields.
const lean: TreeLean = [12, 80];
const blossom: CropConfig = {kind: 'flower', color: [255, 252, 240], count: 90, radius: 0.018};
const fruit: CropConfig = {
  color: [244, 140, 24, 255],
  count: 40,
  droppedCount: 3,
  radius: 0.04
};
const living: TreeSpec[] = [
  {
    position: [0, 0, 0],
    species: 'citrus',
    growth: 0.4,
    health: 0.9,
    foliage: 0.8,
    flush: 0.3,
    lean,
    damage: 0.1,
    decay: 0,
    wind: 0.8,
    crop: blossom
  },
  {position: [8, 0, 0], species: 'pine', crop: fruit},
  {position: [16, 0, 0], species: 'palm', crop: null}
];
const interpolation: TreeInterpolationSettings = {
  duration: 800,
  easing: t => t * t
};
const transitions: TreeTransitions = {
  getTree: 600,
  getGrowth: interpolation,
  getLean: 1000,
  getDamage: false,
  getCrop: null,
  getCanopyColor: {duration: 300} satisfies TreeTransitionSettings
};
new TreeLayer<TreeSpec>({
  data: living,
  transitions,
  windStrength: 1,
  windDirection: 80,
  windTime: 2,
  lodBias: -1,
  woodMaterial: {ambient: 0.8, diffuse: 1, shininess: 14, specularColor: [30, 30, 30]},
  foliageMaterial: null,
  cropMaterial: {shininess: 170},
  updateTriggers: {getTree: 1}
});
new TreeLayer({
  data,
  getGrowth: tree => tree.height / 20,
  getHealth: 1,
  getFoliage: () => 0.5,
  getFlush: 0,
  getLean: (): TreeLean => [0, 0],
  getDamage: () => 0,
  getDecay: 0,
  getCrop: () => fruit
});
// @ts-expect-error TreeLayer has one renderer.
new TreeLayer({data, quality: 'photoreal'});
// @ts-expect-error A lean is `[degrees, bearing]`.
const invalidLean: TreeLean = [10];
void invalidLean;
// @ts-expect-error `transitions` is keyed by accessor name.
const invalidTransitions: TreeTransitions = {getHeightt: 100};
void invalidTransitions;
// @ts-expect-error TreeLayer transitions accept interpolation settings.
new TreeLayer({data, transitions: {getGrowth: {type: 'spring'}}});
// @ts-expect-error Only one crop can be authored per tree.
new TreeLayer({data, getCrop: () => [blossom, fruit]});
// @ts-expect-error `windDirection` is a compass bearing in degrees.
new TreeLayer({data, windDirection: 'north'});
