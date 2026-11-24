// luma.gl
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {luma, Buffer, Texture} from '@luma.gl/core';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {getTestDevice} from '@luma.gl/core/test-utils';
import {pointGlow, precipitation, sketchStroke} from '@luma.gl/shaders';
import {expect, test} from 'vitest';
import {
  FireflyLayer,
  SketchEdgeLayer,
  WaterSurfaceLayer,
  WeatherParticleLayer
} from '../../src/effect-layers/index';

test.for([
  'webgpu',
  'webgl'
] as const)('effects on %s animate, pick, reset styling and blend straight alpha', async (backend, context) => {
  if (!(await getTestDevice(backend))) return context.skip(`${backend} unavailable`);
  const size = 64;
  const parent = document.createElement('div');
  parent.style.width = `${size}px`;
  parent.style.height = `${size}px`;
  document.body.append(parent);
  const canvas = document.createElement('canvas');
  parent.append(canvas);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const device = await luma.createDevice({
    type: backend,
    adapters: [webgpuAdapter, webgl2Adapter],
    createCanvasContext: {canvas, width: size, height: size, useDevicePixels: false}
  });
  const points = device.createBuffer({data: new Float32Array([0, 0, 0, 0.4, 1, 0.1, 1, 0])});
  const texture = device.createTexture({
    width: size,
    height: size,
    format: 'rgba8unorm',
    usage: Texture.RENDER | Texture.COPY_SRC
  });
  const framebuffer = device.createFramebuffer({
    width: size,
    height: size,
    colorAttachments: [texture],
    depthStencilAttachment: 'depth24plus'
  });
  let time = 0;
  let frames = 0;
  const errors: string[] = [];
  const deck = new Deck({
    parent,
    device,
    width: size,
    height: size,
    useDevicePixels: false,
    _framebuffer: framebuffer,
    views: new MapView({id: 'main'}),
    initialViewState: {longitude: 0, latitude: 0, zoom: 17},
    layers: [
      new FireflyLayer({
        id: 'firefly-test',
        coordinateSystem: 'meter-offsets',
        coordinateOrigin: [0, 0, 0],
        points,
        pointCount: 1,
        pickable: true,
        radiusPixels: 5,
        time: () => time,
        animation: {enabled: 1, radius: 10, speed: 1, pulse: 0},
        style: {coreRadius: 0, haloIntensity: 2}
      })
    ],
    onAfterRender: () => frames++,
    onError: error => errors.push(error.message)
  });
  async function readFrame() {
    const previous = frames;
    const deadline = Date.now() + 10_000;
    do {
      deck.redraw('firefly test');
      await new Promise(resolve => requestAnimationFrame(resolve));
    } while (frames < previous + 2 && !errors.length && Date.now() < deadline);
    expect(errors).toEqual([]);
    expect(frames).toBeGreaterThan(previous);
    device.submit();
    const layout = texture.computeMemoryLayout();
    const output = device.createBuffer({
      byteLength: layout.byteLength,
      usage: Buffer.COPY_DST | Buffer.MAP_READ
    });
    try {
      texture.readBuffer({}, output);
      device.submit();
      return new Uint8Array(await output.readAsync()).slice();
    } finally {
      output.destroy();
    }
  }
  try {
    const first = await readFrame();
    const firefly = deck.props.layers[0] as FireflyLayer;
    expect(firefly.props.getPolygonOffset({layerIndex: 3})).toEqual([0, 0]);
    const layout = texture.computeMemoryLayout();
    let strongest = 0;
    let pickedColumn = 0;
    let pickedRow = 0;
    for (let row = 0; row < size; row++)
      for (let column = 0; column < size; column++) {
        const offset = row * layout.bytesPerRow + column * 4;
        if (first[offset + 1] > strongest) {
          strongest = first[offset + 1];
          pickedColumn = column;
          pickedRow = row;
        }
      }
    expect(strongest).toBeGreaterThan(50);
    const picked = await deck.pickObjectAsync({
      x: pickedColumn,
      y: backend === 'webgl' ? size - 1 - pickedRow : pickedRow,
      radius: 2
    });
    expect(picked?.index).toBe(0);
    time = 3;
    const second = await readFrame();
    expect(second.some((value, index) => Math.abs(value - first[index]) > 30)).toBe(true);
    const paused = await readFrame();
    expect(paused).toEqual(second);
    const layer = deck
      .layerManager!.getLayers()
      .find((candidate): candidate is FireflyLayer => candidate instanceof FireflyLayer)!;
    expect(layer.state.model.shaderInputs.getUniformValues().pointGlow?.haloIntensity).toBe(2);
    const replacement = layer.clone({style: {}}) as FireflyLayer;
    deck.setProps({layers: [replacement]});
    await readFrame();
    expect(replacement.state.model.shaderInputs.getUniformValues().pointGlow?.haloIntensity).toBe(
      pointGlow.defaultUniforms?.haloIntensity
    );
    const corners = replacement.state.corners;
    const segments = device.createBuffer({
      data: new Float32Array([-10, 0, 0, 10, 0, 0, 0, 42, -10, 0, 0, 10, 0, 0, 1, 17])
    });
    const waterPositions = device.createBuffer({
      data: new Float32Array([-20, -20, 0, 20, -20, 0, 0, 20, 0])
    });
    try {
      const sketch = new SketchEdgeLayer({
        id: 'sketch-test',
        coordinateOrigin: [0, 0, 0],
        segments,
        segmentCount: 0,
        pickable: true,
        style: {width: 4, sketch: 0},
        color: [255, 0, 0, 255]
      });
      deck.setProps({layers: [sketch]});
      const redPeak = (pixels: Uint8Array) =>
        pixels.reduce((peak, value, index) => (index % 4 === 0 ? Math.max(peak, value) : peak), 0);
      expect(redPeak(await readFrame())).toBe(0);
      const opaqueSketch = sketch.clone({segmentCount: 1}) as SketchEdgeLayer;
      deck.setProps({layers: [opaqueSketch]});
      const opaque = await readFrame();
      const faintSketch = opaqueSketch.clone({opacity: 0.25}) as SketchEdgeLayer;
      deck.setProps({layers: [faintSketch]});
      const translucent = await readFrame();
      expect(redPeak(opaque)).toBeGreaterThan(200);
      expect(redPeak(translucent)).toBeGreaterThan(25);
      expect(redPeak(translucent)).toBeLessThan(100);
      expect((await deck.pickObjectAsync({x: 32, y: 32, radius: 2}))?.index).toBe(0);
      const centerOffset = 32 * layout.bytesPerRow + 32 * 4;
      const highlighted = faintSketch.clone({
        highlightedObjectIndex: 0,
        highlightColor: [0, 255, 0, 255]
      });
      deck.setProps({layers: [highlighted]});
      const highlightedPixel = (await readFrame()).slice(centerOffset, centerOffset + 4);
      expect(highlightedPixel[1]).toBeGreaterThan(25);
      expect(highlightedPixel[0]).toBeLessThan(8);
      deck.setProps({layers: [faintSketch.clone({highlightedObjectIndex: null})]});
      segments.write(new Float32Array([-10, 0, 0, 10, 0, 0, -1, 42]));
      await readFrame();
      expect(await deck.pickObjectAsync({x: 32, y: 32, radius: 2})).toBeNull();
      expect(faintSketch.state.model.shaderInputs.getUniformValues().sketchStroke?.width).toBe(4);
      const multiple = faintSketch.clone({segmentCount: 2, style: {}}) as SketchEdgeLayer;
      deck.setProps({layers: [multiple]});
      await readFrame();
      expect((await deck.pickObjectAsync({x: 32, y: 32, radius: 2}))?.index).toBe(1);
      expect(multiple.state.model.shaderInputs.getUniformValues().sketchStroke?.width).toBe(
        sketchStroke.defaultUniforms.width
      );
      const water = new WaterSurfaceLayer({
        id: 'water-test',
        coordinateOrigin: [0, 0, 0],
        positions: waterPositions,
        vertexCount: 3
      });
      deck.setProps({layers: [water]});
      const opaqueWater = (await readFrame()).slice(centerOffset, centerOffset + 4);
      const translucentWater = water.clone({material: {opacity: 0.25}});
      deck.setProps({layers: [translucentWater]});
      const fadedWater = (await readFrame()).slice(centerOffset, centerOffset + 4);
      expect(opaqueWater[3]).toBe(255);
      expect(fadedWater[3]).toBeCloseTo(64, -1);
      expect(Math.max(...opaqueWater.slice(0, 3))).toBeGreaterThan(30);
      expect(Math.max(...fadedWater.slice(0, 3))).toBeLessThan(
        Math.max(...opaqueWater.slice(0, 3)) / 2
      );
      const weather = new WeatherParticleLayer({
        id: 'weather-test',
        coordinateOrigin: [0, 0, 0],
        particleCount: 1,
        precipitation: {fallSpeed: 5, wind: [12, 1]}
      });
      deck.setProps({layers: [weather]});
      await readFrame();
      expect(weather.state.model.shaderInputs.getUniformValues().precipitation).toMatchObject({
        fallSpeed: 5,
        wind: [12, 1]
      });
      const defaultWeather = weather.clone({precipitation: {}}) as WeatherParticleLayer;
      deck.setProps({layers: [defaultWeather]});
      await readFrame();
      expect(
        defaultWeather.state.model.shaderInputs.getUniformValues().precipitation
      ).toMatchObject({
        fallSpeed: precipitation.defaultUniforms.fallSpeed,
        wind: precipitation.defaultUniforms.wind
      });
      const snow = weather.clone({
        weather: 'snow',
        particleCount: 32,
        widthPixels: 4,
        streakLength: 1,
        precipitation: {volumeCenter: [0, 0, 20], volumeSize: [40, 40, 1], wind: [0, 0]}
      });
      deck.setProps({layers: [snow]});
      const flakes = await readFrame();
      expect(flakes.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      // Rain's tail would project above the camera, but a snow sprite has no tail.
      deck.setProps({layers: [snow.clone({streakLength: 100_000})]});
      expect(await readFrame()).toEqual(flakes);
      expect(corners.destroyed).toBe(true);
      expect(points.destroyed).toBe(false);
    } finally {
      deck.finalize();
      segments.destroy();
      waterPositions.destroy();
    }
  } finally {
    deck.finalize();
    framebuffer.destroy();
    texture.destroy();
    points.destroy();
    device.destroy();
    parent.remove();
  }
});
