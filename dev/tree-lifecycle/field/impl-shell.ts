// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Procedural crown shells. A far tree is a low-poly hull of its crown's own outline, fitted per template and growth
 * stage from the template's leaves, with a stub of trunk: 10, 36 or 100 triangles by its size on screen, lit per
 * vertex when small and per pixel when large, where a darker core and an outer hull drawn as ~4 px leaves give it a
 * ragged, leafy edge. A soft patch of shadow on the ground stands in for its shadow. Trees near the camera are a
 * real `TreeLayer` at `quality: 'photoreal'`, on the trees of the cells of a coarse grid near enough, and a cell
 * hands over with a crossfade: its hulls dissolve as the photoreal leaves come in by the same curve. See `shell/`.
 *
 * Per frame: one pass over the cells in JavaScript (hand-overs, and which cells to draw at which level), one
 * transform-feedback pass that works out every drawn tree from its state row, and instanced draws by bucket.
 *
 * Knobs, as URL parameters (`--name value` to the bench):
 *   near=0          no photoreal trees at all, only shells
 *   nearIn=PX       a cell goes photoreal when its nearest tree's crown is this many pixels across. @default 260
 *   nearOut=PX      and back below this. @default 200
 *   nearMost=N      photoreal trees at most. @default 160
 *   fade=S          seconds of a hand-over; it also completes by fullAt times nearIn on screen. @default 0.45
 *   cast=1          hulls also draw into deck.gl's shadow map (then set groundShadow=0). @default 0
 *   groundShadow=D  darkness of the far trees' own patches of shadow on the ground, 0 for none. @default 0.42
 *   tinyPixels, finePixels  crown widths at which a tree takes the 36- and the 100-triangle hull. @default 12, 40
 *   lifecycle=1     trees of the middle row take a set of lifecycle states, and no other tree grows
 *   photorealAll=1  every tree drawn by the real TreeLayer instead, as a reference at the same cameras
 *   mottle, gap, spec, gain, tintR/G/B, glow, core, coreDark, leafShare, leafPixels, outer, fineGain, rimThin,
 *   leafUp: the look's constants, calibrated against photoreal with `shell/compare.mjs`
 */

import type {LayersList} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import type {FieldFrame, FieldTree} from './field';
import {
  createShellDiagnostics,
  createShellSetup,
  getNearSpec,
  syncShellTrees,
  updateShellBuckets,
  updateShellNear,
  type NearTree,
  type ShellBucketOptions,
  type ShellNearOptions,
  type ShellSetup,
  type ShellView
} from './shell/shell-field';
import {ShellLayer} from './shell/shell-layer';
import {updateShellView} from './shell/shell-view';

let setup: ShellSetup | null = null;
let farData: unknown[] = [];
let cropRows: NearTree[] = [];
let cropRevision = 0;
const cropByTree = new Map<number, NearTree>();
const CROP_TREE_BUDGET = 256;
const CROP_MIN_PIXELS = 0.45;
const CROP_VIEW_VECTORS = ['position', 'forward', 'right', 'up'] as const;
const cropViewKey = new Float64Array(15);
let cropSelectionSetup: ShellSetup | null = null;
let cropSourceRevision = -1;
let cropStateRevision = -1;
let cropSelectionBudget = -1;
let scheduledField: ShellSetup | null = null;
let scheduledDiagnostics: ShellSetup['diagnostics'];
let scheduledKey = '';
const stats = {nearCount: 0, cropCount: 0, visibleCount: 0, totalCount: 0, prepareMs: 0};

/** Live counts for the interactive field, shared to avoid allocating on every frame. */
export function getFieldStats(): typeof stats {
  return stats;
}

export function getFieldSetup(): ShellSetup | null {
  return setup;
}
const view: ShellView = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  focal: 1,
  tanX: 1,
  tanY: 1
};

/**
 * Wind animates the draws without moving the scheduler's bounds. Once a stationary view has
 * settled, reuse its ordering until a camera, edit, budget or inspector change.
 */
function scheduleField(
  current: ShellSetup,
  frame: FieldFrame,
  near: ShellNearOptions | null,
  buckets: ShellBucketOptions,
  reuse: boolean
): void {
  if (!reuse) {
    if (near) updateShellNear(current, view, near);
    updateShellBuckets(current, view, buckets);
    scheduledField = null;
    return;
  }
  const {camera, params} = frame;
  const key = [
    camera.east,
    camera.north,
    camera.up,
    camera.zoom,
    camera.pitch,
    camera.bearing,
    params.width,
    params.height,
    params.dpr,
    current.revision,
    current.stateRevision,
    current.field.cellsRevision,
    current.boundsTweening,
    near?.in,
    near?.out,
    near?.most,
    near?.selectedIndex,
    near?.fullAt,
    buckets.coarsePixels,
    buckets.finePixels,
    buckets.margin,
    buckets.bypassFrustum
  ].join(',');
  const settled = !current.active.size && !current.field.store.activeTweenCount;
  if (
    settled &&
    current === scheduledField &&
    current.diagnostics === scheduledDiagnostics &&
    key === scheduledKey
  ) {
    return;
  }
  const {nearRevision} = current;
  if (near) updateShellNear(current, view, near);
  updateShellBuckets(current, view, buckets);
  // A fade may finish in this call, freeing a slot for a waiting tree next frame.
  scheduledField =
    settled && !current.active.size && current.nearRevision === nearRevision ? current : null;
  scheduledDiagnostics = current.diagnostics;
  scheduledKey = key;
}

const getNearTree = (near: NearTree) => getNearSpec(near, setup?.field.store);
/** Fruit has one owner while the full canopy comes and goes. */
const getCanopyTree = (near: NearTree) => {
  const spec = getNearTree(near);
  spec.crop = null;
  return spec;
};

/**
 * Crops remain useful after a crown becomes a shell. Select a small, stable set by their actual size
 * on screen, independent of the expensive canopy's residency and detail governor.
 */
function updateCropRows(current: ShellSetup, revision: number, budget: number): void {
  let changed =
    current !== cropSelectionSetup ||
    revision !== cropSourceRevision ||
    current.stateRevision !== cropStateRevision ||
    budget !== cropSelectionBudget;
  let offset = 0;
  for (const vector of CROP_VIEW_VECTORS) {
    for (const value of view[vector]) {
      if (cropViewKey[offset] !== value) changed = true;
      cropViewKey[offset++] = value;
    }
  }
  if (
    cropViewKey[12] !== view.focal ||
    cropViewKey[13] !== view.tanX ||
    cropViewKey[14] !== view.tanY
  ) {
    changed = true;
  }
  if (!changed) return;
  cropViewKey[12] = view.focal;
  cropViewKey[13] = view.tanX;
  cropViewKey[14] = view.tanY;
  cropSelectionSetup = current;
  cropSourceRevision = revision;
  cropStateRevision = current.stateRevision;
  cropSelectionBudget = budget;

  const wanted: {index: number; pixels: number}[] = [];
  const [cx, cy, cz] = view.position;
  const [fx, fy, fz] = view.forward;
  const [rx, ry, rz] = view.right;
  const [ux, uy, uz] = view.up;
  const sideSupport = Math.hypot(1, view.tanX);
  const topSupport = Math.hypot(1, view.tanY);
  for (const cell of budget > 0 ? current.cells : []) {
    const dx = cell.east - cx;
    const dy = cell.north - cy;
    const dz = cell.up - cz;
    const depth = dx * fx + dy * fy + dz * fz;
    const margin = cell.radius;
    if (
      depth < -margin ||
      Math.abs(dx * rx + dy * ry + dz * rz) > depth * view.tanX + margin * sideSupport ||
      Math.abs(dx * ux + dy * uy + dz * uz) > depth * view.tanY + margin * topSupport
    ) {
      continue;
    }
    const distance = Math.max(Math.hypot(dx, dy, dz) - margin, 0.5);
    for (const index of cell.trees) {
      const crop = current.trees[index].crop;
      if (!crop) continue;
      const configs = Array.isArray(crop) ? crop : [crop];
      let radius = 0;
      for (const config of configs) {
        if (Number(config.count) > 0 || Number(config.droppedCount) > 0) {
          radius = Math.max(radius, Number(config.radius) || 0);
        }
      }
      const pixels = (radius * view.focal) / distance;
      // Hold a resident just below the threshold so small camera movements do not churn the list.
      if (pixels >= CROP_MIN_PIXELS * (cropByTree.has(index) ? 0.8 : 1)) {
        wanted.push({index, pixels});
      }
    }
  }
  wanted.sort((a, b) => b.pixels - a.pixels || a.index - b.index);
  wanted.length = Math.min(wanted.length, Math.max(0, Math.floor(budget)));
  wanted.sort((a, b) => a.index - b.index);
  const next: NearTree[] = [];
  for (const {index} of wanted) {
    let row = cropByTree.get(index);
    if (!row) {
      const tree = current.trees[index];
      row = {
        tree,
        spec: {...tree, canopyColor: [33, 112, 29, 255]},
        cell: Math.floor(current.rowOf[index] / current.field.rowsPerCell),
        stateRow: current.rowOf[index]
      };
      cropByTree.set(index, row);
    }
    next.push(row);
  }
  if (next.length !== cropRows.length || next.some((row, index) => row !== cropRows[index])) {
    cropRows = next;
    cropRevision++;
    const retained = new Set(next);
    for (const [index, row] of cropByTree) if (!retained.has(row)) cropByTree.delete(index);
  }
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createSetup(trees: FieldTree[], frame: FieldFrame): ShellSetup {
  const started = performance.now();
  const wideSpacing = Number(frame.params.wideSpacing) > 0;
  const rowSpacing = wideSpacing ? 7.6 : 7;
  const treeSpacing = wideSpacing ? 6 : 4.5;
  let columns = 0;
  let rows = 0;
  for (const tree of trees) {
    columns = Math.max(columns, tree.column + 1);
    rows = Math.max(rows, tree.row + 1);
  }
  const byPosition = new Map<FieldTree['position'], [number, number]>();
  for (const tree of trees) {
    byPosition.set(tree.position, [
      (tree.column - (columns - 1) / 2) * treeSpacing,
      (tree.row - (rows - 1) / 2) * rowSpacing
    ]);
  }
  const lngLat = frame.params.view !== 'orbit';
  const created = createShellSetup(trees, position => byPosition.get(position as never) ?? [0, 0], {
    fadeSeconds: getNumber(frame.params.fade, 0.45),
    cellColumns: getNumber(frame.params.cellColumns, 4),
    cellRows: getNumber(frame.params.cellRows, 2),
    lngLat,
    now: frame.time * 1000,
    clock: frame.time
  });
  farData = new Array(created.field.templates.length).fill(null);
  trees.forEach((tree, index) => {
    farData[created.rowOf[index]] = tree;
  });
  (window as unknown as {shellSetup: ShellSetup}).shellSetup = created;
  stats.prepareMs = performance.now() - started;
  stats.totalCount = trees.length;
  return created;
}

/**
 * `lifecycle=1`: trees of the middle row, from the middle eastward, each take one of these, for comparing far states
 * with `photorealAll=1`, which draws every tree with the real `TreeLayer` instead.
 */
const LIFECYCLE: Record<string, unknown>[] = [
  {growth: 0.12},
  {growth: 0.25},
  {growth: 0.45},
  {growth: 0.7},
  {},
  {health: 0},
  {health: 0.5},
  {foliage: 0.4},
  {foliage: 0},
  {lean: [86, 0]},
  {lean: [35, 0]},
  {damage: 0.5},
  {damage: 1},
  {decay: 0.3},
  {decay: 0.7},
  {flush: 1}
];

function applyLifecycle(trees: FieldTree[]): void {
  let columns = 0;
  let rows = 0;
  for (const tree of trees) {
    columns = Math.max(columns, tree.column + 1);
    rows = Math.max(rows, tree.row + 1);
  }
  const row = (rows - 1) >> 1;
  const first = (columns - 1) >> 1;
  for (const tree of trees) {
    const k = tree.column - first;
    if (tree.row === row && k >= 0 && k < LIFECYCLE.length) Object.assign(tree, LIFECYCLE[k]);
    // Nothing else, so that each reads on its own.
    else tree.growth = 0;
  }
}

let lifecycleApplied = false;
const getTree = (tree: FieldTree) => tree;

/** The far layer's array props, made once: a new array each frame is garbage and a comparison for deck.gl. */
type LookProps = {
  look: [number, number, number, number];
  tint: [number, number, number, number];
  groundShadow: [number, number];
  lodPixels: [number, number];
  leaf: [number, number, number, number];
  outer: [number, number, number, number];
  windOrigin: [number, number];
};
let lookProps: LookProps | null = null;
/** TreeLayer's foliage material, which photoreal leaves are lit with. */
const FOLIAGE_MATERIAL = {ambient: 0.9, diffuse: 1, shininess: 64, specularColor: [110, 118, 104]};
let windBearing: number | null = null;
let windVector: readonly [number, number] | null = null;

function getLookProps(params: FieldFrame['params'], origin: [number, number, number]): LookProps {
  if (lookProps) {
    const coarse = getNumber(params.tinyPixels, 12);
    const fine = getNumber(params.finePixels, 40);
    if (lookProps.lodPixels[0] !== coarse || lookProps.lodPixels[1] !== fine) {
      lookProps.lodPixels = [coarse, fine];
    }
    return lookProps;
  }
  lookProps = {
    look: [
      getNumber(params.mottle, 0.6),
      getNumber(params.gap, 0.35),
      getNumber(params.spec, 0.25),
      getNumber(params.gain, 0.66)
    ],
    tint: [
      getNumber(params.tintR, 1),
      getNumber(params.tintG, 1),
      getNumber(params.tintB, 0.8),
      getNumber(params.glow, 1)
    ],
    groundShadow: [getNumber(params.groundShadow, 0.42), getNumber(params.groundSoft, 0.3)],
    lodPixels: [getNumber(params.tinyPixels, 12), getNumber(params.finePixels, 40)],
    leaf: [
      getNumber(params.core, 0.88),
      getNumber(params.coreDark, 0.75),
      getNumber(params.leafShare, 0.66),
      getNumber(params.leafPixels, 4)
    ],
    outer: [
      getNumber(params.outer, 1.05),
      getNumber(params.fineGain, 1.08),
      getNumber(params.rimThin, 0.8),
      getNumber(params.leafUp, 0.45)
    ],
    windOrigin: [origin[0], origin[1]]
  };
  return lookProps;
}

export function getFieldLayers(
  trees: FieldTree[],
  frame: FieldFrame,
  independentCrops = false
): LayersList {
  if (getNumber(frame.params.lifecycle, 0) > 0 && !lifecycleApplied) {
    lifecycleApplied = true;
    applyLifecycle(trees);
  }
  if (getNumber(frame.params.photorealAll, 0) > 0) {
    return [
      new TreeLayer<FieldTree>({
        ...frame.layerProps,
        id: 'field-trees',
        quality: 'photoreal',
        data: trees,
        getTree,
        lodBias: frame.params.lodBias
      } as never)
    ];
  }
  if (!setup || setup.trees !== trees) {
    lookProps = null;
    cropRows = [];
    cropByTree.clear();
    cropRevision++;
    setup = createSetup(trees, frame);
  }
  const {params, layerProps} = frame;
  if (params.diagnostics) {
    setup.diagnostics ??= createShellDiagnostics(setup.cells.length);
  } else {
    setup.diagnostics = undefined;
  }
  const now = frame.time * 1000;
  const clock = layerProps.windTime ?? frame.time;
  syncShellTrees(setup, frame.revision, layerProps.transitions, now, clock);

  const nearEnabled = getNumber(params.near, 1) > 0;
  updateShellView(
    view,
    frame.camera,
    Number(params.width),
    Number(params.height),
    Number(params.dpr || 1)
  );
  if (independentCrops) {
    updateCropRows(setup, frame.revision, getNumber(params.cropTrees, CROP_TREE_BUDGET));
  }
  stats.cropCount = independentCrops ? cropRows.length : 0;
  const props = getLookProps(params, setup.windOrigin);
  const [coarsePixels, finePixels] = props.lodPixels;
  const optimized = frame.path === 'playground';
  scheduleField(
    setup,
    frame,
    nearEnabled
      ? {
          in: getNumber(params.nearIn, 260),
          out: getNumber(params.nearOut, 200),
          most: getNumber(params.nearMost, 160),
          selectedIndex:
            typeof params.selectedIndex === 'number' ? params.selectedIndex : undefined,
          fullAt: getNumber(params.fullAt, 1.6),
          accelerateBySize: !optimized,
          treeMetres: 4.5,
          now: frame.time
        }
      : null,
    {
      coarsePixels,
      finePixels,
      bypassFrustum: params.bypassShellFrustum === true,
      crownMetres: 4.5,
      now: frame.time,
      margin: getNumber(params.cast, 0) > 0 ? 3 * 3 + 10 : 2
    },
    optimized
  );
  stats.nearCount = setup.nearByTree.size;
  stats.visibleCount = Math.min(
    trees.length,
    setup.field.bucketStarts[6] * setup.field.rowsPerCell + stats.nearCount
  );

  if (layerProps.windDirection !== windBearing) {
    windBearing = layerProps.windDirection;
    windVector =
      typeof windBearing === 'number'
        ? [Math.sin((windBearing * Math.PI) / 180), Math.cos((windBearing * Math.PI) / 180)]
        : null;
  }
  const windDirection = windVector;
  const layers: LayersList = [
    new ShellLayer({
      id: 'shell-far',
      coordinateSystem: layerProps.coordinateSystem,
      coordinateOrigin: layerProps.coordinateOrigin,
      pickable: layerProps.pickable,
      autoHighlight: layerProps.autoHighlight,
      data: farData,
      field: setup.field,
      time: frame.time,
      windStrength: layerProps.windStrength,
      windDirection,
      windTime: layerProps.windTime,
      wetness: getNumber(params.wetness, 0),
      frost: getNumber(params.frost, 0),
      windOrigin: props.windOrigin,
      windUnits: setup.windUnits,
      look: props.look,
      tint: props.tint,
      groundShadow: props.groundShadow,
      castShadows: getNumber(params.cast, 0) > 0,
      lodPixels: props.lodPixels,
      leaf: props.leaf,
      outer: props.outer,
      debug: getNumber(params.shellDebug, 0),
      material: FOLIAGE_MATERIAL
    } as never)
  ];
  if (nearEnabled) {
    layers.push(
      new TreeLayer<NearTree>({
        ...layerProps,
        id: 'shell-near',
        quality: 'photoreal',
        // Attached leaves and wood write opaque color. Deck handles picking and shadow state
        // separately, and TreeLayer's loose-leaf air passes still override blend as needed.
        ...(optimized && {parameters: {blend: false}}),
        _leafCulling: getNumber(params.leafCulling, 1) > 0,
        _stableLeafShadows: independentCrops,
        _woodCulling: getNumber(params.woodCulling, 1) > 0,
        data: setup.near,
        getTree: independentCrops ? getCanopyTree : getNearTree,
        lodBias: params.lodBias,
        wetness: getNumber(params.wetness, 0),
        frost: getNumber(params.frost, 0),
        // Every near spec reads the shared store's effective pose. A bounded list reuses indices
        // during navigation, so independent TreeLayer transitions would morph unrelated trees.
        transitions: null,
        updateTriggers: {
          getTree: `${frame.revision}:${setup.nearRevision}:${setup.stateRevision}`
        }
      } as never)
    );
  }
  if (independentCrops) {
    layers.push(
      new TreeLayer<NearTree>({
        ...layerProps,
        id: 'shell-crops',
        quality: 'photoreal',
        _cropOnly: true,
        data: cropRows,
        getTree: getNearTree,
        lodBias: 0,
        wetness: getNumber(params.wetness, 0),
        frost: getNumber(params.frost, 0),
        transitions: null,
        updateTriggers: {getTree: `${frame.revision}:${cropRevision}:${setup.stateRevision}`}
      } as never)
    );
  }
  return layers;
}
