// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  OrbitView
} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {TreeLayer, type CropConfig, type TreeSpec, type TreeType} from '@deck.gl-community/layers';
import {CubeGeometry} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';

/** Everything a lab view can be asked for, in the units of its URL parameters. */
type LabParams = {
  species: TreeType;
  growth: number;
  health: number;
  foliage: number;
  flush: number;
  /** Lean angle in degrees, and the bearing it tips toward. */
  leanAngle: number;
  leanBearing: number;
  damage: number;
  decay: number;
  /** Trees in a planted block of rows. */
  count: number;
  /** Fruit per tree, how ripe, and the fraction fallen. Needs the crop layer. */
  fruit: number;
  ripeness: number;
  fruitFall: number;
  /** Blossoms per tree, and the fraction of their petals fallen. Needs the crop layer. */
  blossoms: number;
  petalFall: number;
  /** Sun elevation and compass bearing in degrees, where the sun is in the sky. */
  sun: number;
  sunBearing: number;
  sunIntensity: number;
  ambient: number;
  /** Wind strength and the bearing it blows toward. */
  wind: number;
  windBearing: number;
  /** Clock in seconds: fixed for a repeatable frame, or -1 to follow the timeline. */
  time: number;
  /**
   * Gust clock in seconds, `TreeLayer.windGustTime`, or -1 to run gust fronts on `time`. With `time` held, it moves
   * a front onto a tree or off it while everything else stands still, as in `?time=10&gustTime=26.821`.
   */
  gustTime: number;
  seed: number;
  /** Mature height and crown radius in metres. */
  height: number;
  crown: number;
  /** Camera: metres from the target, orbit around it, degrees above the horizon. */
  distance: number;
  orbit: number;
  pitch: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  fov: number;
  /** Far plane in metres from the camera, or 0 for one that suits the distance. */
  far: number;
  /** 0 removes the ground, and 0 stops shadows. 1 hangs a slab in the sun, to shade the trees. */
  ground: number;
  shadow: number;
  /** 0 keeps the trees out of the shadow map, while they still read it. */
  cast: number;
  occluder: number;
  lodBias: number;
  dpr: number;
  /** Rain and rime on the trees, 0-1. */
  wetness: number;
  frost: number;
  /** Fog per metre, 0 for none, and its sRGB color as 'r,g,b'. */
  fogDensity: number;
  fogColor: string;
};

const DEFAULTS: LabParams = {
  species: 'citrus',
  growth: 1,
  health: 1,
  foliage: 1,
  flush: 0,
  leanAngle: 0,
  leanBearing: 90,
  damage: 0,
  decay: 0,
  count: 1,
  fruit: 0,
  ripeness: 1,
  fruitFall: 0,
  blossoms: 0,
  petalFall: 0,
  sun: 52,
  sunBearing: 135,
  sunIntensity: 2.1,
  ambient: 0.85,
  wind: 0,
  windBearing: 80,
  time: 10,
  gustTime: -1,
  seed: 1,
  height: 7,
  crown: 3.4,
  distance: 16,
  orbit: 20,
  pitch: 10,
  targetX: 0,
  targetY: 0,
  targetZ: 3.2,
  fov: 34,
  far: 0,
  ground: 1,
  shadow: 1,
  cast: 1,
  occluder: 0,
  lodBias: 0,
  dpr: 1,
  wetness: 0,
  frost: 0,
  fogDensity: 0,
  fogColor: '205,216,226'
};

function readParams(search: string): Partial<LabParams> {
  const params: Record<string, unknown> = {};
  new URLSearchParams(search).forEach((text, key) => {
    params[key] = Number.isFinite(Number(text)) && text !== '' ? Number(text) : text;
  });
  return params as Partial<LabParams>;
}

/** Tiled, speckled sandy soil, so shadows and scale can be read off the ground. */
function createSoilTexture(): HTMLCanvasElement {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = context.createImageData(size, size);
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const coarse = new Float32Array(16 * 16).map(() => random());
  const smooth = (x: number, y: number) => {
    const fx = x / 64;
    const fy = y / 64;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const sx = fx - ix;
    const sy = fy - iy;
    const at = (a: number, b: number) => coarse[((b & 15) << 4) + (a & 15)];
    const ux = sx * sx * (3 - 2 * sx);
    const uy = sy * sy * (3 - 2 * sy);
    return (
      (at(ix, iy) * (1 - ux) + at(ix + 1, iy) * ux) * (1 - uy) +
      (at(ix, iy + 1) * (1 - ux) + at(ix + 1, iy + 1) * ux) * uy
    );
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = smooth(x, y);
      const grain = random();
      const level = 0.72 + 0.14 * cell + 0.14 * grain * grain;
      const offset = (y * size + x) * 4;
      image.data[offset] = 196 * level;
      image.data[offset + 1] = 176 * level;
      image.data[offset + 2] = 142 * level;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function createGroundMesh(extent: number, repeats: number) {
  return {
    attributes: {
      POSITION: {
        size: 3,
        value: new Float32Array([
          -extent,
          -extent,
          0,
          extent,
          -extent,
          0,
          extent,
          extent,
          0,
          -extent,
          extent,
          0
        ])
      },
      NORMAL: {size: 3, value: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])},
      TEXCOORD_0: {
        size: 2,
        value: new Float32Array([0, 0, repeats, 0, repeats, repeats, 0, repeats])
      }
    },
    indices: {size: 1, value: new Uint16Array([0, 1, 2, 0, 2, 3])}
  };
}

const GROUND_MESH = createGroundMesh(600, 300);
const BOX = new CubeGeometry();
const SOIL_TEXTURE = createSoilTexture();

/** Rows 7.6 m apart with 4.6 m in-row spacing, a little off the grid, centered on the origin. */
function createTrees(params: LabParams): {position: [number, number, number]; variety: number}[] {
  if (params.count <= 1) return [{position: [0, 0, 0], variety: 0}];
  const columns = Math.ceil(Math.sqrt(params.count));
  const rows: {position: [number, number, number]; variety: number}[] = [];
  let seed = 11;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < params.count; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    rows.push({
      position: [
        (column - (columns - 1) / 2) * 7.6 + (random() - 0.5) * 0.5,
        (row - (columns - 1) / 2) * 4.6 + (random() - 0.5) * 0.5,
        0
      ],
      variety: Math.floor(random() * 6)
    });
  }
  return rows;
}

function getLighting(params: LabParams): LightingEffect {
  const elevation = (params.sun * Math.PI) / 180;
  const bearing = (params.sunBearing * Math.PI) / 180;
  const low = Math.max(0, Math.min(1, 1 - params.sun / 35));
  const effect = new LightingEffect({
    ambient: new AmbientLight({
      color: [200 + 26 * low, 216 + 2 * low, 255 - 30 * low],
      intensity: params.ambient
    }),
    sun: new DirectionalLight({
      color: [255, 246 - 70 * low, 230 - 130 * low],
      intensity: params.sunIntensity,
      direction: [
        -Math.sin(bearing) * Math.cos(elevation),
        -Math.cos(bearing) * Math.cos(elevation),
        -Math.sin(elevation)
      ],
      _shadow: params.shadow > 0
    })
  });
  effect.shadowColor = [0.05, 0.07, 0.12, 0.66];
  return effect;
}

const parent = document.getElementById('app') as HTMLDivElement;
const startParams: LabParams = {...DEFAULTS, ...readParams(window.location.search)};

let params: LabParams = startParams;
let trees = createTrees(params);
let treesKey = '';
let frame = 0;
let effect = getLighting(params);
let effectKey = '';
let framesDrawn = 0;
const frameWaiters: {after: number; resolve: () => void}[] = [];
let captureWaiter: ((url: string) => void) | null = null;
let measuring: {times: number[]; frames: number; resolve: (times: number[]) => void} | null = null;
const errors: string[] = [];
let labGl: WebGL2RenderingContext | null = null;

function getViewState(lab: LabParams, height: number) {
  const fov = (lab.fov * Math.PI) / 180;
  const zoom = Math.log2((0.5 / Math.tan(fov / 2)) * (height / lab.distance));
  return {
    target: [lab.targetX, lab.targetY, lab.targetZ] as [number, number, number],
    rotationOrbit: lab.orbit,
    rotationX: lab.pitch,
    zoom,
    minZoom: -20,
    maxZoom: 40
  };
}

function getView(lab: LabParams) {
  // The shadow map covers the view frustum, so a tight far plane is what makes shadows crisp.
  return new OrbitView({
    id: 'lab',
    orbitAxis: 'Z',
    fovy: lab.fov,
    near: 0.02,
    far:
      ((lab.far || Math.max(lab.distance * 3.5, 16)) *
        (0.5 / Math.tan((lab.fov * Math.PI) / 360))) /
      lab.distance
  } as ConstructorParameters<typeof OrbitView>[0]);
}

const deck = new Deck({
  parent,
  width: '100%',
  height: '100%',
  useDevicePixels: startParams.dpr,
  deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
  views: getView(startParams),
  viewState: getViewState(startParams, window.innerHeight),
  effects: [effect],
  layers: [],
  _animate: true,
  onError: error => {
    errors.push(error.message);
    console.error(error); // eslint-disable-line no-console
  },
  onAfterRender({gl}) {
    labGl = gl;
    framesDrawn++;
    if (measuring) {
      // Reading a pixel waits for the GPU, so the time between frames is the real cost of a frame.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      measuring.times.push(performance.now());
      if (measuring.times.length >= measuring.frames) {
        const done = measuring;
        measuring = null;
        done.resolve(done.times);
      }
    }
    if (captureWaiter) {
      const resolve = captureWaiter;
      captureWaiter = null;
      const canvas = gl.canvas as HTMLCanvasElement;
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const context = out.getContext('2d') as CanvasRenderingContext2D;
      const sky = context.createLinearGradient(0, 0, 0, out.height);
      sky.addColorStop(0, '#7da7d6');
      sky.addColorStop(0.62, '#cfe1ef');
      sky.addColorStop(1, '#e9e3d3');
      context.fillStyle = sky;
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(canvas, 0, 0);
      resolve(out.toDataURL('image/png'));
    }
    if (framesDrawn >= (frameWaiters[0]?.after ?? Infinity)) {
      gl.finish();
      while (frameWaiters.length && framesDrawn >= frameWaiters[0].after)
        frameWaiters.shift()?.resolve();
    }
  }
});

/** What a tree of this view bears, in blossom and in fruit. */
function getLabCrop(lab: LabParams): CropConfig[] | null {
  const crop: CropConfig[] = [];
  if (lab.blossoms) {
    crop.push({
      kind: 'flower',
      color: [255, 252, 240, 255],
      count: lab.blossoms,
      radius: 0.018,
      fallen: lab.petalFall
    });
  }
  if (lab.fruit) {
    crop.push({
      kind: 'fruit',
      color: [244, 140, 24, 255],
      unripeColor: [86, 128, 44, 255],
      ripeness: lab.ripeness,
      count: lab.fruit,
      radius: 0.04,
      fallen: lab.fruitFall
    });
  }
  return crop.length ? crop : null;
}

function buildLayers(lab: LabParams) {
  const coordinates = {
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: [0, 0, 0] as [number, number, number]
  };
  const layers: unknown[] = [];
  if (lab.ground > 0) {
    layers.push(
      new SimpleMeshLayer({
        ...coordinates,
        id: 'soil',
        data: [{}],
        mesh: GROUND_MESH as never,
        texture: SOIL_TEXTURE as never,
        textureParameters: {addressModeU: 'repeat', addressModeV: 'repeat'} as never,
        getPosition: [0, 0, -0.01],
        getColor: [255, 255, 255, 255],
        material: {ambient: 0.32, diffuse: 0.34, shininess: 1, specularColor: [0, 0, 0]},
        shadowEnabled: false
      } as never)
    );
  }
  if (lab.occluder > 0) {
    const elevation = (lab.sun * Math.PI) / 180;
    const bearing = (lab.sunBearing * Math.PI) / 180;
    const reach = 14;
    layers.push(
      new SimpleMeshLayer({
        ...coordinates,
        id: 'occluder',
        data: [{}],
        mesh: BOX as never,
        getPosition: [
          Math.sin(bearing) * Math.cos(elevation) * reach,
          Math.cos(bearing) * Math.cos(elevation) * reach,
          lab.targetZ + Math.sin(elevation) * reach
        ],
        getScale: [6, 6, 0.2],
        getColor: [90, 90, 200, 255],
        material: {unlit: true}
      } as never)
    );
  }
  layers.push(
    new TreeLayer({
      ...coordinates,
      id: 'trees',
      data: trees,
      getTree: (tree: {position: [number, number, number]; variety: number}): TreeSpec => ({
        position: tree.position,
        species: lab.species,
        height: lab.height,
        crownRadius: lab.crown,
        characteristics: {seed: lab.seed + tree.variety},
        growth: lab.growth,
        health: lab.health,
        foliage: lab.foliage,
        flush: lab.flush,
        lean: [lab.leanAngle, lab.leanBearing],
        damage: lab.damage,
        decay: lab.decay,
        crop: getLabCrop(lab)
      }),
      lodBias: lab.lodBias,
      wetness: lab.wetness,
      frost: lab.frost,
      fog:
        lab.fogDensity > 0
          ? {color: String(lab.fogColor).split(',').map(Number), density: lab.fogDensity}
          : null,
      shadowEnabled: lab.cast > 0,
      windStrength: lab.wind,
      windDirection: lab.windBearing,
      windTime: lab.time >= 0 ? lab.time : null,
      windGustTime: lab.gustTime >= 0 ? lab.gustTime : null,
      pickable: true,
      updateTriggers: {getTree: frame}
    })
  );
  return layers;
}

/** Waits for the frame after the next, and for the GPU to finish it. */
function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    frameWaiters.push({after: framesDrawn + 2, resolve});
    deck.redraw('lab');
  });
}

/** Shows a view: the given params on top of the last ones. Resolves when it has been drawn. */
async function renderLab(update: Partial<LabParams> = {}): Promise<void> {
  params = {...params, ...update};
  frame++;
  const nextTreesKey = `${params.count}`;
  if (nextTreesKey !== treesKey) {
    trees = createTrees(params);
    treesKey = nextTreesKey;
  }
  const nextEffectKey = [
    params.sun,
    params.sunBearing,
    params.sunIntensity,
    params.ambient,
    params.shadow
  ].join();
  if (nextEffectKey !== effectKey) {
    effectKey = nextEffectKey;
    effect = getLighting(params);
  }
  deck.setProps({
    views: getView(params),
    viewState: getViewState(params, deck.height || window.innerHeight),
    effects: [effect],
    layers: buildLayers(params) as never,
    useDevicePixels: params.dpr
  });
  await nextFrame();
}

/** Draws once more and returns that frame, over a plain sky, as a PNG data URL. */
function captureLab(): Promise<string> {
  return new Promise(resolve => {
    captureWaiter = resolve;
    deck.redraw('capture');
  });
}

/**
 * Real frame time: advances the clock for `frames` frames with the GPU finished after each, so a frame
 * that takes longer than the display's refresh shows its true cost.
 */
async function measureLab(frames = 60): Promise<{mean: number; median: number; worst: number}> {
  // The timeline drives the wind clock, so every frame draws and nothing else happens.
  await renderLab({time: -1, wind: params.wind || 0.03});
  const times = await new Promise<number[]>(resolve => {
    measuring = {times: [], frames: frames + 1, resolve};
  });
  const deltas = times.slice(1).map((time, index) => time - times[index]);
  deltas.sort((a, b) => a - b);
  return {
    mean: deltas.reduce((sum, time) => sum + time, 0) / deltas.length,
    median: deltas[deltas.length >> 1],
    worst: deltas[deltas.length - 1]
  };
}

function getLabInfo() {
  const gl = labGl as WebGL2RenderingContext;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    antialias: gl.getContextAttributes()?.antialias,
    samples: gl.getParameter(gl.SAMPLES),
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    errors,
    layers: deck.props.layers.length
  };
}

const motionReady = (async () => {
  while (!labGl || !deck.isInitialized) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await renderLab();
})();

Object.assign(window, {renderLab, captureLab, measureLab, getLabInfo, motionReady, deck});
