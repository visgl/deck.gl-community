// deck.gl-community
// SPDX-License-Identifier: MIT
import {Deck, OrbitView, COORDINATE_SYSTEM} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {SplatLayer, TreeLayer, type TreeSpec} from '../../src';

function mount(layers, view, initialViewState, layerFilter?) {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:256px;height:256px';
  document.body.append(parent);
  let pixels = new Uint8Array(),
    frames = 0;
  const errors: string[] = [];
  const deck = new Deck({
    parent,
    width: 256,
    height: 256,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: view,
    initialViewState,
    layers,
    layerFilter,
    _animate: true,
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  return {
    deck,
    errors,
    pixels: () => pixels,
    async settle() {
      const before = frames;
      await expect.poll(() => frames, {timeout: 30000}).toBeGreaterThan(before + 5);
    },
    cleanup() {
      deck.finalize();
      parent.remove();
    }
  };
}
it('composites interleaved prepared sources in depth order and reverses with the view', async () => {
  const source = (color: number[], depths: number[]) => ({
    positions: new Float32Array(depths.flatMap(z => [0, 0, z])),
    scales: new Float32Array(depths.flatMap(() => [1.5, 1.5, 0.01])),
    rotations: new Float32Array(depths.flatMap(() => [1, 0, 0, 0])),
    colors: new Uint8Array(depths.flatMap(() => [...color, 255])),
    opacities: new Float32Array(depths.map(() => 0.9))
  });
  const red = source([255, 0, 0], [0.1, -0.2]),
    blue = {
      ...source([0, 0, 255], [0, -0.3]),
      opticalDepths: new Float32Array([-Math.log(0.1), -Math.log(0.1)])
    };
  const assets = [red, blue].map(source => ({
    type: 'prepared-splats' as const,
    source,
    hierarchy: [{source, error: 0}]
  }));
  let reverse = false,
    order = false;
  const make = () => {
    const layers = assets.map(
      (data, i) =>
        new SplatLayer({
          id: `order-${i}`,
          data,
          kernelVariance: 0,
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          getPosition: [0, 0, 0],
          transparency: 'sorted',
          getScale: [1, 1, reverse ? -1 : 1],
          getTranslation: [0, 0, -1],
          material: {unlit: true}
        })
    );
    return order ? layers.reverse() : layers;
  };
  const viewState = {target: [0, 0, -1], zoom: 5, rotationX: 0, rotationOrbit: 0};
  const scene = mount(make(), new OrbitView({orbitAxis: 'Y', orthographic: true}), viewState);
  const center = () =>
    Array.from(scene.pixels().slice((128 * 256 + 128) * 4, (128 * 256 + 128) * 4 + 4));
  try {
    await scene.settle();
    expect(scene.errors).toEqual([]);
    expect(center()[0]).toBeGreaterThan(center()[2] * 4);
    expect(Math.abs(center()[0] - 232)).toBeLessThan(4);
    expect(Math.abs(center()[2] - 23)).toBeLessThan(4);
    order = true;
    scene.deck.setProps({layers: make()});
    await scene.settle();
    expect(center()[0]).toBeGreaterThan(center()[2] * 4);
    scene.deck.setProps({viewState: {...viewState, rotationOrbit: 180}});
    await scene.settle();
    expect(center()[2]).toBeGreaterThan(center()[0] * 4);
    expect(Math.abs(center()[2] - 232)).toBeLessThan(4);
    expect(Math.abs(center()[0] - 23)).toBeLessThan(4);
    reverse = true;
    scene.deck.setProps({layers: make(), viewState});
    await scene.settle();
    expect(center()[2]).toBeGreaterThan(center()[0] * 4);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
}, 60000);
class WoodOnlyTreeLayer extends TreeLayer<TreeSpec> {
  static layerName = 'WoodOnlyTreeLayer';
  filterSubLayer({layer}) {
    return !layer.id.includes('canopy');
  }
}
it('keeps the interior of the banyan bole solid during woody refinement', async () => {
  const rows: TreeSpec[] = [
    {species: 'banyan', position: [0, 0, 0], height: 12, crownRadius: 5, trunkRadius: 0.4}
  ];
  const scene = mount(
    [
      new WoodOnlyTreeLayer({
        id: 'solid-banyan',
        data: rows,
        getTree: row => row,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        windEnabled: false
      })
    ],
    new OrbitView({orbitAxis: 'Z', orthographic: true}),
    {target: [0, 0, 5], rotationX: 80, rotationOrbit: 0, zoom: 4},
    ({layer}) => !layer.id.includes('canopy')
  );
  try {
    await scene.settle();
    const wood = scene.deck
      .layerManager!.getLayers()
      .find(layer => layer.constructor.layerName === 'TreeWoodLayer')!;
    expect(wood.state.owners[0].weight).toBeGreaterThan(0);
    expect(wood.state.owners[0].weight).toBeLessThan(1);
    const blended = scene.pixels().slice();
    const fine = scene.deck.layerManager!.getLayers().find(layer => layer.id.endsWith('-near'))!;
    scene.deck.setProps({
      layers: [fine.clone({id: 'opaque-reference', getCoverageRange: [0, 1]})]
    });
    await scene.settle();
    let occupied = 0,
      total = 0;
    const reference = scene.pixels();
    for (let i = 0; i < 256 * 256; i++) {
      if (reference[i * 4 + 3] > 250) {
        total++;
        if (blended[i * 4 + 3] > 200) occupied++;
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(occupied / total).toBeGreaterThan(0.97);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
}, 60000);

it('updates optical fade weights without replacing the sorted geometry', async () => {
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1.5, 1.5, 0.01]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([40, 180, 80, 255]),
    opacities: new Float32Array([0.8])
  };
  const asset = {type: 'prepared-splats' as const, source, hierarchy: [{source, error: 0}]};
  let weight = 0.1;
  const make = () =>
    new SplatLayer({
      id: 'coverage-update',
      data: asset,
      transparency: 'sorted',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: [0, 0, -1],
      getCoverageWeight: () => weight,
      updateTriggers: {getCoverageWeight: weight},
      kernelVariance: 0,
      material: {unlit: true}
    });
  const scene = mount([make()], new OrbitView({orbitAxis: 'Y', orthographic: true}), {
    target: [0, 0, -1],
    rotationX: 0,
    rotationOrbit: 0,
    zoom: 5
  });
  const alpha = () => scene.pixels()[(128 * 256 + 128) * 4 + 3];
  try {
    await scene.settle();
    expect(scene.errors).toEqual([]);
    expect(alpha()).toBeGreaterThan(25);
    expect(alpha()).toBeLessThan(70);
    weight = 1;
    scene.deck.setProps({layers: [make()]});
    await scene.settle();
    expect(alpha()).toBeGreaterThan(195);
    weight = 0;
    scene.deck.setProps({layers: [make()]});
    await scene.settle();
    expect(alpha()).toBeLessThan(2);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
}, 60000);
