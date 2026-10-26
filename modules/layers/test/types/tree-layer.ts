import {
  TreeLayer,
  type TreeLayerProps,
  type TreeSpec,
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
  maxCanopySplats: 20000
};
new TreeLayer(props);
new TreeLayer({data, getTreeType: 'oak', maxCanopySplats: 'auto'});
new TreeLayer({data, getTreeType: 'oak', getElevation: -10, getTrunkColor: null});
// @ts-expect-error Only a numeric canopy cap or the automatic policy is supported.
new TreeLayer({data, maxCanopySplats: 'dynamic'});
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
    characteristics: {leafSize: 1.2}
  }
];
new TreeLayer({data: traits});
new TreeLayer({
  data,
  getTree: tree => ({position: tree.position, species: 'oak', height: tree.height})
});
new TreeLayer({data, windEnabled: false});
// @ts-expect-error Wind is deck-wide: set it on the WindEffect, not the layer.
new TreeLayer({data, windStrength: 0.05});
// @ts-expect-error Trees have no wind of their own.
const pinnedTree: TreeSpec = {species: 'oak', wind: 0.05};
void pinnedTree;
// @ts-expect-error Per-tree species retain the supported species contract.
const invalidTraits: TreeSpec = {species: 'maple'};
void invalidTraits;
