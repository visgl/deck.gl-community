// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The field benchmark's page: 20,000 citrus on a real GPU, driven one frame at a time along scripted camera
 * paths, with what each frame costs measured apart from vsync. `bench-field.mjs` runs it and prints the table.
 *
 *   yarn node dev/tree-lifecycle/field/bench-field.mjs --impl photoreal --paths orbit-wide,dive --runs 3 --out DIR
 *
 * ## Adding an implementation
 *
 * A prototype is one new file, and needs no change here. `dev/tree-lifecycle/field/impl-<name>.ts` exports:
 *
 *   export function getFieldLayers(trees: FieldTree[], frame: FieldFrame): LayersList;
 *
 * It is called once before every frame, inside the time measured, as a deck.gl app's render would be. `trees` is
 * one array whose identity never changes. A path that changes trees changes them in place and moves
 * `frame.revision`. `frame.layerProps` has what any layer needs for this frame, among them the coordinate system,
 * wind, `transitions`, `pickable` and `updateTriggers: {getTree: frame.revision}`, so the shortest implementation
 * is `impl-photoreal.ts`. Then `--impl <name>`, or `?impl=<name>` on this page, draws it on every path. Any other
 * URL parameter (`--query 'myKnob=3'`, or just `--myKnob 3`) reaches it as `frame.params.myKnob`.
 *
 * The file is imported at run time by name, so a new one needs no restart of the dev server. It may import what
 * `optimizeDeps.include` in `vite.config.ts` lists, as anything else makes Vite reload the page mid-run.
 *
 * ## Parameters
 *
 * See `DEFAULT_PARAMS`. `wideSpacing=1` uses taller trees with wider rows, `view=orbit` is `OrbitView` in metres instead of
 * `MapView`, and `shadows`, `msaa`, `dpr`, `width` and `height` are as they read. For taking a frame apart, `skip`
 * and `only` are regular expressions of the primitive layers not to draw and to draw, and `raster=0` draws them
 * with `RASTERIZER_DISCARD`, leaving only the vertex stage. `nodraw=1` leaves all the JavaScript of a frame and
 * none of its GPU's draw calls, which makes a profile quick and unmoved by whoever else has the GPU.
 *
 * ## A frame
 *
 * The animation loop is stopped. Each frame runs in a task of its own: set the props, call
 * `deck._onRenderFrame()`, note the time (`cpu`), wait for the GPU with `readPixels`, note the time (`total`).
 * The timeline and the wind clock advance by 1/60 s a frame, whatever a frame took, so a path draws the same
 * pictures on any machine. Every frame draws, whether or not anything asked it to. `gl.finish()` will not do here:
 * in Chrome it does not wait, and a frame's total comes out the same as its CPU time.
 *
 * ## From the console, or a script of your own
 *
 * `window.fieldBench` has `drawAt(camera)`, which draws and times one frame anywhere and returns what it drew by
 * pass and layer, and `setDrawFilter({skip, only, skipPass, raster})`, which changes what is drawn from one frame to
 * the next. Other agents share the GPU, and two frames a moment apart wait behind the same work, as two runs minutes
 * apart do not: to compare parts of a frame while the machine is busy, alternate them this way.
 */

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  Layer,
  type LayersList,
  LightingEffect,
  MapView,
  OrbitView,
  WebMercatorViewport
} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';

/** One tree, which is also its `TreeSpec`. A path may change its numbers in place. */
export type FieldTree = {
  position: [number, number, number];
  species: 'citrus';
  height: number;
  crownRadius: number;
  characteristics: {seed: number};
  growth: number;
  health: number;
  foliage: number;
  crop: Record<string, unknown> | null;
  /** Row and place in the row, counted from the south west. */
  row: number;
  column: number;
};

/** A camera in the field's own terms: looking at a point in metres from the field's center. */
export type FieldCamera = {
  east: number;
  north: number;
  up: number;
  /** `MapView` zoom. `OrbitView` is given the same pixels per metre and the same field of view. */
  zoom: number;
  pitch: number;
  bearing: number;
};

/** What every layer of an implementation needs for this frame. */
export type FieldLayerProps = {
  coordinateSystem: string;
  coordinateOrigin: [number, number, number];
  windStrength: number;
  windDirection: number | null;
  windTime: number | null;
  transitions: Record<string, number> | null;
  pickable: boolean;
  autoHighlight: boolean;
  updateTriggers: {getTree: number};
};

/** The second argument of an implementation. */
export type FieldFrame = {
  path: string;
  /** This frame of the path, from 0, and how many it has. Negative while settling. */
  frame: number;
  frameCount: number;
  /** The wind clock, in seconds. */
  time: number;
  params: FieldParams;
  camera: FieldCamera;
  /** Moves when a path has changed any tree. */
  revision: number;
  layerProps: FieldLayerProps;
};

type FieldParams = {
  /** Which `impl-<name>.ts` draws the trees. */
  impl: string;
  count: number;
  /** Distinct `characteristics` seeds among the trees. */
  seeds: number;
  /** 1 for trees 6.2 m tall with a 3 m crown radius, 7.6 m rows and 6 m between trees. */
  wideSpacing: number;
  view: 'map' | 'orbit';
  shadows: number;
  msaa: number;
  dpr: number;
  width: number;
  height: number;
  /** Wind strength, and the bearing it blows toward, or anything not a number for none. */
  wind: number;
  windBearing: number | string;
  /** Growth of every tree. */
  growth: number;
  /** Fruit per tree. */
  fruit: number;
  ground: number;
  lodBias: number;
  /** Regular expressions of primitive layer ids not to draw, and to draw. */
  skip: string;
  only: string;
  /** 0 discards all rasterization, leaving only the vertex stage. */
  raster: number;
  /** 1 issues no draw call at all, leaving every line of a frame's JavaScript, for a profile. */
  nodraw: number;
  /**
   * How to wait for the GPU: `readpixels`, or `none`, or `finish`, which is only there to show that `gl.finish()`
   * does not wait in Chrome, where it is a flush: a frame's total comes out the same as its CPU time.
   */
  flush: string;
  /** A path to run as soon as the first frame is done, for `load`. */
  autorun: string;
  /** For `hold-at`: `east,north,up,zoom,pitch,bearing`, in metres from the field's center and degrees. */
  camera: string;
  /** 0 keeps `subset-updates` to `height`, which `origin/master` has too, and leaves `health` alone. */
  subsetHealth: number;
  /** Width of each path's picture, as a full-size PNG of a field runs to megabytes. 0 for the canvas's own. */
  pictureWidth: number;
  [key: string]: unknown;
};

const DEFAULT_PARAMS: FieldParams = {
  impl: 'photoreal',
  count: 20000,
  seeds: 4,
  wideSpacing: 0,
  view: 'map',
  shadows: 1,
  msaa: 1,
  dpr: 1,
  // Use the physical pixel dimensions of the reference laptop canvas.
  width: 2560,
  height: 1600,
  wind: 0.03,
  windBearing: 80,
  growth: 1,
  fruit: 0,
  ground: 1,
  lodBias: 0,
  skip: '',
  only: '',
  raster: 1,
  nodraw: 0,
  flush: 'readpixels',
  autorun: '',
  camera: '',
  subsetHealth: 1,
  pictureWidth: 1280
};

const ORIGIN: [number, number] = [-81.7, 28.1];
const ORIGIN_VIEWPORT = new WebMercatorViewport({
  width: 1,
  height: 1,
  longitude: ORIGIN[0],
  latitude: ORIGIN[1]
});
const METRES_AROUND_EARTH = 40.03e6;
/** `MapView`'s field of view, from its altitude of 1.5 viewport heights, for `OrbitView` to match. */
const MAP_FOV_DEGREES = 36.87;
const MAP_ALTITUDE = 1.5;
const FRAME_MS = 1000 / 60;
/** Where the clocks are during a path's frame 0, far enough along that a settling frame is never before 0. */
const PATH_START_SECONDS = 1000;
/** Frames drawn at a path's first camera before measuring, as a canopy's refinement fades take this many. */
const SETTLE_FRAMES = 30;
const SETTLE_MAX_MS = 3000;
const SETTLE_MIN_FRAMES = 3;
const DEFAULT_MAX_SECONDS = 180;
/** The window of the `load` path, from the moment `Deck` is created. */
const LOAD_WINDOW_MS = 5000;
const SUBSET_TREES = 100;

function readParams(): FieldParams {
  const result: FieldParams = {...DEFAULT_PARAMS};
  new URLSearchParams(window.location.search).forEach((text, key) => {
    result[key] = text !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
  });
  return result;
}

const params = readParams();

// ---------------------------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------------------------

type Field = {
  trees: FieldTree[];
  rows: number;
  columns: number;
  rowSpacing: number;
  treeSpacing: number;
  height: number;
  crownRadius: number;
  /** Half the field's size along each axis, and half its diagonal, in metres. */
  halfEast: number;
  halfNorth: number;
  radius: number;
  /** Each tree's height as planted, for a path to vary around. */
  plantedHeights: Float32Array;
};

/** A small deterministic generator: the same field every time. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getTreePosition(east: number, north: number): [number, number, number] {
  if (params.view === 'orbit') return [east, north, 0];
  const [longitude, latitude] = ORIGIN_VIEWPORT.addMetersToLngLat(ORIGIN, [east, north]);
  return [longitude, latitude, 0];
}

/** A nearly square block: rows run east and west, as in `tree-grove-performance.browser.spec.ts`. */
function createField(): Field {
  const wideSpacing = params.wideSpacing > 0;
  const rowSpacing = wideSpacing ? 7.6 : 7;
  const treeSpacing = wideSpacing ? 6 : 4.5;
  const height = wideSpacing ? 6.2 : 3;
  const crownRadius = wideSpacing ? 3 : 2.25;
  const columns = Math.max(1, Math.ceil(Math.sqrt((params.count * rowSpacing) / treeSpacing)));
  const rows = Math.max(1, Math.ceil(params.count / columns));
  const random = createRandom(20000);
  const characteristics = Array.from({length: Math.max(1, params.seeds)}, (_, index) => ({
    seed: index + 1
  }));
  const crop =
    params.fruit > 0
      ? {
          kind: 'fruit',
          color: [244, 140, 24, 255],
          unripeColor: [86, 128, 44, 255],
          ripeness: 1,
          count: params.fruit,
          radius: 0.04
        }
      : null;
  const trees: FieldTree[] = [];
  const plantedHeights = new Float32Array(params.count);
  for (let index = 0; index < params.count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const treeHeight = height * (1 + 0.06 * (random() * 2 - 1));
    plantedHeights[index] = treeHeight;
    trees.push({
      position: getTreePosition(
        (column - (columns - 1) / 2) * treeSpacing,
        (row - (rows - 1) / 2) * rowSpacing
      ),
      species: 'citrus',
      height: treeHeight,
      crownRadius: crownRadius * (1 + 0.05 * (random() * 2 - 1)),
      characteristics: characteristics[Math.floor(random() * characteristics.length)],
      growth: params.growth,
      health: 1,
      foliage: 1,
      crop,
      row,
      column
    });
  }
  const halfEast = ((columns - 1) / 2) * treeSpacing;
  const halfNorth = ((rows - 1) / 2) * rowSpacing;
  return {
    trees,
    rows,
    columns,
    rowSpacing,
    treeSpacing,
    height,
    crownRadius,
    halfEast,
    halfNorth,
    radius: Math.hypot(halfEast, halfNorth),
    plantedHeights
  };
}

function getPixelsPerMetre(zoom: number): number {
  return 2 ** (zoom + 9) / (METRES_AROUND_EARTH * Math.cos((ORIGIN[1] * Math.PI) / 180));
}

function getZoomForPixelsPerMetre(pixelsPerMetre: number): number {
  return (
    Math.log2(pixelsPerMetre * METRES_AROUND_EARTH * Math.cos((ORIGIN[1] * Math.PI) / 180)) - 9
  );
}

function getViewState(camera: FieldCamera): Record<string, unknown> {
  if (params.view === 'orbit') {
    return {
      target: [camera.east, camera.north, camera.up],
      zoom: Math.log2(getPixelsPerMetre(camera.zoom)),
      rotationOrbit: camera.bearing,
      rotationX: 90 - camera.pitch,
      minZoom: -20,
      maxZoom: 40
    };
  }
  const [longitude, latitude] = ORIGIN_VIEWPORT.addMetersToLngLat(ORIGIN, [
    camera.east,
    camera.north
  ]);
  return {
    longitude,
    latitude,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    position: [0, 0, camera.up]
  };
}

/** The far plane of `OrbitView`, which a shadow map fits, follows the distance, as `MapView`'s does. */
function getOrbitFar(zoom: number, field: Field): number {
  const pixelsPerMetre = getPixelsPerMetre(zoom);
  const distance = (MAP_ALTITUDE * params.height) / pixelsPerMetre;
  const metres = Math.min(distance + 2.5 * field.radius, Math.max(20 * distance, 30));
  return (metres * pixelsPerMetre) / params.height;
}

function createView(zoom: number, field: Field): MapView | OrbitView {
  return params.view === 'orbit'
    ? new OrbitView({
        id: 'field',
        orbitAxis: 'Z',
        fovy: MAP_FOV_DEGREES,
        near: 0.02,
        far: getOrbitFar(zoom, field)
      } as ConstructorParameters<typeof OrbitView>[0])
    : new MapView({id: 'field'});
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

type FieldPath = {
  frames: number;
  /** Where along the path its picture is taken, 0-1. */
  capture: number;
  getCamera: (t: number) => FieldCamera;
  /** Changes trees before a frame, and says whether it did. */
  update?: (frame: number, frameCount: number) => boolean;
  /** `transitions` for the whole path. */
  getTransitions?: (frameCount: number) => Record<string, number>;
  /** Where the pointer is, in CSS pixels, with `autoHighlight` on. */
  getPointer?: (t: number) => [number, number];
};

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Up from 0 to 1 and back. */
function getTriangle(t: number): number {
  return 1 - Math.abs(2 * t - 1);
}

function getSmooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** What each tween path changes: its accessor and how far from where it starts. */
const TWEENS = {
  growth: {transition: 'getGrowth', low: 0.55},
  health: {transition: 'getHealth', low: 0.15},
  foliage: {transition: 'getFoliage', low: 0.25}
} as const;

function createTweenPath(
  field: Field,
  key: keyof typeof TWEENS,
  byAccessor: boolean,
  getCamera: (t: number) => FieldCamera
): FieldPath {
  const {transition, low} = TWEENS[key];
  const high = key === 'growth' ? params.growth : 1;
  const low2 = key === 'growth' ? high * low : low;
  const setAll = (value: number) => {
    for (const tree of field.trees) tree[key] = value;
  };
  if (byAccessor) {
    return {
      frames: 120,
      capture: 0.5,
      getCamera,
      update(frame, frameCount) {
        setAll(mix(high, low2, getTriangle(frame / Math.max(1, frameCount - 1))));
        return true;
      }
    };
  }
  return {
    frames: 120,
    capture: 0.45,
    getCamera,
    getTransitions: frameCount => ({[transition]: (frameCount / 2) * FRAME_MS}),
    update(frame, frameCount) {
      if (frame === 0) setAll(low2);
      else if (frame === frameCount >> 1) setAll(high);
      else return false;
      return true;
    }
  };
}

/** The tree nearest the middle of the field, and a point on the side of its crown the camera comes from. */
function getDiveTarget(field: Field): {east: number; north: number; up: number} {
  const column = (field.columns - 1) >> 1;
  const row = (field.rows - 1) >> 1;
  return {
    east: (column - (field.columns - 1) / 2) * field.treeSpacing,
    north: (row - (field.rows - 1) / 2) * field.rowSpacing - field.crownRadius * 0.92,
    up: field.height * 0.55
  };
}

/** A camera from the `camera` parameter, or `fallback` if there is none. */
function readCamera(text: string, fallback: FieldCamera): FieldCamera {
  const values = text.split(',').map(Number);
  if (values.length !== 6 || values.some(value => !Number.isFinite(value))) return fallback;
  const [east, north, up, zoom, pitch, bearing] = values;
  return {east, north, up, zoom, pitch, bearing};
}

function createPaths(field: Field): Record<string, FieldPath> {
  const {width, height} = params;
  const overview: FieldCamera = {
    east: 0,
    north: 0,
    up: 0,
    zoom: getZoomForPixelsPerMetre(Math.min(width, height) / (2.1 * field.radius)),
    pitch: 45,
    bearing: 20
  };
  const hold = () => overview;
  const orbit = (zoom: number) => (t: number) => ({
    east: 0,
    north: 0,
    up: 0,
    zoom,
    pitch: 55,
    bearing: 90 * t
  });

  // An edge of the screen sweeps from the block's west side to its east side, and back.
  const panZoom = 15.5;
  const panHalfView = width / (2 * getPixelsPerMetre(panZoom));
  // Along the aisle north of the middle row, looking east.
  const aisleNorth = (((field.rows - 1) >> 1) - (field.rows - 1) / 2 + 0.5) * field.rowSpacing;
  // A leaf of 10 cm is some 400 px long at the bottom of a dive.
  const diveZoom = getZoomForPixelsPerMetre((MAP_ALTITUDE * height) / 0.45);
  const diveTarget = getDiveTarget(field);
  const getDiveCamera = (t: number): FieldCamera => {
    const depth = getSmooth(getTriangle(t));
    const zoom = mix(overview.zoom, diveZoom, depth);
    // The target stays where it is on screen as all else moves away from it, as in a zoom about a point.
    const toward = 1 - 2 ** (overview.zoom - zoom);
    return {
      east: diveTarget.east * toward,
      north: diveTarget.north * toward,
      up: diveTarget.up * toward,
      zoom,
      pitch: mix(overview.pitch, 75, depth),
      bearing: mix(overview.bearing, 0, depth)
    };
  };

  return {
    'overview-hold': {frames: 60, capture: 0.5, getCamera: hold},
    pan: {
      frames: 120,
      capture: 0.25,
      getCamera: t => ({
        east: panHalfView + field.halfEast * (2 * getTriangle(t) - 1),
        north: 0,
        up: 0,
        zoom: panZoom,
        pitch: 30,
        bearing: 0
      })
    },
    'orbit-wide': {frames: 120, capture: 0.5, getCamera: orbit(15.5)},
    'orbit-mid': {frames: 120, capture: 0.5, getCamera: orbit(18.6)},
    'low-pitch': {
      frames: 120,
      capture: 0.5,
      getCamera: t => ({
        east: mix(-120, 0, t),
        north: aisleNorth,
        up: 0,
        zoom: 20,
        pitch: 78,
        bearing: 90
      })
    },
    dive: {frames: 240, capture: 0.5, getCamera: getDiveCamera},
    'hold-leaf': {frames: 60, capture: 0.5, getCamera: () => getDiveCamera(0.5)},
    'hold-at': {frames: 60, capture: 0.5, getCamera: () => readCamera(params.camera, overview)},
    'tween-all-growth': createTweenPath(field, 'growth', false, hold),
    'tween-all-health': createTweenPath(field, 'health', false, hold),
    'tween-all-foliage': createTweenPath(field, 'foliage', false, hold),
    'tween-all-growth-accessor': createTweenPath(field, 'growth', true, hold),
    'tween-all-health-accessor': createTweenPath(field, 'health', true, hold),
    'tween-all-foliage-accessor': createTweenPath(field, 'foliage', true, hold),
    'subset-updates': {
      frames: 120,
      capture: 0.5,
      getCamera: hold,
      update(frame) {
        const {trees, plantedHeights} = field;
        const shift = frame % 2 ? 1.02 : 0.98;
        for (let i = 0; i < SUBSET_TREES; i++) {
          // Every frame a different hundred, all over the field.
          const index = ((frame * SUBSET_TREES + i) * 7919) % trees.length;
          trees[index].height = plantedHeights[index] * shift;
          if (params.subsetHealth) trees[index].health = frame % 2 ? 1 : 0.6;
        }
        return true;
      }
    },
    'pick-hover': {
      frames: 120,
      capture: 0.5,
      getCamera: t => ({east: 0, north: 0, up: 0, zoom: 18.6, pitch: 55, bearing: 30 * t}),
      getPointer: t => [
        width * (0.5 + 0.35 * Math.sin(2 * Math.PI * t * 3)),
        height * (0.55 + 0.3 * Math.cos(2 * Math.PI * t * 2))
      ]
    },
    // Frames at this camera until `LOAD_WINDOW_MS` is over. `frames` is only an upper limit.
    load: {frames: 2000, capture: 1, getCamera: hold}
  };
}

// ---------------------------------------------------------------------------------------------
// Counting and taking frames apart
// ---------------------------------------------------------------------------------------------

type PassName = 'screen' | 'shadow' | 'pick';
const PASS_NAMES: PassName[] = ['screen', 'shadow', 'pick'];

type DrawTally = {
  pass: PassName;
  layer: string;
  draws: number;
  /** Indices, or vertices where a draw has none, times instances. */
  indices: number;
  instances: number;
  /** Indices of the last draw, for one instance. */
  perInstance: number;
};

const tallies = new Map<string, DrawTally>();
const passTotals: Record<PassName, {draws: number; indices: number}> = {
  screen: {draws: 0, indices: 0},
  shadow: {draws: 0, indices: 0},
  pick: {draws: 0, indices: 0}
};
let currentPass: PassName = 'screen';
let currentLayer = '(no layer)';
let currentTally: DrawTally | null = null;
let skipPattern = params.skip ? new RegExp(String(params.skip)) : null;
let onlyPattern = params.only ? new RegExp(String(params.only)) : null;
let skippedPass: PassName | null = null;
let discardRaster = params.raster === 0;

/**
 * Takes frames apart from one frame to the next, in one page. Other agents share the GPU, and two frames a moment
 * apart wait behind the same work, which two runs minutes apart do not.
 */
function setDrawFilter(filter: {
  skip?: string;
  only?: string;
  skipPass?: PassName;
  raster?: boolean;
}) {
  skipPattern = filter.skip ? new RegExp(filter.skip) : null;
  onlyPattern = filter.only ? new RegExp(filter.only) : null;
  skippedPass = filter.skipPass ?? null;
  discardRaster = filter.raster === false;
}

function getTally(pass: PassName, layer: string): DrawTally {
  const key = `${pass}|${layer}`;
  let tally = tallies.get(key);
  if (!tally) {
    tally = {pass, layer, draws: 0, indices: 0, instances: 0, perInstance: 0};
    tallies.set(key, tally);
  }
  return tally;
}

function resetTallies(): void {
  for (const tally of tallies.values()) {
    tally.draws = 0;
    tally.indices = 0;
    tally.instances = 0;
  }
  for (const name of PASS_NAMES) {
    passTotals[name].draws = 0;
    passTotals[name].indices = 0;
  }
}

function copyTallies(): DrawTally[] {
  return [...tallies.values()].filter(tally => tally.draws > 0).map(tally => ({...tally}));
}

function countDraw(perInstance: number, instances: number): void {
  const tally = currentTally ?? getTally(currentPass, currentLayer);
  tally.draws++;
  tally.indices += perInstance * instances;
  tally.instances += instances;
  tally.perInstance = perInstance;
  const total = passTotals[tally.pass];
  total.draws++;
  total.indices += perInstance * instances;
}

/** Which pass and layer a draw call belongs to, and whether it should happen at all. */
const originalDrawLayer = Layer.prototype._drawLayer;
Layer.prototype._drawLayer = function drawLayer(
  this: Layer,
  options: Parameters<Layer['_drawLayer']>[0]
): void {
  if (skipPattern?.test(this.id) || (onlyPattern && !onlyPattern.test(this.id))) return;
  const moduleProps = options.shaderModuleProps;
  currentPass = moduleProps?.shadow?.drawToShadowMap
    ? 'shadow'
    : moduleProps?.picking?.isActive
      ? 'pick'
      : 'screen';
  if (currentPass === skippedPass) return;
  currentLayer = this.id;
  currentTally = getTally(currentPass, currentLayer);
  try {
    originalDrawLayer.call(this, options);
  } finally {
    currentLayer = '(no layer)';
    currentTally = null;
  }
};

function instrumentContext(gl: WebGL2RenderingContext): void {
  const {drawArrays, drawElements, drawArraysInstanced, drawElementsInstanced} = gl;
  const run = (draw: () => void) => {
    // Counted, and every line of JavaScript around it has run, but the GPU is never asked.
    if (params.nodraw) return;
    if (!discardRaster) {
      draw();
      return;
    }
    gl.enable(gl.RASTERIZER_DISCARD);
    draw();
    gl.disable(gl.RASTERIZER_DISCARD);
  };
  gl.drawArrays = (mode, first, count) => {
    countDraw(count, 1);
    run(() => drawArrays.call(gl, mode, first, count));
  };
  gl.drawElements = (mode, count, type, offset) => {
    countDraw(count, 1);
    run(() => drawElements.call(gl, mode, count, type, offset));
  };
  gl.drawArraysInstanced = (mode, first, count, instances) => {
    countDraw(count, instances);
    run(() => drawArraysInstanced.call(gl, mode, first, count, instances));
  };
  gl.drawElementsInstanced = (mode, count, type, offset, instances) => {
    countDraw(count, instances);
    run(() => drawElementsInstanced.call(gl, mode, count, type, offset, instances));
  };
}

// ---------------------------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------------------------

function createLighting(): LightingEffect {
  const elevation = (52 * Math.PI) / 180;
  const bearing = (135 * Math.PI) / 180;
  const effect = new LightingEffect({
    ambient: new AmbientLight({color: [200, 216, 255], intensity: 0.85}),
    sun: new DirectionalLight({
      color: [255, 246, 230],
      intensity: 2.1,
      direction: [
        -Math.sin(bearing) * Math.cos(elevation),
        -Math.cos(bearing) * Math.cos(elevation),
        -Math.sin(elevation)
      ],
      _shadow: params.shadows > 0
    })
  });
  effect.shadowColor = [0.05, 0.07, 0.12, 0.66];
  return effect;
}

function getCoordinates(): Pick<FieldLayerProps, 'coordinateSystem' | 'coordinateOrigin'> {
  return params.view === 'orbit'
    ? {coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, coordinateOrigin: [0, 0, 0]}
    : {coordinateSystem: COORDINATE_SYSTEM.LNGLAT, coordinateOrigin: [0, 0, 0]};
}

/** Plain soil that takes shadows, so a picture can be read. It casts none and is never picked. */
function createGround(field: Field): Layer | null {
  if (!params.ground) return null;
  // Past the edges of the screen on every path, at any size of field.
  const reach = Math.max(field.radius * 6, 8000);
  return new SolidPolygonLayer<{polygon: number[][]}>({
    id: 'field-ground',
    ...(params.view === 'orbit'
      ? {coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, coordinateOrigin: [0, 0, 0]}
      : {coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS, coordinateOrigin: [...ORIGIN, 0]}),
    data: [
      {
        polygon: [
          [-reach, -reach, -0.01],
          [reach, -reach, -0.01],
          [reach, reach, -0.01],
          [-reach, reach, -0.01]
        ]
      }
    ],
    getPolygon: row => row.polygon,
    getFillColor: [146, 124, 92, 255],
    material: {ambient: 0.32, diffuse: 0.34, shininess: 1, specularColor: [0, 0, 0]},
    shadowEnabled: false,
    pickable: false
  } as never);
}

// ---------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------

type FieldImplementation = {
  getFieldLayers: (trees: FieldTree[], frame: FieldFrame) => LayersList;
};

/** Everything a run needs, set when the first frame has been drawn. */
type Bench = {
  deck: Deck<MapView | OrbitView>;
  gl: WebGL2RenderingContext;
  field: Field;
  paths: Record<string, FieldPath>;
  implementation: FieldImplementation;
  ground: Layer | null;
  view: MapView | OrbitView;
  viewFar: number;
  coordinates: ReturnType<typeof getCoordinates>;
};

let bench: Bench | null = null;
let revision = 0;
let framesDrawn = 0;
let pickHits = 0;
let picksAnswered = 0;
const errors: string[] = [];
const PIXEL = new Uint8Array(4);

type FrameInput = {
  path: string;
  /** Counted from the path's frame 0, so the clocks are the same in every run, however it settled. */
  frame: number;
  frameCount: number;
  camera: FieldCamera;
  transitions: Record<string, number> | null;
  picking: boolean;
};

function waitForGpu(gl: WebGL2RenderingContext): void {
  if (params.flush === 'finish') {
    gl.finish();
  } else if (params.flush !== 'none') {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIXEL);
  }
}

function getFrameState(input: FrameInput, field: Field, coordinates: Bench['coordinates']) {
  const time = PATH_START_SECONDS + input.frame / 60;
  const frame: FieldFrame = {
    path: input.path,
    frame: input.frame,
    frameCount: input.frameCount,
    time,
    params,
    camera: input.camera,
    revision,
    layerProps: {
      ...coordinates,
      windStrength: params.wind,
      windDirection:
        params.wind > 0 && typeof params.windBearing === 'number' ? params.windBearing : null,
      windTime: params.wind > 0 ? time : null,
      transitions: input.transitions,
      pickable: input.picking,
      autoHighlight: input.picking,
      updateTriggers: {getTree: revision}
    }
  };
  return frame;
}

/** One frame. Returns its CPU time, up to the flush, and its total. Neither includes a path's changes to trees. */
function drawFrame(input: FrameInput, result: {cpu: number; total: number; start: number}): void {
  const current = bench as Bench;
  const {deck, gl, field, implementation, ground, coordinates} = current;
  resetTallies();
  const timeline = (deck as unknown as {animationLoop: {timeline: {setTime: (t: number) => void}}})
    .animationLoop.timeline;
  timeline.setTime((PATH_START_SECONDS + input.frame / 60) * 1000);
  const frameState = getFrameState(input, field, coordinates);
  const viewState = getViewState(input.camera);
  let view: MapView | OrbitView | undefined;
  if (params.view === 'orbit') {
    const far = getOrbitFar(input.camera.zoom, field);
    if (Math.abs(far - current.viewFar) > current.viewFar * 0.01) {
      current.viewFar = far;
      current.view = createView(input.camera.zoom, field);
      view = current.view;
    }
  }

  const start = performance.now();
  const layers = implementation.getFieldLayers(field.trees, frameState);
  deck.setProps({
    ...(view ? {views: view} : {}),
    viewState: viewState as never,
    layers: ground ? [ground, ...layers] : layers
  } as never);
  const forDeck = deck as unknown as {_needsRedraw: string | false; _onRenderFrame: () => void};
  forDeck._needsRedraw = 'field';
  forDeck._onRenderFrame();
  const beforeFlush = performance.now();
  waitForGpu(gl);
  const end = performance.now();
  result.start = start;
  result.cpu = beforeFlush - start;
  result.total = end - start;
}

/** Lets the browser run whatever it has between frames, without waiting for the display. */
const yieldChannel = new MessageChannel();
let yieldResolve: (() => void) | null = null;
yieldChannel.port1.onmessage = () => {
  const resolve = yieldResolve;
  yieldResolve = null;
  resolve?.();
};
function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => {
    yieldResolve = resolve;
    yieldChannel.port2.postMessage(0);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function getHeapBytes(): number {
  const memory = (performance as unknown as {memory?: {usedJSHeapSize: number}}).memory;
  return memory ? memory.usedJSHeapSize : 0;
}

/**
 * Takes the frame just drawn, in the task that drew it, over a plain sky, at `pictureWidth`. The canvas itself is
 * only ever scaled here, so that the frames measured are the ones the parameters say.
 */
function captureCanvas(gl: WebGL2RenderingContext): HTMLCanvasElement {
  const canvas = gl.canvas as HTMLCanvasElement;
  const out = document.createElement('canvas');
  const scale = params.pictureWidth > 0 ? Math.min(1, params.pictureWidth / canvas.width) : 1;
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const context = out.getContext('2d') as CanvasRenderingContext2D;
  const sky = context.createLinearGradient(0, 0, 0, out.height);
  sky.addColorStop(0, '#7da7d6');
  sky.addColorStop(0.62, '#cfe1ef');
  sky.addColorStop(1, '#e9e3d3');
  context.fillStyle = sky;
  context.fillRect(0, 0, out.width, out.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

type PathOptions = {
  /** Frames instead of the path's own number. */
  frames?: number;
  /** Multiplies the path's own number of frames. */
  frameScale?: number;
  /** Stops here, marked as truncated, however many frames are left. */
  maxSeconds?: number;
};

function getInput(path: string, entry: FieldPath, frame: number, frameCount: number): FrameInput {
  return {
    path,
    frame,
    frameCount,
    camera: entry.getCamera(Math.max(0, frame) / Math.max(1, frameCount - 1)),
    transitions: entry.getTransitions?.(frameCount) ?? null,
    picking: Boolean(entry.getPointer)
  };
}

function getFrameCount(entry: FieldPath, options: PathOptions): number {
  return Math.max(2, Math.round(options.frames ?? entry.frames * (options.frameScale ?? 1)));
}

let settled: {path: string; frames: number} | null = null;

/** Draws frames at a path's first camera, measuring nothing, so that a path starts from where it means to. */
async function settlePath(path: string, options: PathOptions = {}): Promise<void> {
  const current = bench as Bench;
  const entry = current.paths[path];
  if (!entry) throw new Error(`No path ${path}: ${Object.keys(current.paths).join(', ')}`);
  const frameCount = getFrameCount(entry, options);
  const timing = {cpu: 0, total: 0, start: 0};
  const started = performance.now();
  let frames = 0;
  while (frames < SETTLE_FRAMES) {
    const input = getInput(path, entry, frames - SETTLE_FRAMES, frameCount);
    drawFrame(input, timing);
    frames++;
    await yieldToBrowser();
    if (frames >= SETTLE_MIN_FRAMES && performance.now() - started > SETTLE_MAX_MS) break;
  }
  settled = {path, frames};
}

type LongTask = {start: number; duration: number; flush: number; inCapture: boolean};

function getLongTasks(
  from: number,
  to: number,
  starts: number[],
  ends: number[],
  flushes: number[],
  capture: {from: number; to: number} | null
): LongTask[] {
  const tasks: LongTask[] = [];
  for (const task of (window as unknown as {fieldLongTasks: {start: number; duration: number}[]})
    .fieldLongTasks) {
    const taskEnd = task.start + task.duration;
    if (taskEnd < from || task.start > to) continue;
    // A long task's times are rounded, so a frame belongs to the task its middle falls in.
    let flush = 0;
    for (let frame = 0; frame < starts.length; frame++) {
      const middle = (starts[frame] + ends[frame]) / 2;
      if (middle >= task.start && middle <= taskEnd) flush += flushes[frame];
    }
    tasks.push({
      start: task.start,
      duration: task.duration,
      flush,
      inCapture: Boolean(capture && task.start <= capture.to && taskEnd >= capture.from)
    });
  }
  return tasks;
}

/** Runs a path and returns every frame's numbers and one picture of it. */
async function runPath(path: string, options: PathOptions = {}): Promise<Record<string, unknown>> {
  const current = bench as Bench;
  const {deck, gl, paths} = current;
  const entry = paths[path];
  if (!entry) throw new Error(`No path ${path}: ${Object.keys(paths).join(', ')}`);
  const isLoad = path === 'load';
  const frameCount = getFrameCount(entry, isLoad ? {} : options);
  if (!isLoad && settled?.path !== path) await settlePath(path, options);
  const settleFrames = settled?.frames ?? 0;
  const maxMs = (options.maxSeconds ?? DEFAULT_MAX_SECONDS) * 1000;
  const captureFrame = Math.round(entry.capture * (frameCount - 1));

  // Not in the first frame's task, which `load` follows straight on from.
  if (!isLoad) (window as unknown as {gc?: () => void}).gc?.();
  await yieldToBrowser();
  const heapAtStart = getHeapBytes();
  pickHits = 0;
  picksAnswered = 0;
  const cpu: number[] = [];
  const total: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const flushes: number[] = [];
  const heap: number[] = [];
  const passes: Record<PassName, {draws: number[]; indices: number[]}> = {
    screen: {draws: [], indices: []},
    shadow: {draws: [], indices: []},
    pick: {draws: [], indices: []}
  };
  let peakIndices = -1;
  let peak: {frame: number; layers: DrawTally[]} | null = null;
  let captureLayers: DrawTally[] = [];
  let picture: HTMLCanvasElement | null = null;
  let captureWindow: {from: number; to: number} | null = null;
  let truncated = false;
  const timing = {cpu: 0, total: 0, start: 0};
  const started = performance.now();
  const loadEnd = loadStart + LOAD_WINDOW_MS;

  for (let frame = 0; frame < frameCount; frame++) {
    if (isLoad && performance.now() >= loadEnd) break;
    if (performance.now() - started > maxMs) {
      truncated = true;
      break;
    }
    if (entry.update?.(frame, frameCount)) revision++;
    const pointer = entry.getPointer?.(frame / Math.max(1, frameCount - 1));
    if (pointer) {
      (deck as unknown as {_onPointerMove: (event: unknown) => void})._onPointerMove({
        type: 'pointermove',
        offsetCenter: {x: pointer[0], y: pointer[1]},
        leftButton: false,
        rightButton: false,
        srcEvent: {target: gl.canvas}
      });
    }
    const input = getInput(path, entry, frame, frameCount);
    drawFrame(input, timing);
    const end = timing.start + timing.total;
    cpu.push(timing.cpu);
    total.push(timing.total);
    starts.push(timing.start);
    ends.push(end);
    flushes.push(timing.total - timing.cpu);
    heap.push(getHeapBytes());
    let indices = 0;
    for (const name of PASS_NAMES) {
      passes[name].draws.push(passTotals[name].draws);
      passes[name].indices.push(passTotals[name].indices);
      indices += passTotals[name].indices;
    }
    if (indices > peakIndices) {
      peakIndices = indices;
      peak = {frame, layers: copyTallies()};
    }
    if (frame === captureFrame && !isLoad) {
      captureLayers = copyTallies();
      picture = captureCanvas(gl);
      captureWindow = {from: end, to: performance.now()};
    }
    await yieldToBrowser();
  }
  const finished = performance.now();
  if (isLoad) {
    // The last frame drew at the same camera, and is gone by now, so this draws one more.
    drawFrame(getInput(path, entry, cpu.length, frameCount), timing);
    captureLayers = copyTallies();
    picture = captureCanvas(gl);
    captureWindow = {from: finished, to: performance.now()};
    starts.push(firstFlush.start);
    ends.push(firstFlush.end);
    flushes.push(firstFlush.end - firstFlush.start);
  }
  // Long tasks reach the observer after they end.
  await delay(120);

  const longFrom = isLoad ? loadStart : started;
  const longTo = isLoad ? Math.max(finished, loadEnd) : finished;
  const picturePng = picture ? picture.toDataURL('image/png') : null;
  return {
    path,
    frames: cpu.length,
    frameCount,
    settleFrames,
    truncated,
    cpu: cpu.map(round),
    total: total.map(round),
    heap,
    heapAtStart,
    wallSeconds: (finished - started) / 1000,
    passes,
    peak,
    capture: {frame: captureFrame, layers: captureLayers},
    longTasks: getLongTasks(longFrom, longTo, starts, ends, flushes, captureWindow),
    picks: {answered: picksAnswered, hits: pickHits},
    framesDrawn,
    load: isLoad ? {...loadTimes, windowMs: LOAD_WINDOW_MS} : null,
    memory: getMemory(),
    errors,
    png: picturePng
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** JS heap and what luma.gl knows it has given the GPU, in bytes. */
function getMemory(): Record<string, number> {
  const deck = (bench as Bench).deck as unknown as {
    metrics: Record<string, number>;
    _getMetrics: () => void;
  };
  deck._getMetrics();
  const {gpuMemory, bufferMemory, textureMemory, renderbufferMemory} = deck.metrics;
  return {
    jsHeap: getHeapBytes(),
    gpu: gpuMemory,
    buffers: bufferMemory,
    textures: textureMemory,
    renderbuffers: renderbufferMemory
  };
}

/** What the page is drawing on. */
function getInfo(): Record<string, unknown> {
  const {gl, deck, field} = bench as Bench;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    antialias: gl.getContextAttributes()?.antialias,
    samples: gl.getParameter(gl.SAMPLES),
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    viewport: [deck.width, deck.height],
    trees: field.trees.length,
    rows: field.rows,
    columns: field.columns,
    sizeMetres: [field.halfEast * 2, field.halfNorth * 2],
    params
  };
}

/** What is read here of a photoreal template, which is typed in `tree-photoreal-layout.ts`. */
type TreeGrowthModelFields = {
  key: string;
  leaves: Float32Array;
  leafCount: number;
  lodLeafCounts: number[];
  cropAnchors: Float32Array;
  limbs: Float32Array;
  wood: {
    vertexCount: number;
    center: Float32Array;
    previous: Float32Array;
    radial: Float32Array;
    bark: Float32Array;
    shade: Float32Array;
    indices: Uint32Array;
    lodIndexCounts: number[];
  };
};

/** How many distinct vertices each level's prefix of indices reaches. */
function getVerticesReached(indices: Uint32Array, vertexCount: number, counts: number[]): number[] {
  return counts.map(count => {
    const reached = new Uint8Array(vertexCount);
    let distinct = 0;
    for (let i = 0; i < count; i++) {
      if (!reached[indices[i]]) {
        reached[indices[i]] = 1;
        distinct++;
      }
    }
    return distinct;
  });
}

/** Per template, of `quality: 'photoreal'`: what a model holds. Empty for anything else. */
function getTemplates(): Record<string, unknown>[] {
  const {layerManager} = (bench as Bench).deck as unknown as {
    layerManager?: {getLayers(): Layer[]};
  };
  const seen = new Set<unknown>();
  const templates: Record<string, unknown>[] = [];
  for (const layer of layerManager?.getLayers() ?? []) {
    const template = (layer.props as {template?: TreeGrowthModelFields}).template;
    if (!template || seen.has(template)) continue;
    seen.add(template);
    const {wood, leaves, leafCount, lodLeafCounts, cropAnchors, limbs} = template;
    const woodBytes =
      wood.center.byteLength +
      wood.previous.byteLength +
      wood.radial.byteLength +
      wood.bark.byteLength +
      wood.shade.byteLength +
      wood.indices.byteLength;
    templates.push({
      key: template.key,
      leafCount,
      lodLeafCounts,
      woodVertices: wood.vertexCount,
      woodIndices: wood.indices.length,
      lodIndexCounts: wood.lodIndexCounts,
      lodVertexCounts: getVerticesReached(wood.indices, wood.vertexCount, wood.lodIndexCounts),
      bytes: woodBytes + leaves.byteLength + cropAnchors.byteLength + limbs.byteLength,
      woodBytes,
      leafBytes: leaves.byteLength
    });
  }
  return templates;
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

let loadStart = 0;
let firstFlush = {start: 0, end: 0};
const loadTimes = {moduleMs: 0, firstFrameMs: 0, firstFrameCpuMs: 0, firstFrameFlushMs: 0};

async function start(): Promise<void> {
  const implementation = (await import(
    /* @vite-ignore */ `./impl-${params.impl}.ts`
  )) as FieldImplementation;
  const field = createField();
  const paths = createPaths(field);
  const coordinates = getCoordinates();
  const parent = document.getElementById('app') as HTMLDivElement;
  parent.style.cssText = `width:${params.width}px;height:${params.height}px`;
  const firstCamera = paths['overview-hold'].getCamera(0);
  const view = createView(firstCamera.zoom, field);
  const ground = createGround(field);
  loadTimes.moduleMs = performance.now();
  await new Promise<void>((resolve, reject) => {
    loadStart = performance.now();
    const firstFrame: FrameInput = {
      path: 'load',
      frame: -3600,
      frameCount: 1,
      camera: firstCamera,
      transitions: null,
      picking: false
    };
    const layers = implementation.getFieldLayers(
      field.trees,
      getFrameState(firstFrame, field, coordinates)
    );
    const deck = new Deck({
      parent,
      width: params.width,
      height: params.height,
      useDevicePixels: params.dpr,
      deviceProps: {
        type: 'webgl',
        adapters: [webgl2Adapter],
        powerPreference: 'high-performance',
        webgl: {antialias: params.msaa > 0}
      },
      views: view,
      viewState: getViewState(firstCamera) as never,
      effects: [createLighting()],
      layers: ground ? [ground, ...layers] : layers,
      _animate: false,
      onDeviceInitialized(device) {
        instrumentContext((device as unknown as {gl: WebGL2RenderingContext}).gl);
      },
      onError(error) {
        errors.push(error.message);
        console.error(error); // eslint-disable-line no-console
        if (!bench) reject(error);
      },
      onHover(info) {
        picksAnswered++;
        if (info.object) pickHits++;
      },
      onAfterRender({gl}) {
        framesDrawn++;
        if (bench) return;
        // The first frame. Stop the loop and take over.
        const cpuEnd = performance.now();
        waitForGpu(gl as WebGL2RenderingContext);
        const end = performance.now();
        loadTimes.firstFrameMs = end - loadStart;
        loadTimes.firstFrameCpuMs = cpuEnd - loadStart;
        loadTimes.firstFrameFlushMs = end - cpuEnd;
        firstFlush = {start: cpuEnd, end};
        (deck as unknown as {animationLoop: {stop: () => void}}).animationLoop.stop();
        bench = {
          deck,
          gl: gl as WebGL2RenderingContext,
          field,
          paths,
          implementation,
          ground,
          view,
          viewFar: params.view === 'orbit' ? getOrbitFar(firstCamera.zoom, field) : 0,
          coordinates
        };
        resolve();
      }
    });
    setTimeout(() => {
      if (!bench) reject(new Error(`No first frame after 240 s. ${errors.join('; ')}`));
    }, 240 * 1000);
  });
}

const ready = start();

/** What `bench-field.mjs` and a person at the console use. */
const fieldBench = {
  ready,
  /** With `autorun`, resolves to that path's result. */
  autorun: params.autorun ? ready.then(() => runPath(String(params.autorun))) : null,
  settlePath,
  runPath,
  getInfo,
  getTemplates,
  getParams: () => params,
  getBench: () => bench,
  getErrors: () => errors,
  setDrawFilter,
  /** Draws one frame at a camera and waits for the GPU, outside any path. */
  drawAt(camera: FieldCamera) {
    const timing = {cpu: 0, total: 0, start: 0};
    drawFrame(
      {
        path: 'manual',
        frame: framesDrawn,
        frameCount: 1,
        camera,
        transitions: null,
        picking: false
      },
      timing
    );
    return {...timing, layers: copyTallies(), passes: JSON.parse(JSON.stringify(passTotals))};
  }
};
Object.assign(window, {fieldBench});
