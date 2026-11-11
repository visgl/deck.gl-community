// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  OrbitView,
  type OrbitViewState
} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {TreeLayer, type TreeSpec} from '../../modules/layers/src/tree-layer/tree-layer';

const COUNT = 20_000;
const CANOPY_BUDGET = 1_000_000;
const COLUMNS = 177;
const ROWS = Math.ceil(COUNT / COLUMNS);
const SEEDS = Array.from({length: 4}, (_, seed) => ({seed: seed + 1}));
const trees: TreeSpec[] = Array.from({length: COUNT}, (_, index) => {
  const variation = Math.sin(index * 12.9898 + 78.233);
  return {
    position: [
      ((index % COLUMNS) - (COLUMNS - 1) / 2) * 4.5,
      (Math.floor(index / COLUMNS) - (ROWS - 1) / 2) * 7,
      0
    ],
    species: 'citrus',
    height: 3 * (1 + variation * 0.05),
    crownRadius: 2.25 * (1 + variation * 0.04),
    characteristics: SEEDS[index % SEEDS.length]
  };
});

const overview: OrbitViewState = {
  target: [0, 0, 0],
  zoom: Math.log2(window.innerHeight / 1400),
  rotationX: 35,
  rotationOrbit: -18
};
const tree: OrbitViewState = {
  target: [0, 0, 1.8],
  zoom: Math.log2(110),
  rotationX: 15,
  rotationOrbit: 0
};

type Path = 'overview' | 'tree' | 'dive';

function getCamera(path: Path, phase: number): OrbitViewState {
  if (path === 'overview') return overview;
  if (path === 'tree') return tree;
  // Travel down and back on the same path, including both endpoints in the measured run.
  const t = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  return {
    target: [0, 0, 1.8 * t],
    zoom: overview.zoom + (tree.zoom - overview.zoom) * t,
    rotationX: 35 - 20 * t,
    rotationOrbit: -18 + 18 * t
  };
}

type Timer = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

const pending: WebGLQuery[] = [];
const gpuMs: number[] = [];
let timer: Timer | null = null;
let activeQuery: WebGLQuery | null = null;
let sampleGpu = false;
let measuredDraws = 0;
const errors: string[] = [];
const deck = new Deck({
  parent: document.querySelector<HTMLDivElement>('#scene')!,
  deviceProps: {adapters: [webgl2Adapter]},
  useDevicePixels: 1,
  views: [new OrbitView({id: 'orchard', orbitAxis: 'Z'})],
  viewState: {orchard: overview},
  effects: [
    new LightingEffect({
      ambient: new AmbientLight({color: [184, 209, 239], intensity: 1.2}),
      sun: new DirectionalLight({
        color: [255, 246, 221],
        intensity: 2,
        direction: [-1, -2, -3],
        _shadow: true
      })
    })
  ],
  layers: [
    new SolidPolygonLayer({
      id: 'ground',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        [
          [-600, -600, -0.04],
          [600, -600, -0.04],
          [600, 600, -0.04],
          [-600, 600, -0.04]
        ]
      ],
      getPolygon: polygon => polygon,
      getFillColor: [115, 108, 79],
      shadowEnabled: false,
      material: false
    }),
    new TreeLayer<TreeSpec>({
      id: 'field',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: trees,
      maxCanopySplats: CANOPY_BUDGET,
      windStrength: 0.035
    })
  ],
  onError: error => errors.push(error.message),
  onBeforeRender({gl}) {
    if (!sampleGpu || !timer || measuredDraws % 4) return;
    activeQuery = gl.createQuery();
    if (activeQuery) gl.beginQuery(timer.TIME_ELAPSED_EXT, activeQuery);
  },
  onAfterRender({gl}) {
    window.treeFieldBench ??= {
      measure: (path, frames, warmup) => measure(gl, path, frames, warmup)
    };
    if (sampleGpu) measuredDraws++;
    if (activeQuery && timer) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pending.push(activeQuery);
      activeQuery = null;
    }
    if (!timer || !pending.length) return;
    if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
      for (const query of pending.splice(0)) gl.deleteQuery(query);
      return;
    }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift()!;
      gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
  }
});

function getFrameTime(): Promise<number> {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function measure(gl: WebGL2RenderingContext, path: Path, frames: number, warmup: number) {
  timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  const frameMs: number[] = [];
  measuredDraws = 0;
  let previous = await getFrameTime();
  for (let index = -warmup; index < frames; index++) {
    deck.setProps({viewState: {orchard: getCamera(path, Math.max(0, index) / (frames - 1))}});
    sampleGpu = index >= 0;
    const next = await getFrameTime();
    if (sampleGpu) frameMs.push(next - previous);
    previous = next;
  }
  sampleGpu = false;
  // Leave time for the asynchronous query results without stalling the measured frames.
  for (let index = 0; index < 12 && pending.length; index++) await getFrameTime();
  for (const query of pending.splice(0)) gl.deleteQuery(query);
  return {
    renderer,
    canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    trees: trees.length,
    maxCanopySplats: CANOPY_BUDGET,
    draws: measuredDraws,
    frameMs,
    gpuMs: gpuMs.splice(0),
    errors
  };
}

declare global {
  interface Window {
    treeFieldBench?: {
      measure: (path: Path, frames: number, warmup: number) => ReturnType<typeof measure>;
    };
  }
}
