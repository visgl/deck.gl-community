import {SplatLayer, type PreparedSplatData, type SplatSource} from '@deck.gl-community/layers';
const data = [{position: [0, 0] as [number, number]}];
const source: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([1])
};
const asset: PreparedSplatData = {type: 'prepared-splats', source};
new SplatLayer({
  data,
  getSource: {type: 'prepared-splats', source, hierarchy: [{source, error: 0}]}
});
// @ts-expect-error Assets come from data or getSource; SplatLayer has no layer-wide source.
new SplatLayer({data, source});
// @ts-expect-error Hierarchies travel inside a prepared-splats descriptor.
new SplatLayer({data, getSource: source, hierarchy: [{source, error: 0}]});
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
// A splat file is data: a URL or its bytes. RAD is recognized, and refused, from the bytes at runtime.
new SplatLayer({data: '/captures/row.spz', getPosition: [0, 0, 0]});
new SplatLayer({data: new ArrayBuffer(32), maxSplats: 100_000});
new SplatLayer({
  data: [{splats: '/trees/orange.spz', position: [0, 0] as [number, number]}],
  getSource: row => row.splats
});
// @ts-expect-error A number is neither splat data nor instance rows.
new SplatLayer({data: 42});
