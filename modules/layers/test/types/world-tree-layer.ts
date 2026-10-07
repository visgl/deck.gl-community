import {WorldTreeLayer, type TreeTileData} from '@deck.gl-community/layers';
const data = [{position: [0, 0] as [number, number], height: 12}];
new WorldTreeLayer({
  getTileData: async (): Promise<TreeTileData<(typeof data)[number]>> => ({
    byteLength: 64,
    trees: data,
    canopies: []
  }),
  treeProps: {getHeight: 12, getSeason: 'winter'}
});
