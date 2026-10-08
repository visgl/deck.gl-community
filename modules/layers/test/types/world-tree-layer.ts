import {TreeLayer, WorldTreeLayer, type TreeTileData} from '@deck.gl-community/layers';
const data = [{position: [0, 0] as [number, number], height: 12}];
new TreeLayer<(typeof data)[number]>({
  getTileData: async (): Promise<TreeTileData<(typeof data)[number]>> => ({
    byteLength: 64,
    trees: data,
    canopies: []
  }),
  getHeight: tree => tree.height,
  getSeason: 'winter',
  getDistantCanopyColor: canopy => canopy.color,
  maxVisibleTiles: 16,
  maxCacheByteSize: 1024 * 1024
});
new WorldTreeLayer({
  getTileData: async (): Promise<TreeTileData<(typeof data)[number]>> => ({
    byteLength: 64,
    trees: data,
    canopies: []
  }),
  treeProps: {getHeight: 12, getSeason: 'winter'}
});
