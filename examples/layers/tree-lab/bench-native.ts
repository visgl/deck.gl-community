import {TreeLayer} from '@deck.gl-community/layers';
import {ReferenceMeshTreeLayer} from './baseline/reference-mesh-tree-layer';
import {mountTreeBenchmark} from './benchmark';
const mesh = new URLSearchParams(location.search).get('renderer') === 'mesh';
mountTreeBenchmark(mesh ? ReferenceMeshTreeLayer : TreeLayer, mesh ? 'mesh' : 'native');
