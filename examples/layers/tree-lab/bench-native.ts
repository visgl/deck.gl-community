import {TreeLayer} from '@deck.gl-community/layers';
import {MeshTreeLayer} from './mesh-tree-layer';
import {mountTreeBenchmark} from './benchmark';
const mesh = new URLSearchParams(location.search).get('renderer') === 'mesh';
mountTreeBenchmark(mesh ? MeshTreeLayer : TreeLayer, mesh ? 'mesh' : 'native');
