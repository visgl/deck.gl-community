// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  OrbitView,
  type OrbitViewState
} from '@deck.gl/core';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {webgl2Adapter} from '@luma.gl/webgl';
import {
  TreeLayer,
  type TreeSpec,
  type TreeType
} from '../../modules/layers/src/tree-layer/tree-layer';
import {FieldLightingEffect} from './field-lighting';
import {FieldGroundLayer} from './field-ground-layer';

const params = new URLSearchParams(window.location.search);
const backend = params.get('backend') === 'webgpu' ? 'webgpu' : 'webgl';
const species: TreeType[] = [
  'citrus',
  'pine',
  'palm',
  'oak',
  'birch',
  'cherry',
  'banyan',
  'mangrove'
];
const mixed = params.get('field') === 'mixed';
const COUNT = 20_000;
const LOD_BIAS = 0;
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
    species: mixed ? species[index % species.length] : 'citrus',
    height: 3 * (1 + variation * 0.05),
    crownRadius: 2.25 * (1 + variation * 0.04),
    characteristics: SEEDS[mixed ? 0 : index % SEEDS.length]
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

const FOVY = 50;
const macro: OrbitViewState = {
  target: [0, -1.5, 1.6],
  zoom: Math.log2(window.innerHeight / (4 * Math.tan((FOVY * Math.PI) / 360))),
  rotationX: 42,
  rotationOrbit: 0
};

type Path = 'overview' | 'tree' | 'dive' | 'macro';

function getCamera(path: Path, phase: number): OrbitViewState {
  if (path === 'overview') return overview;
  if (path === 'tree') return tree;
  if (path === 'macro') return macro;
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
let lodCounts: Partial<Record<TreeType, number[]>> = {};
const errors: string[] = [];
const adapter = backend === 'webgpu' ? await navigator.gpu.requestAdapter() : null;
const adapterInfo = adapter?.info;
const lights = {
  ambient: new AmbientLight({color: [184, 209, 239], intensity: 1.2}),
  sun: new DirectionalLight({
    color: [255, 246, 221],
    intensity: 2,
    direction: [-1, -2, -3],
    _shadow: true
  })
};
const lighting = new FieldLightingEffect(lights);
lighting.shadowColor = [0, 0, 0, 0.42];

class FieldDeck extends Deck<OrbitView[]> {
  get trees(): TreeLayer<TreeSpec> | undefined {
    return this.layerManager?.getLayers().find(layer => layer.id === 'field') as
      | TreeLayer<TreeSpec>
      | undefined;
  }

  get backend() {
    return this.layerManager?.context.device.type;
  }
}

const deck = new FieldDeck({
  parent: document.querySelector<HTMLDivElement>('#scene')!,
  deviceProps: {type: backend, adapters: [webgl2Adapter, webgpuAdapter]},
  useDevicePixels: 1,
  views: [new OrbitView({id: 'orchard', orbitAxis: 'Z', fovy: FOVY})],
  viewState: {orchard: overview},
  effects: [lighting],
  layers: [
    new FieldGroundLayer<[number, number, number][]>({
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
      pickable: false,
      material: false
    }),
    new TreeLayer<TreeSpec>({
      id: 'field',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: trees,
      lodBias: LOD_BIAS,
      windStrength: 0.035
    })
  ],
  onError: error => errors.push(error.message),
  onBeforeRender({gl}) {
    if (!gl || !sampleGpu || !timer || measuredDraws % 4) return;
    activeQuery = gl.createQuery();
    if (activeQuery) gl.beginQuery(timer.TIME_ELAPSED_EXT, activeQuery);
  },
  onAfterRender({gl}) {
    window.treeFieldBench ??= {
      measure: (path, frames, warmup) => measure(gl, path, frames, warmup)
    };
    if (sampleGpu) {
      measuredDraws++;
      const tree = deck.trees;
      if (tree?.state.photoreal) {
        const totals: Partial<Record<TreeType, number[]>> = {};
        for (const group of tree.state.photoreal.groups.values()) {
          totals[group.species] ??= group.buckets.map(() => 0);
          const counts = totals[group.species];
          group.buckets.forEach((bucket, level) => {
            counts[level] += bucket.length;
          });
          lodCounts[group.species] ??= group.buckets.map(() => 0);
          const maxima = lodCounts[group.species];
          counts.forEach((count, level) => {
            maxima[level] = Math.max(maxima[level], count);
          });
        }
      }
    }
    if (!gl) return;
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

async function measure(
  gl: WebGL2RenderingContext | undefined,
  path: Path,
  frames: number,
  warmup: number
) {
  timer = gl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl
    ? gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
    : [adapterInfo?.vendor, adapterInfo?.architecture, adapterInfo?.description]
        .filter(Boolean)
        .join(' ');
  lodCounts = {};
  const frameMs: number[] = [];
  measuredDraws = 0;
  if (path === 'dive') {
    // Compile the same models and exercise all transitions before measuring a steady-state orbit.
    for (let index = 0; index <= warmup; index++) {
      deck.setProps({viewState: {orchard: getCamera(path, index / Math.max(warmup, 1))}});
      await getFrameTime();
    }
  }
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
  for (const query of pending.splice(0)) gl?.deleteQuery(query);
  const canvas = deck.getCanvas()!;
  return {
    renderer,
    backend: deck.backend,
    hardwareGpu: gl
      ? !/swiftshader|llvmpipe|software rasterizer/i.test(renderer)
      : Boolean(adapterInfo && !adapterInfo.isFallbackAdapter),
    lodCounts,
    canvas: [canvas.width, canvas.height],
    trees: trees.length,
    lodBias: LOD_BIAS,
    shadowFit: lighting.shadowDiagnostics,
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
