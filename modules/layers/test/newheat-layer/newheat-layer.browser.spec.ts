// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it} from 'vitest';
import {COORDINATE_SYSTEM, Deck, OrbitView, type Layer} from '@deck.gl/core';
import {
  _TerrainExtension as TerrainExtension,
  type TerrainExtensionProps
} from '@deck.gl/extensions';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {Geometry} from '@luma.gl/engine';
import type {NewHeatLayerProps} from '../../src/index';
import {NewHeatLayer} from '../../src/index';

const SIZE = 256;
const DATA = [
  {
    path: [
      [-100, 0],
      [100, 0]
    ],
    timestamps: [0, 100]
  }
];
let deck: Deck | undefined;
let container: HTMLDivElement | undefined;

// Isolate the real particle shader so the volume cannot satisfy the assertions.
class EmberTestLayer extends NewHeatLayer {
  static layerName = 'EmberTestLayer';

  getShaders() {
    const shaders = super.getShaders();
    shaders.inject['fs:DECKGL_FILTER_COLOR'] += '\nif (vFlame.z < 1.5) discard;';
    return shaders;
  }
}

afterEach(() => {
  deck?.finalize();
  container?.remove();
  deck = undefined;
});

function renderFrame(
  props: Partial<NewHeatLayerProps & TerrainExtensionProps> = {},
  sideView: boolean | number = false,
  rotationOrbit = 0,
  embersOnly = false,
  terrain?: Layer
): Promise<Uint8Array> {
  const LayerClass = embersOnly ? EmberTestLayer : NewHeatLayer;
  const layer = new LayerClass({
    id: `fire-${props.terrainDrawMode ?? 'xyz'}-${embersOnly ? 'embers' : 'volume'}`,
    data: DATA,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPath: d => d.path,
    getTimestamps: d => d.timestamps,
    currentTime: 100,
    trailLength: 100,
    widthUnits: 'pixels',
    getWidth: 60,
    pickable: true,
    ...props
  });
  return new Promise((resolve, reject) => {
    let renderedFrames = 0;
    const onAfterRender = ({gl}: {gl: WebGL2RenderingContext}) => {
      // TerrainEffect registers a default shader module, which rebuilds the
      // source model on the next update before its height map is valid.
      if (terrain && renderedFrames++ < 2) return;
      const pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      resolve(pixels);
    };
    if (deck) {
      deck.setProps({layers: [terrain, layer], onAfterRender, onError: reject});
    } else {
      container = document.createElement('div');
      document.body.appendChild(container);
      deck = new Deck({
        parent: container,
        width: SIZE,
        height: SIZE,
        useDevicePixels: false,
        _animate: true,
        views: new OrbitView({orbitAxis: 'Z', orthographic: true}),
        initialViewState: {
          target: [0, 0, 0],
          zoom: 0,
          rotationX: typeof sideView === 'number' ? sideView : sideView ? 0 : 90,
          rotationOrbit
        },
        layers: [terrain, layer],
        onAfterRender,
        onError: reject
      });
    }
  });
}

function brightness(pixels: Uint8Array, x: number, y = SIZE / 2): number {
  const index = (y * SIZE + x) * 4;
  return pixels[index] + pixels[index + 1] + pixels[index + 2];
}

function totalBrightness(pixels: Uint8Array): number {
  return pixels.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0);
}

function createTerrain(height: (x: number, y: number) => number, draw = false) {
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = 20;
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const x = -150 + col * 15;
      const y = -150 + row * 15;
      positions.push(x, y, height(x, y));
      if (row < segments && col < segments) {
        const vertex = row * (segments + 1) + col;
        indices.push(
          vertex,
          vertex + 1,
          vertex + segments + 1,
          vertex + 1,
          vertex + segments + 2,
          vertex + segments + 1
        );
      }
    }
  }
  return new SimpleMeshLayer({
    id: 'terrain',
    data: [{}],
    mesh: new Geometry({
      topology: 'triangle-list',
      indices: new Uint16Array(indices),
      attributes: {positions: {size: 3, value: new Float32Array(positions)}}
    }),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    _instanced: false,
    getPosition: [0, 0, 0],
    getColor: [0, 0, 0],
    material: false,
    operation: draw ? 'terrain+draw' : 'terrain',
    parameters: {depthWriteEnabled: true, cullMode: 'none'}
  });
}

describe('NewHeatLayer WebGL rendering', () => {
  it('fits the full flame and its embers to GPU terrain heights', async () => {
    const height = (x: number) => 40 + x * 0.15;
    const props = {currentTime: 180, fadeTrail: false, getWidth: 20};
    const extensions = [new TerrainExtension()];
    const elevatedData = [{...DATA[0], path: DATA[0].path.map(([x, y]) => [x, y, height(x)])}];
    for (const embersOnly of [false, true]) {
      const reference = await renderFrame({...props, data: elevatedData}, 35, 0, embersOnly);
      const fitted = await renderFrame(
        {...props, extensions, terrainDrawMode: 'offset'},
        35,
        0,
        embersOnly,
        createTerrain(height)
      );
      expect(totalBrightness(reference)).toBeGreaterThan(50);
      let difference = 0;
      for (let i = 0; i < fitted.length; i++) {
        if (i % 4 !== 3) difference += Math.abs(fitted[i] - reference[i]);
      }
      // GPU sampling agrees with the same surface supplied as explicit XYZ.
      expect(difference / totalBrightness(reference)).toBeLessThan(0.06);
    }
  });

  it('lets foreground terrain occlude the flame', async () => {
    const height = (_x: number, y: number) => 20 + 80 * Math.exp(-(((Math.abs(y) - 45) / 20) ** 2));
    const props = {
      currentTime: 100,
      fadeTrail: false,
      getWidth: 20,
      extensions: [new TerrainExtension()],
      terrainDrawMode: 'offset' as const
    };
    const unobstructed = await renderFrame(props, 25, 0, false, createTerrain(height));
    const occluded = await renderFrame(props, 25, 0, false, createTerrain(height, true));
    expect(totalBrightness(unobstructed)).toBeGreaterThan(1000);
    expect(totalBrightness(occluded)).toBeLessThan(totalBrightness(unobstructed) * 0.5);
  });

  it('keeps a continuous flame when a path is subdivided into short segments', async () => {
    const createPath = (segments: number) => [
      {
        path: Array.from({length: segments + 1}, (_, i) => {
          const x = -100 + (i * 200) / segments;
          return [x, x * x * 0.002];
        }),
        timestamps: Array.from({length: segments + 1}, (_, i) => (i * 2) / segments)
      }
    ];
    // No timestamp bin reaches an ember emission. Only the volume is compared.
    const props = {currentTime: 2, fadeTrail: false, getWidth: 35};
    const coarse = await renderFrame({...props, data: createPath(40)}, 20, 25);
    const dense = await renderFrame({...props, data: createPath(200)}, 20, 25);
    let difference = 0;
    let samples = 0;
    for (let i = 0; i < coarse.length; i += 4) {
      if (coarse[i] + dense[i] < 10) continue;
      for (let c = 0; c < 3; c++) difference += Math.abs(coarse[i + c] - dense[i + c]);
      samples += 3;
    }
    expect(samples).toBeGreaterThan(1000);
    expect(difference / samples).toBeLessThan(3);
  });

  it('renders sparse, warm embers that stay near the plume', async () => {
    const pixels = await renderFrame(
      {currentTime: 180, fadeTrail: false, getWidth: 20},
      true,
      0,
      true
    );
    let emberPixels = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (brightness(pixels, x, y) <= 10) continue;
        emberPixels++;
        // Small airborne flecks within 2.75 path widths of the ground.
        expect(y).toBeGreaterThan(140);
        expect(y).toBeLessThan(184);
        const offset = (y * SIZE + x) * 4;
        expect(pixels[offset]).toBeGreaterThan(pixels[offset + 1] * 1.5);
      }
    }
    expect(emberPixels).toBeGreaterThan(0);
    expect(emberPixels).toBeLessThan(40);
    const later = await renderFrame(
      {currentTime: 190, fadeTrail: false, getWidth: 20},
      true,
      0,
      true
    );
    expect(later).not.toEqual(pixels);
  });

  it('renders above the ground plane when viewed from the side', async () => {
    const pixels = await renderFrame({currentTime: 95, fadeTrail: false}, true);
    // In this view the path itself is edge-on at y=128. Pixels above it prove
    // the flame occupies world-space height rather than a ground-plane ribbon.
    let raisedPixels = 0;
    for (let y = 150; y < 215; y++) {
      for (let x = 30; x < 220; x++) {
        if (brightness(pixels, x, y) > 25) raisedPixels++;
      }
    }
    expect(raisedPixels).toBeGreaterThan(100);
  });

  it('does not raise sentinel segments between disconnected paths', async () => {
    const pixels = await renderFrame(
      {
        data: [
          {
            path: [
              [-110, 0],
              [-40, 0]
            ],
            timestamps: [0, 100]
          },
          {
            path: [
              [40, 0],
              [110, 0]
            ],
            timestamps: [0, 100]
          }
        ],
        currentTime: 150,
        fadeTrail: false
      },
      true
    );
    expect(totalBrightness(pixels)).toBeGreaterThan(1000);
    for (let y = 135; y < 245; y++) expect(brightness(pixels, 128, y)).toBe(0);
  });

  it('compiles, renders varying colors, respects the time window, and preserves picking', async () => {
    const pixels = await renderFrame({currentTime: 75, trailLength: 50});
    expect(brightness(pixels, 38)).toBe(0); // timestamp 5: expired
    expect(brightness(pixels, 218)).toBe(0); // timestamp 95: future
    expect(brightness(pixels, 138)).toBeGreaterThan(20); // timestamp 55: burning
    const colors = new Set<string>();
    for (let x = 90; x < 165; x++)
      colors.add(String(pixels.slice((128 * SIZE + x) * 4, (128 * SIZE + x) * 4 + 3)));
    expect(colors.size).toBeGreaterThan(20);
    expect(deck!.pickObject({x: 138, y: 128})?.object).toBe(DATA[0]);
    expect(deck!.pickObject({x: 218, y: 128})).toBeNull();
  });

  it('animates deterministically and ignores trailLength when fadeTrail is false', async () => {
    const first = await renderFrame({currentTime: 150, fadeTrail: false, trailLength: 10});
    const repeat = await renderFrame({currentTime: 150, fadeTrail: false, trailLength: 900});
    expect(repeat).toEqual(first);
    const next = await renderFrame({currentTime: 160, fadeTrail: false});
    expect(next).not.toEqual(first);
    expect(brightness(first, 38)).toBeGreaterThan(20);
  });

  it('handles zero-length trails, tint, accessor alpha, and layer opacity', async () => {
    const empty = await renderFrame({trailLength: 0});
    expect(totalBrightness(empty)).toBe(0);
    const full = await renderFrame({fadeTrail: false});
    const translucent = await renderFrame({fadeTrail: false, opacity: 0.3});
    expect(totalBrightness(translucent)).toBeLessThan(totalBrightness(full) * 0.8);
    expect(totalBrightness(translucent)).toBeGreaterThan(0);
    const transparent = await renderFrame({fadeTrail: false, getColor: [255, 255, 255, 0]});
    expect(totalBrightness(transparent)).toBe(0);
    const red = await renderFrame({fadeTrail: false, getColor: [255, 0, 0]});
    expect(totalBrightness(red)).toBeGreaterThan(0);
    expect(red.every((value, index) => index % 4 === 0 || index % 4 === 3 || value === 0)).toBe(
      true
    );
  });
});
