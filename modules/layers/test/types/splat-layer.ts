import {SplatLayer} from '@deck.gl-community/layers';
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
