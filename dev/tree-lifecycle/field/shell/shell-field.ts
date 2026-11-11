// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The far renderer's side of a field: its own state store with a row for every tree, laid out by cells of a coarse
 * grid, the hulls of each template, and the cells near the camera, whose trees go to a real `TreeLayer` at
 * `quality: 'photoreal'`. A cell hands over in both directions with a crossfade on the timeline: its hulls dissolve
 * while the photoreal trees' leaves come in, by the same curve.
 *
 * A frame in which only the camera moved costs one pass over the cells, about 2,600 of them for 20,000 trees, and no
 * work per tree. A path that changes trees costs a pass that compares each tree with what the store has.
 */

import {getTreeGrowthModel} from '../../../../modules/layers/src/tree-layer/tree-growth-model';
import {resolveTreeCharacteristics} from '../../../../modules/layers/src/tree-layer/tree-characteristics';
import {
  createTreeStateValues,
  TreeStateStore,
  type TreeStateUpdate,
  type TreeStateValues
} from '../../../../modules/layers/src/tree-layer/tree-state-store';
import type {TreeGrowthModel} from '../../../../modules/layers/src/tree-layer/tree-photoreal-layout';
import {
  fitShellHull,
  getShellStrip,
  SHELL_GRID_COARSE,
  SHELL_GRID_FINE,
  SHELL_GRID_TINY,
  SHELL_OPAQUE_TAU,
  SHELL_STAGES,
  type ShellGrid,
  type ShellHull
} from './shell-fit';
import type {ShellField, ShellHullLevel} from './shell-layer';

/** Trees a cell holds, across a row and along it. */
export const CELL_COLUMNS = 4;
export const CELL_ROWS = 2;
export const ROWS_PER_CELL = CELL_COLUMNS * CELL_ROWS;
const CELL_TEXTURE_WIDTH = 64;
const STUB_VERTICES = 14;
const METRES_PER_DEGREE = 111320;
const CANOPY_COLOR = [33, 112, 29, 255];
const TRUNK_COLOR = [112, 90, 60, 255];
/** Hold shell tiers through small changes in apparent width. */
const SHELL_LOD_EXIT_SCALE = 0.88;
/** A competing crown must have a visibly stronger claim to a resident's detailed slot. */
const NEAR_RESIDENT_PRIORITY = 1.12;
/** Selection can break a close tie without replacing a clearly larger foreground crown. */
const NEAR_SELECTED_PRIORITY = 1.1;
/** `TREE_PROPORTIONS.citrus[3]`: trunk radius per metre of height. */
const TRUNK_PER_HEIGHT = 0.025;

/** What the far side needs of a field tree. `FieldTree` from `../field` fits. */
export type ShellTree = {
  position: [number, number, number];
  height: number;
  crownRadius: number;
  characteristics: {seed: number};
  growth: number;
  health: number;
  foliage: number;
  row: number;
  column: number;
  flush?: number;
  lean?: [number, number];
  damage?: number;
  decay?: number;
  crop?: Record<string, unknown> | null;
};

/** A cell's hand-over. */
type CellState = {
  /** 1 drawn far, 0 drawn photoreal. */
  target: number;
  /** In metres from the field's middle. */
  east: number;
  north: number;
  trees: number[];
  /** Conservative sphere of the cell, including mature crowns and fallen trees, in metres. */
  up: number;
  radius: number;
  crownMetres: number;
  /** Last shell tier, retained while this cell is hidden or represented by detailed trees. */
  shellLevel: number;
};

/** A tree handed to the photoreal layer, with the leaf and bark shares in their color alphas. */
export type NearTree = {
  tree: ShellTree;
  spec: Record<string, unknown> & {canopyColor: number[]; trunkColor?: number[]};
  cell: number;
  /** Source row in the shared state store, independent of its index in the bounded near list. */
  stateRow: number;
  values?: TreeStateValues;
  lean?: [number, number];
};

export enum ShellVisibilityReason {
  Empty,
  Behind,
  OutsideHorizontal,
  OutsideVertical,
  Detailed,
  Tiny,
  Coarse,
  Fine
}

export enum ShellNearReason {
  Empty,
  Behind,
  OutsideView,
  BelowThreshold,
  Budget,
  Waiting,
  Detailed
}

export enum ShellNearPriority {
  EnclosesCamera = 1,
  RetainsSlot = 2,
  Selected = 4
}

/** Recorded by the two schedulers only while the playground inspector is open. */
export type ShellDiagnostics = {
  shellReasons: Uint8Array;
  nearReasons: Uint8Array;
  nearPixels: Float32Array;
  nearPriority: Float32Array;
  nearCoverage: Float32Array;
  nearFlags: Uint8Array;
};

export function createShellDiagnostics(length: number): ShellDiagnostics {
  return {
    shellReasons: new Uint8Array(length),
    nearReasons: new Uint8Array(length),
    nearPixels: new Float32Array(length),
    nearPriority: new Float32Array(length),
    nearCoverage: new Float32Array(length),
    nearFlags: new Uint8Array(length)
  };
}

export type ShellSetup = {
  field: ShellField;
  trees: ShellTree[];
  /** State row of each tree. */
  rowOf: Int32Array;
  cells: CellState[];
  cellsX: number;
  cellsY: number;
  /** Metres from the field's middle of each tree. */
  east: Float32Array;
  north: Float32Array;
  /** What each tree's row last had. */
  last: Float32Array;
  revision: number;
  stateRevision: number;
  boundsTweening: boolean;
  windOrigin: [number, number, number];
  windUnits: [number, number];
  keepers: NearTree[];
  near: NearTree[];
  nearByTree: Map<number, NearTree>;
  nearRevision: number;
  /** Cells handed over or on the way, in either direction. */
  active: Set<number>;
  /** Trees whose crowns are thin enough to dissolve, in all and by cell. */
  sparseTrees: Uint8Array;
  sparseByCell: Uint16Array;
  sparseCount: number;
  /** Each cell's bucket this frame, and how many cells each bucket has. */
  bucketOfCell: Int8Array;
  bucketCounts: Int32Array;
  diagnostics?: ShellDiagnostics;
  fadeSeconds: number;
  timings: {templatesMs: number; fitMs: number; storeMs: number};
};

/** The seed TreeLayer gives a tree from its position, and so its yaw, wind phase and crown. */
function getTreeSeed(position: ArrayLike<number>): number {
  return (
    ((Math.round(position[0] * 10000) * 92821) ^ (Math.round(position[1] * 10000) * 65537)) >>> 0
  );
}

const update: TreeStateUpdate = {
  position: [0, 0, 0],
  yaw: 0,
  windPhase: 0,
  crownX: 1,
  crownY: 1,
  height: 1,
  trunkHeight: 0,
  growth: 1,
  health: 1,
  foliage: 1,
  flush: 0,
  leanDegrees: 0,
  leanBearing: 0,
  damage: 0,
  decay: 0,
  canopyColor: CANOPY_COLOR,
  trunkColor: TRUNK_COLOR,
  trunkRadius: 0.1,
  windFlex: 1,
  coverage: 1,
  leafScale: 1,
  seed: 0
};
const rowOptions = {now: 0, clock: 0, isNew: false};
const LAST_FIELDS = 10;

/** Match the hull shader's optical estimate for the otherwise opaque case. */
function getShellOpticalDepth(
  hull: ShellHullLevel,
  template: number,
  growth: number,
  crown: number,
  height: number,
  leafScale: number
): number {
  const stages = SHELL_STAGES.length;
  let stage = stages - 2;
  while (stage > 0 && growth < SHELL_STAGES[stage]) stage--;
  const mix = Math.max(
    0,
    Math.min(1, (growth - SHELL_STAGES[stage]) / (SHELL_STAGES[stage + 1] - SHELL_STAGES[stage]))
  );
  const stride = hull.width * 4;
  const start = template * stages * stride;
  const offset = start + stage * stride;
  const read = (component: number) =>
    hull.data[offset + component] * (1 - mix) + hull.data[offset + stride + component] * mix;
  const leafArea = hull.data[start + 4] * read(0) * leafScale * leafScale;
  const halfWidth = Math.max(read(1) * crown, 0.01);
  const halfHeight = Math.max((read(3) - read(2)) * 0.5, 0.005) * height;
  return (0.375 * leafArea) / (Math.PI * halfWidth * halfHeight);
}

/** Writes one tree into the store as `TreeLayer.writeStateRows` would, and notes what it wrote. */
function writeTree(
  setup: ShellSetup,
  index: number,
  model: TreeGrowthModel,
  store: TreeStateStore
): void {
  const tree = setup.trees[index];
  const seed = getTreeSeed(tree.position);
  const crown = tree.crownRadius;
  const position = update.position as number[];
  position[0] = tree.position[0];
  position[1] = tree.position[1];
  position[2] = tree.position[2] ?? 0;
  update.yaw = ((((seed ^ (seed >>> 13)) & 0xffff) / 65535) * 360 * Math.PI) / 180;
  update.windPhase = (seed / 4294967296) * Math.PI * 2;
  update.crownX = crown * (1 + ((seed & 0xffff) / 65535 - 0.5) * 0.2);
  update.crownY = crown * (1 + (((seed >>> 16) & 0xffff) / 65535 - 0.5) * 0.2);
  update.height = tree.height;
  update.trunkHeight = model.forkZ * tree.height;
  update.leafScale = tree.height / model.referenceHeight;
  update.growth = clamp01(tree.growth, 1);
  update.health = clamp01(tree.health, 1);
  update.foliage = clamp01(tree.foliage, 1);
  update.flush = clamp01(tree.flush, 0);
  update.leanDegrees = Math.max(0, Math.min(90, tree.lean?.[0] ?? 0));
  update.leanBearing = tree.lean?.[1] ?? 0;
  update.damage = clamp01(tree.damage, 0);
  update.decay = clamp01(tree.decay, 0);
  update.trunkRadius = tree.height * TRUNK_PER_HEIGHT;
  update.seed = seed / 4294967296;
  store.setRow(setup.rowOf[index], update, rowOptions);
  // The GPU drops thin crowns from the opaque draw. Height, width and stage affect opacity
  // even at full foliage, so use the same fitted hull data to schedule the dissolve draw.
  let needsDissolve =
    (update.foliage as number) < 0.98 ||
    (update.damage as number) > 0 ||
    (update.decay as number) > 0 ||
    (update.growth as number) < 0.3;
  if (!needsDissolve) {
    const opticalDepth = getShellOpticalDepth(
      setup.field.levels[2],
      setup.field.templates[setup.rowOf[index]],
      update.growth as number,
      0.5 * ((update.crownX as number) + (update.crownY as number)),
      tree.height,
      update.leafScale as number
    );
    needsDissolve = opticalDepth * (update.foliage as number) < SHELL_OPAQUE_TAU;
  }
  const sparse = Number(needsDissolve);
  if (sparse !== setup.sparseTrees[index]) {
    const cell = Math.floor(setup.rowOf[index] / setup.field.rowsPerCell);
    setup.sparseTrees[index] = sparse;
    setup.sparseByCell[cell] += sparse ? 1 : -1;
    setup.sparseCount += sparse ? 1 : -1;
  }
  const last = setup.last;
  const o = index * LAST_FIELDS;
  last[o] = tree.height;
  last[o + 1] = tree.crownRadius;
  last[o + 2] = tree.growth;
  last[o + 3] = tree.health;
  last[o + 4] = tree.foliage;
  last[o + 5] = tree.flush ?? 0;
  last[o + 6] = tree.lean?.[0] ?? 0;
  last[o + 7] = tree.lean?.[1] ?? 0;
  last[o + 8] = tree.damage ?? 0;
  last[o + 9] = tree.decay ?? 0;
}

function clamp01(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : fallback;
}

function isChanged(setup: ShellSetup, index: number): boolean {
  const tree = setup.trees[index];
  const last = setup.last;
  const o = index * LAST_FIELDS;
  return (
    last[o] !== Math.fround(tree.height) ||
    last[o + 1] !== Math.fround(tree.crownRadius) ||
    last[o + 2] !== Math.fround(tree.growth) ||
    last[o + 3] !== Math.fround(tree.health) ||
    last[o + 4] !== Math.fround(tree.foliage) ||
    last[o + 5] !== Math.fround(tree.flush ?? 0) ||
    last[o + 6] !== Math.fround(tree.lean?.[0] ?? 0) ||
    last[o + 7] !== Math.fround(tree.lean?.[1] ?? 0) ||
    last[o + 8] !== Math.fround(tree.damage ?? 0) ||
    last[o + 9] !== Math.fround(tree.decay ?? 0)
  );
}

/** Refit cells only after tree state changes; camera frames reuse these conservative bounds. */
function updateCellBounds(setup: ShellSetup, keepPrevious = false): void {
  for (const cell of setup.cells) {
    if (!cell.trees.length) continue;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let diameter = 0;
    for (const index of cell.trees) {
      const tree = setup.trees[index];
      const height = Math.max(0.01, tree.height);
      const crown = Math.max(0.01, tree.crownRadius) * 1.35;
      const lean = Math.sin((Math.max(0, Math.min(90, tree.lean?.[0] ?? 0)) * Math.PI) / 180);
      // A fallen crown may lie a full tree height away from its root; damage scatters it farther.
      const reach = crown + height * lean + crown * Math.max(0, tree.damage ?? 0) * 0.3;
      const x = setup.east[index];
      const y = setup.north[index];
      const z = tree.position[2] ?? 0;
      minX = Math.min(minX, x - reach);
      maxX = Math.max(maxX, x + reach);
      minY = Math.min(minY, y - reach);
      maxY = Math.max(maxY, y + reach);
      minZ = Math.min(minZ, z - crown * 0.2);
      maxZ = Math.max(maxZ, z + height * 1.15 + crown * lean);
      diameter = Math.max(diameter, tree.crownRadius * 2 + height * lean);
    }
    const east = (minX + maxX) / 2;
    const north = (minY + maxY) / 2;
    const up = (minZ + maxZ) / 2;
    const radius = Math.hypot((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    cell.radius = keepPrevious
      ? Math.max(
          radius,
          cell.radius + Math.hypot(east - cell.east, north - cell.north, up - cell.up)
        )
      : radius;
    cell.east = east;
    cell.north = north;
    cell.up = up;
    cell.crownMetres = keepPrevious ? Math.max(diameter, cell.crownMetres) : diameter;
  }
}

/**
 * Everything, from the field's trees: the templates, their hulls, a store row per tree by cell, and the keepers that
 * hold the photoreal layer's templates and wind origin. `toMetres` gives a position's metres from the field's middle.
 */
export function createShellSetup(
  trees: ShellTree[],
  toMetres: (position: ArrayLike<number>) => [number, number],
  options: {
    fadeSeconds: number;
    lngLat: boolean;
    now: number;
    clock: number;
    /** One-by-one cells permit an exact per-tree near budget; the original prototype uses four-by-two. */
    cellColumns?: number;
    cellRows?: number;
  }
): ShellSetup {
  const started = performance.now();
  // Templates, in the order seeds first appear.
  const seeds: number[] = [];
  const templateOfSeed = new Map<number, number>();
  for (const tree of trees) {
    const seed = tree.characteristics.seed;
    if (!templateOfSeed.has(seed)) {
      templateOfSeed.set(seed, seeds.length);
      seeds.push(seed);
    }
  }
  const models = seeds.map(seed =>
    getTreeGrowthModel('citrus', resolveTreeCharacteristics({seed}))
  );
  const templatesDone = performance.now();
  const fine = getHullLevel(
    models.map(model => fitShellHull(model, SHELL_GRID_FINE)),
    SHELL_GRID_FINE
  );
  const coarse = getHullLevel(
    models.map(model => fitShellHull(model, SHELL_GRID_COARSE)),
    SHELL_GRID_COARSE
  );
  const tiny = getHullLevel(
    models.map(model => fitShellHull(model, SHELL_GRID_TINY)),
    SHELL_GRID_TINY
  );
  const fitDone = performance.now();

  // Cells of the field's grid, and each tree's row by its cell.
  let columns = 0;
  let rows = 0;
  for (const tree of trees) {
    columns = Math.max(columns, tree.column + 1);
    rows = Math.max(rows, tree.row + 1);
  }
  const cellColumns = Math.max(1, Math.floor(options.cellColumns ?? CELL_COLUMNS));
  const cellRows = Math.max(1, Math.floor(options.cellRows ?? CELL_ROWS));
  const rowsPerCell = cellColumns * cellRows;
  const cellsX = Math.ceil(columns / cellColumns);
  const cellsY = Math.ceil(rows / cellRows);
  const cellCount = cellsX * cellsY;
  const rowCount = cellCount * rowsPerCell;
  const rowOf = new Int32Array(trees.length);
  const templates = new Float32Array(rowCount).fill(-1);
  const east = new Float32Array(trees.length);
  const north = new Float32Array(trees.length);
  const cells: CellState[] = Array.from({length: cellCount}, () => ({
    target: 1,
    east: 0,
    north: 0,
    trees: [],
    up: 0,
    radius: 0,
    crownMetres: 0,
    shellLevel: 0
  }));
  trees.forEach((tree, index) => {
    const cellX = Math.floor(tree.column / cellColumns);
    const cellY = Math.floor(tree.row / cellRows);
    const cell = cellY * cellsX + cellX;
    const slot = (tree.row % cellRows) * cellColumns + (tree.column % cellColumns);
    const row = cell * rowsPerCell + slot;
    rowOf[index] = row;
    templates[row] = templateOfSeed.get(tree.characteristics.seed) ?? 0;
    const [x, y] = toMetres(tree.position);
    east[index] = x;
    north[index] = y;
    cells[cell].trees.push(index);
  });
  for (const cell of cells) {
    if (!cell.trees.length) continue;
    let x = 0;
    let y = 0;
    for (const index of cell.trees) {
      x += east[index];
      y += north[index];
    }
    cell.east = x / cell.trees.length;
    cell.north = y / cell.trees.length;
  }

  const store = new TreeStateStore(rowCount);
  const cellHeight = Math.ceil(cellCount / CELL_TEXTURE_WIDTH);
  const cellData = new Float32Array(CELL_TEXTURE_WIDTH * cellHeight * 4);
  for (let cell = 0; cell < cellCount; cell++) {
    cellData[cell * 4] = -1e9;
    cellData[cell * 4 + 1] = 1;
    cellData[cell * 4 + 2] = 1;
    cellData[cell * 4 + 3] = options.fadeSeconds;
  }
  const field: ShellField = {
    store,
    templates,
    levels: [tiny, coarse, fine],
    cells: cellData,
    cellWidth: CELL_TEXTURE_WIDTH,
    cellHeight,
    rowsPerCell,
    cellsRevision: 0,
    order: new Float32Array(CELL_TEXTURE_WIDTH * cellHeight),
    orderWidth: CELL_TEXTURE_WIDTH,
    bucketStarts: new Int32Array(7),
    orderRevision: 0,
    forkZ: models[0].forkZ,
    models
  };

  // The photoreal layer measures gusts from its first tree. Its keepers come first, one per template, out of
  // sight a little way off, so that it keeps its templates and the far trees can measure from the same place.
  const keeperPosition = trees[0].position;
  const keeperLatitude = options.lngLat ? keeperPosition[1] - 0.02 : keeperPosition[1] - 2000;
  const origin: [number, number, number] = [keeperPosition[0], keeperLatitude, 0];
  const keepers: NearTree[] = seeds.map(seed => ({
    tree: {...trees[0], position: origin, characteristics: {seed}},
    spec: {
      position: origin,
      species: 'citrus',
      height: trees[0].height,
      crownRadius: trees[0].crownRadius,
      characteristics: {seed},
      growth: 1,
      health: 1,
      foliage: 1,
      canopyColor: [...CANOPY_COLOR]
    },
    cell: -1,
    stateRow: -1
  }));

  const setup: ShellSetup = {
    field,
    trees,
    rowOf,
    cells,
    cellsX,
    cellsY,
    east,
    north,
    last: new Float32Array(trees.length * LAST_FIELDS),
    revision: Number.NaN,
    stateRevision: 0,
    boundsTweening: false,
    windOrigin: origin,
    windUnits: options.lngLat
      ? [METRES_PER_DEGREE * Math.cos((origin[1] * Math.PI) / 180), METRES_PER_DEGREE]
      : [1, 1],
    keepers,
    near: [...keepers],
    nearByTree: new Map(),
    nearRevision: 0,
    active: new Set(),
    sparseTrees: new Uint8Array(trees.length),
    sparseByCell: new Uint16Array(cellCount),
    sparseCount: 0,
    bucketOfCell: new Int8Array(cellCount),
    bucketCounts: new Int32Array(6),
    fadeSeconds: options.fadeSeconds,
    timings: {templatesMs: templatesDone - started, fitMs: fitDone - templatesDone, storeMs: 0}
  };
  updateCellBounds(setup);
  rowOptions.now = options.now;
  rowOptions.clock = options.clock;
  const storeStart = performance.now();
  for (let index = 0; index < trees.length; index++) {
    writeTree(setup, index, models[templates[rowOf[index]]], store);
  }
  setup.timings.storeMs = performance.now() - storeStart;
  return setup;
}

/** All templates' hulls of one grid in one texture, and the grid's strip: hull, a join, and the stub's six sides. */
function getHullLevel(hulls: ShellHull[], grid: ShellGrid): ShellHullLevel {
  const {lineTexels, vertexCount} = hulls[0];
  const data = new Float32Array(hulls.length * SHELL_STAGES.length * lineTexels * 4);
  hulls.forEach((hull, index) => data.set(hull.data, index * hull.data.length));
  const hull = Array.from(getShellStrip(grid));
  const stub: number[] = [];
  for (let k = 0; k < STUB_VERTICES; k++) stub.push(vertexCount + k);
  // The join keeps the stub's first triangle facing out, as the hull's first does.
  const strip = Uint16Array.from([...hull, hull[hull.length - 1], stub[0], ...stub]);
  return {
    data,
    width: lineTexels,
    height: hulls.length * SHELL_STAGES.length,
    vertices: vertexCount,
    strip
  };
}

/** Brings the store up to what the trees say, if a path changed any. */
export function syncShellTrees(
  setup: ShellSetup,
  revision: number,
  transitions: Record<string, unknown> | null,
  now: number,
  clock: number
): number {
  const {store} = setup.field;
  store.setTransitions(transitions as never);
  let changed = 0;
  if (revision !== setup.revision) {
    setup.revision = revision;
    rowOptions.now = now;
    rowOptions.clock = clock;
    const {trees, rowOf, field} = setup;
    let boundsChanged = false;
    for (let index = 0; index < trees.length; index++) {
      if (!isChanged(setup, index)) continue;
      const tree = trees[index];
      const o = index * LAST_FIELDS;
      boundsChanged ||=
        setup.last[o] !== Math.fround(tree.height) ||
        setup.last[o + 1] !== Math.fround(tree.crownRadius) ||
        setup.last[o + 6] !== Math.fround(tree.lean?.[0] ?? 0) ||
        setup.last[o + 8] !== Math.fround(tree.damage ?? 0);
      writeTree(setup, index, field.models[field.templates[rowOf[index]]], store);
      changed++;
    }
    if (boundsChanged) {
      setup.boundsTweening = store.activeTweenCount > 0;
      updateCellBounds(setup, setup.boundsTweening);
    }
  }
  const tick = store.tick(now, clock);
  if (tick.changed) setup.stateRevision++;
  if (setup.boundsTweening && !tick.active) {
    setup.boundsTweening = false;
    updateCellBounds(setup);
  }
  return changed;
}

/** What the camera sees of the field, in metres from its middle. */
export type ShellView = {
  position: [number, number, number];
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  /** Pixels of a metre a metre away, and tangents of half the field of view. */
  focal: number;
  tanX: number;
  tanY: number;
};

export type ShellNearOptions = {
  /** A cell goes to photoreal when its nearest tree is this many pixels across, and back below `out`. */
  in: number;
  out: number;
  /** At most this many photoreal trees including departures still fading, prioritizing the view. */
  most: number;
  /** Prefer this source tree over comparably sized crowns while it intersects the view. */
  selectedIndex?: number;
  /** A hand-over is through by this many times the size it began at, however fast the camera comes. */
  fullAt: number;
  /** The playground keeps the timed fade even across a large zoom change. */
  accelerateBySize?: boolean;
  /** Size of a tree, in metres, for the test. */
  treeMetres: number;
  now: number;
};

/**
 * Hands cells over by the camera. Returns whether the photoreal layer's trees changed, by membership or by the
 * share of their leaves. One pass over the cells, and work per tree only for those near.
 */
export function updateShellNear(
  setup: ShellSetup,
  view: ShellView,
  options: ShellNearOptions
): boolean {
  const {cells, field, active, diagnostics} = setup;
  const time = options.now;
  const budget = Math.max(0, Math.floor(options.most));
  const [cx, cy, cz] = view.position;
  const [fx, fy, fz] = view.forward;
  const [rx, ry, rz] = view.right;
  const [ux, uy, uz] = view.up;
  // A sphere's support along a side plane is radius * sqrt(1 + tan(fov / 2)^2).
  // Fixed multipliers can reject visible crowns in wide views and admit too much behind the camera.
  const sideX = Math.hypot(1, view.tanX);
  const sideY = Math.hypot(1, view.tanY);
  let wanted: {cell: number; priority: number; distanceSquared: number; tier: number}[] | null =
    null;
  let membership = false;
  for (let cell = 0; cell < cells.length; cell++) {
    const state = cells[cell];
    if (diagnostics) {
      diagnostics.nearReasons[cell] = ShellNearReason.Empty;
      diagnostics.nearPixels[cell] = 0;
      diagnostics.nearPriority[cell] = 0;
      diagnostics.nearCoverage[cell] = 0;
      diagnostics.nearFlags[cell] = 0;
    }
    if (!state.trees.length) continue;
    const cellRadius = state.radius;
    const dx = state.east - cx;
    const dy = state.north - cy;
    const dz = state.up - cz;
    const depth = dx * fx + dy * fy + dz * fz;
    const width = state.crownMetres * view.focal;
    // A crown's projected size depends on view depth, not its radial distance from the eye.
    // The front of the safety sphere lets a cell enter before its closest branches fill the view.
    const size = width / Math.max(depth - cellRadius, 0.5);
    const isNear = state.target === 0;
    const threshold = isNear ? options.out : options.in;
    let wants = size >= threshold;
    let x = 0;
    let y = 0;
    if (wants || diagnostics) {
      // In view, or about to be.
      const margin = cellRadius * (isNear ? 1.6 : 1.0);
      x = dx * rx + dy * ry + dz * rz;
      y = dx * ux + dy * uy + dz * uz;
      const behind = depth <= -margin;
      const inView =
        !behind &&
        Math.abs(x) <= depth * view.tanX + margin * sideX &&
        Math.abs(y) <= depth * view.tanY + margin * sideY;
      if (diagnostics) {
        diagnostics.nearPixels[cell] = behind ? 0 : width / Math.max(depth, 0.5);
        diagnostics.nearReasons[cell] = behind
          ? ShellNearReason.Behind
          : !inView
            ? ShellNearReason.OutsideView
            : wants
              ? ShellNearReason.Budget
              : ShellNearReason.BelowThreshold;
      }
      wants &&= inView;
    }
    if (wants) {
      wanted ??= [];
      // While walking through a crown, its centre may pass behind the camera while its leaves
      // remain directly in front. Only the tighter crown region gets this priority.
      const radius = Math.max(1e-3, Math.min(cellRadius, state.crownMetres * 0.5));
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const enclosing = distanceSquared <= radius * radius;
      // A center within the view has full weight. Ease out only as the crown crosses a side
      // plane, so large, nearby crowns at the edge do not lose detail to smaller central ones.
      const coverageX = Math.max(
        0,
        1 - Math.max(0, Math.abs(x) - depth * view.tanX) / (radius * sideX)
      );
      const coverageY = Math.max(
        0,
        1 - Math.max(0, Math.abs(y) - depth * view.tanY) / (radius * sideY)
      );
      const coverage = enclosing ? 1 : depth > 0 ? coverageX * coverageY : 0;
      const selected =
        coverage > 0 &&
        options.selectedIndex !== undefined &&
        state.trees.includes(options.selectedIndex);
      const pixels = width / Math.max(enclosing ? Math.sqrt(distanceSquared) : depth, 0.5);
      const priority =
        pixels *
        coverage *
        (isNear ? NEAR_RESIDENT_PRIORITY : 1) *
        (selected ? NEAR_SELECTED_PRIORITY : 1);
      if (diagnostics) {
        diagnostics.nearPriority[cell] = priority;
        diagnostics.nearCoverage[cell] = coverage;
        diagnostics.nearFlags[cell] =
          (enclosing ? ShellNearPriority.EnclosesCamera : 0) |
          (isNear ? ShellNearPriority.RetainsSlot : 0) |
          (selected ? ShellNearPriority.Selected : 0);
      }
      wanted.push({cell, priority, distanceSquared, tier: Number(enclosing)});
    } else if (isNear) {
      startCellFade(setup, cell, 1, time);
      membership = true;
    }
  }
  if (wanted) {
    wanted.sort(
      (a, b) =>
        b.tier - a.tier ||
        b.priority - a.priority ||
        a.distanceSquared - b.distanceSquared ||
        a.cell - b.cell
    );
    let trees = 0;
    let resident = setup.nearByTree.size;
    for (const {cell} of wanted) {
      const state = cells[cell];
      if (trees + state.trees.length > budget) {
        if (state.target === 0) {
          startCellFade(setup, cell, 1, time);
          membership = true;
        }
        continue;
      }
      trees += state.trees.length;
      if (state.target !== 0) {
        let incoming = 0;
        for (const index of state.trees) if (!setup.nearByTree.has(index)) incoming++;
        // Departures keep their geometry until their shells are opaque. New cells stay entirely
        // on shells until that space is free, so a fast dive cannot exceed the near-tree budget.
        if (resident + incoming > budget) {
          if (diagnostics) diagnostics.nearReasons[cell] = ShellNearReason.Waiting;
          continue;
        }
        startCellFade(setup, cell, 0, time);
        resident += incoming;
        membership = true;
      }
      if (diagnostics) diagnostics.nearReasons[cell] = ShellNearReason.Detailed;
    }
  }

  // Cells on their way: their trees' leaves come in as the hulls go, and those back to far leave at the end. A fade
  // goes on by the clock, or by how far the cell has grown on screen past where it began, whichever is ahead: a
  // slow approach takes the whole fade, and a fast dive is through it by `fullAt` times the size it began at.
  let leaves = false;
  for (const cell of active) {
    const state = cells[cell];
    const cellRadius = state.radius;
    const data = field.cells;
    const ex = state.east - cx;
    const ey = state.north - cy;
    const ez = state.up - cz;
    const depth = ex * fx + ey * fy + ez * fz;
    const size = (state.crownMetres * view.focal) / Math.max(depth - cellRadius, 0.5);
    const towardNear = state.target === 0;
    const bySize =
      options.accelerateBySize === false
        ? 0
        : towardNear
          ? (size - options.in) / (options.in * (options.fullAt - 1))
          : (options.out - size) / (options.out * (1 - 1 / options.fullAt));
    const from = data[cell * 4 + 1];
    const to = data[cell * 4 + 2];
    const span = Math.abs(to - from);
    if (span > 0 && bySize > 0) {
      // As far along as the size says, of the whole way from 1 to 0 or back, from where this fade began.
      const wanted = Math.min(Math.max(bySize, 0), 1);
      const along = towardNear ? 1 - wanted : wanted;
      // A reversed fade may start farther along than the size curve. In that case the timer
      // advances normally, without treating the backwards distance as forward progress.
      const done = Math.min(Math.max((along - from) * Math.sign(to - from), 0), span);
      const start = time - done * data[cell * 4 + 3];
      if (
        start < data[cell * 4] &&
        done > Math.min((time - data[cell * 4]) / data[cell * 4 + 3], span)
      ) {
        data[cell * 4] = start;
        field.cellsRevision++;
      }
    }
    const fade = getCellFade(field.cells, cell, time);
    const alpha = Math.round((1 - fade) * 255);
    for (const index of cells[cell].trees) {
      const near = setup.nearByTree.get(index);
      if (near && near.spec.canopyColor[3] !== alpha) {
        near.spec.canopyColor[3] = alpha;
        if (near.spec.trunkColor) near.spec.trunkColor[3] = alpha;
        leaves = true;
      }
    }
    const target = cells[cell].target;
    if (fade === target) {
      active.delete(cell);
      if (target === 1) {
        for (const index of cells[cell].trees) setup.nearByTree.delete(index);
        membership = true;
      }
    }
  }
  if (membership) {
    setup.near = [...setup.keepers, ...setup.nearByTree.values()];
  }
  if (membership || leaves) setup.nearRevision++;
  return membership || leaves;
}

function getCellFade(data: Float32Array, cell: number, time: number): number {
  const start = data[cell * 4];
  const from = data[cell * 4 + 1];
  const to = data[cell * 4 + 2];
  const seconds = data[cell * 4 + 3];
  const span = to - from;
  const moved = Math.min(Math.max((time - start) / Math.max(seconds, 1e-3), 0), Math.abs(span));
  return from + Math.sign(span) * moved;
}

/** Starts a cell toward far (1) or photoreal (0), from wherever it is. */
function startCellFade(setup: ShellSetup, cell: number, target: number, time: number): void {
  const {field, cells} = setup;
  const data = field.cells;
  const from = getCellFade(data, cell, time);
  data[cell * 4] = time;
  data[cell * 4 + 1] = from;
  data[cell * 4 + 2] = target;
  data[cell * 4 + 3] = setup.fadeSeconds;
  field.cellsRevision++;
  cells[cell].target = target;
  setup.active.add(cell);
  if (target === 0) {
    const alpha = Math.round((1 - from) * 255);
    for (const index of cells[cell].trees) {
      if (setup.nearByTree.has(index)) continue;
      const tree = setup.trees[index];
      setup.nearByTree.set(index, {
        tree,
        spec: {
          position: tree.position,
          species: 'citrus',
          height: tree.height,
          crownRadius: tree.crownRadius,
          characteristics: tree.characteristics,
          growth: tree.growth,
          health: tree.health,
          foliage: tree.foliage,
          crop: null,
          canopyColor: [CANOPY_COLOR[0], CANOPY_COLOR[1], CANOPY_COLOR[2], alpha],
          trunkColor: [TRUNK_COLOR[0], TRUNK_COLOR[1], TRUNK_COLOR[2], alpha]
        },
        cell,
        stateRow: setup.rowOf[index]
      });
    }
  }
}

/** The spec a photoreal tree is drawn with: its tree's numbers as they are now. */
export function getNearSpec(near: NearTree, store?: TreeStateStore): Record<string, unknown> {
  const {tree, spec} = near;
  if (near.cell >= 0) {
    if (store && near.stateRow >= 0) {
      // The near list may reuse any data index after a hand-over. Read the original source row's
      // already-tweened state, so a new near tree cannot morph from a previous occupant's pose.
      near.values ??= createTreeStateValues();
      const values = store.getRowValues(near.stateRow, near.values);
      const seed = getTreeSeed(tree.position);
      const crownScale = 1 + ((seed & 0xffff) / 65535 - 0.5) * 0.2;
      spec.position = values.position;
      spec.height = values.height;
      spec.crownRadius = values.crownX / crownScale;
      spec.growth = values.growth;
      spec.health = values.health;
      spec.foliage = values.foliage;
      spec.flush = values.flush;
      near.lean ??= [0, 0];
      const lean = near.lean;
      lean[0] = values.leanDegrees;
      lean[1] = values.leanBearing;
      spec.lean = lean;
      spec.damage = values.damage;
      spec.decay = values.decay;
      spec.crop = tree.crop;
      return spec;
    }
    spec.height = tree.height;
    spec.crownRadius = tree.crownRadius;
    spec.growth = tree.growth;
    spec.health = tree.health;
    spec.foliage = tree.foliage;
    spec.flush = tree.flush;
    spec.lean = tree.lean;
    spec.damage = tree.damage;
    spec.decay = tree.decay;
    spec.crop = tree.crop;
  }
  return spec;
}

export type ShellBucketOptions = {
  /** Crown widths, in pixels, from which a cell takes the coarse hull, and the fine one. */
  coarsePixels: number;
  finePixels: number;
  crownMetres: number;
  /** Timeline seconds. */
  now: number;
  /** Metres beyond the view a cell still counts, for what it casts into it. */
  margin: number;
  /** Debug comparison that submits every shell and leaves clipping to the GPU. */
  bypassFrustum?: boolean;
};

/**
 * Sorts this frame's cells into buckets by level and by whether they may dissolve, skipping those out of view and
 * those photoreal has. One pass over the cells; the GPU then works only on the trees of the cells drawn.
 */
export function updateShellBuckets(
  setup: ShellSetup,
  view: ShellView,
  options: ShellBucketOptions
): void {
  const {cells, field, bucketOfCell, bucketCounts} = setup;
  const reasons = setup.diagnostics?.shellReasons;
  const [cx, cy, cz] = view.position;
  const [fx, fy, fz] = view.forward;
  const [rx, ry, rz] = view.right;
  const [ux, uy, uz] = view.up;
  const sideX = Math.hypot(1, view.tanX);
  const sideY = Math.hypot(1, view.tanY);
  // While anything tweens, any crown may be thin.
  const allSparse = field.store.activeTweenCount > 0;
  bucketCounts.fill(0);
  for (let cell = 0; cell < cells.length; cell++) {
    bucketOfCell[cell] = -1;
    const state = cells[cell];
    if (!state.trees.length) {
      if (reasons) reasons[cell] = ShellVisibilityReason.Empty;
      continue;
    }
    const margin = state.radius + options.margin;
    // The cell's fade, as getCellFade, inline: a call with doubles that V8 does not inline boxes them.
    const data = field.cells;
    const span = data[cell * 4 + 2] - data[cell * 4 + 1];
    const moved = Math.min(
      Math.max((options.now - data[cell * 4]) / Math.max(data[cell * 4 + 3], 1e-3), 0),
      Math.abs(span)
    );
    const fade = data[cell * 4 + 1] + Math.sign(span) * moved;
    if (fade <= 0) {
      if (reasons) reasons[cell] = ShellVisibilityReason.Detailed;
      continue;
    }
    const dx = state.east - cx;
    const dy = state.north - cy;
    const dz = state.up - cz;
    const depth = dx * fx + dy * fy + dz * fz;
    if (!options.bypassFrustum) {
      if (depth < -margin) {
        if (reasons) reasons[cell] = ShellVisibilityReason.Behind;
        continue;
      }
      const x = dx * rx + dy * ry + dz * rz;
      const y = dx * ux + dy * uy + dz * uz;
      if (Math.abs(x) > depth * view.tanX + margin * sideX) {
        if (reasons) reasons[cell] = ShellVisibilityReason.OutsideHorizontal;
        continue;
      }
      if (Math.abs(y) > depth * view.tanY + margin * sideY) {
        if (reasons) reasons[cell] = ShellVisibilityReason.OutsideVertical;
        continue;
      }
    }
    // Perspective pixel scale is set by view-space depth. Radial distance would reduce the
    // apparent width of the same crown merely for being near a wide view's edge.
    const crownPixels = (state.crownMetres * view.focal) / Math.max(depth, 1);
    const fine = options.finePixels * (state.shellLevel === 2 ? SHELL_LOD_EXIT_SCALE : 1);
    const coarse = options.coarsePixels * (state.shellLevel > 0 ? SHELL_LOD_EXIT_SCALE : 1);
    const level = crownPixels >= fine ? 2 : crownPixels >= coarse ? 1 : 0;
    state.shellLevel = level;
    const dissolve = fade < 1 || allSparse || setup.sparseByCell[cell] > 0 ? 3 : 0;
    const bucket = level + dissolve;
    bucketOfCell[cell] = bucket;
    if (reasons) reasons[cell] = ShellVisibilityReason.Tiny + level;
    bucketCounts[bucket]++;
  }
  const {order, bucketStarts} = field;
  let changed = false;
  let start = 0;
  for (let bucket = 0; bucket < 6; bucket++) {
    if (bucketStarts[bucket] !== start) changed = true;
    bucketStarts[bucket] = start;
    start += bucketCounts[bucket];
  }
  if (bucketStarts[6] !== start) changed = true;
  bucketStarts[6] = start;
  // Reuse the counts as write positions.
  for (let bucket = 0; bucket < 6; bucket++) bucketCounts[bucket] = bucketStarts[bucket];
  for (let cell = 0; cell < cells.length; cell++) {
    const bucket = bucketOfCell[cell];
    if (bucket < 0) continue;
    const at = bucketCounts[bucket]++;
    if (order[at] !== cell) {
      order[at] = cell;
      changed = true;
    }
  }
  if (changed) field.orderRevision++;
}
