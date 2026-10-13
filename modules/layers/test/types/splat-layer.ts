import {SplatLayer, type PreparedSplatData, type SplatSource} from '@deck.gl-community/layers';
const data = [{position: [0, 0] as [number, number]}];
new SplatLayer({
  data,
  source: {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([30, 120, 40, 255]),
    opacities: new Float32Array([1])
  }
});

const source: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([1])
};
const asset: PreparedSplatData = {type: 'prepared-splats', source};
new SplatLayer({data: source, getPosition: [0, 0, 0]});
new SplatLayer({data: asset, getPosition: instance => instance.position});
new SplatLayer({data, getSource: asset, getPosition: row => row.position});
new SplatLayer({
  data: [{splats: source, position: [0, 0] as [number, number]}],
  getSource: row => row.splats
});
new SplatLayer({
  data,
  getSource: source,
  getTransformMatrix: () => [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 1, 2, 3, 1],
  maxTotalSplats: 1000
});
new SplatLayer({data: '/scene.rad'});
new SplatLayer({data: '/scene.rad', maxActiveSplats: 1_000_000});

new SplatLayer({data: {type: 'rad', url: new Blob()}, coordinateSystem: 'cartesian'});
new SplatLayer({data: {type: 'splats', url: new Blob(), format: 'spz'}, transparency: 'sorted'});
// @ts-expect-error The scene format discriminant is explicit.
new SplatLayer({data: {type: 'splats', url: '/scene.splat', format: 'unknown'}});
