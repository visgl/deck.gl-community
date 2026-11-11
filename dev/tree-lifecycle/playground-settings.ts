// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {FieldCamera, FieldTree} from './field/field';

export type TreeScope = 'selected' | 'row' | 'all';
export type ViewPreset = 'overview' | 'rows' | 'tree' | 'leaf';
export type PlaygroundTree = FieldTree & {
  flush: number;
  lean: [number, number];
  damage: number;
  decay: number;
};
export type TreeAttributes = {
  height: number;
  crownRadius: number;
  growth: number;
  health: number;
  foliage: number;
  flush: number;
  leanAngle: number;
  leanBearing: number;
  damage: number;
  decay: number;
  cropCount: number;
  cropSize: number;
  cropRipeness: number;
};
export type OrbitCamera = {
  target: [number, number, number];
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
};

/** Camera-independent state for the field's existing LOD chain; no alternate renderer is selected. */
export type FieldDetailGovernor = {
  bias: number;
  nearScale: number;
  meanMs: number;
  samples: number;
  settlingFrames: number;
  overBudgetFrames: number;
  lastAdjustMs: number;
  underBudgetSinceMs: number | null;
  stableSinceMs: number | null;
  probeCooldownUntilMs: number;
  probe: {bias: number; nearScale: number; startedMs: number} | null;
};

const DETAIL_TARGET_MS = 1000 / 60;
const DETAIL_ADJUST_MS = 500;
const DETAIL_RECOVERY_MS = 3000;
const DETAIL_SETTLE_FRAMES = 30;
const DETAIL_PROBE_STABLE_MS = 4000;
const DETAIL_PROBE_WINDOW_MS = 750;
const DETAIL_PROBE_COOLDOWN_MS = 10000;

export function createFieldDetailGovernor(nowMs = 0, bias = 0): FieldDetailGovernor {
  return {
    bias: Math.max(0, Math.min(3, bias)),
    nearScale: 1,
    meanMs: DETAIL_TARGET_MS,
    samples: 0,
    settlingFrames: DETAIL_SETTLE_FRAMES,
    overBudgetFrames: 0,
    lastAdjustMs: nowMs,
    underBudgetSinceMs: null,
    stableSinceMs: null,
    probeCooldownUntilMs: 0,
    probe: null
  };
}

/** Exclude the first 30 samples after a camera jump, while keeping the last useful detail budget. */
export function settleFieldDetailGovernor(state: FieldDetailGovernor, nowMs: number): void {
  if (state.probe) {
    state.bias = state.probe.bias;
    state.nearScale = state.probe.nearScale;
  }
  state.probe = null;
  state.meanMs = DETAIL_TARGET_MS;
  state.samples = 0;
  state.settlingFrames = DETAIL_SETTLE_FRAMES;
  state.overBudgetFrames = 0;
  state.lastAdjustMs = nowMs;
  state.underBudgetSinceMs = null;
  state.stableSinceMs = null;
}

/**
 * Raise LOD bias when sustained frame time exceeds the 60 Hz budget. Recover one small step only
 * after three seconds below the lower boundary. The dead band and 500 ms interval prevent chatter.
 */
export function updateFieldDetailGovernor(
  state: FieldDetailGovernor,
  frameMs: number,
  nowMs: number
): number {
  if (!(frameMs > 0) || !Number.isFinite(frameMs) || !Number.isFinite(nowMs)) return state.bias;
  if (state.settlingFrames > 0) {
    state.settlingFrames--;
    return state.bias;
  }
  // A single synchronous edit or browser task must not permanently spend the quality budget.
  // Sustained overload still reaches the upper boundary, even when real frames exceed this cap.
  const sample = Math.min(frameMs, DETAIL_TARGET_MS * 2);
  state.meanMs = state.samples ? state.meanMs * 0.9 + sample * 0.1 : sample;
  state.samples++;
  state.overBudgetFrames = state.meanMs > DETAIL_TARGET_MS * 1.08 ? state.overBudgetFrames + 1 : 0;
  if (state.meanMs < DETAIL_TARGET_MS * 0.85) state.underBudgetSinceMs ??= nowMs;
  else state.underBudgetSinceMs = null;
  if (state.meanMs <= DETAIL_TARGET_MS * 1.03) state.stableSinceMs ??= nowMs;
  else state.stableSinceMs = null;
  if (state.probe) {
    if (state.overBudgetFrames >= 8 && nowMs - state.probe.startedMs >= 250) {
      state.bias = state.probe.bias;
      state.nearScale = state.probe.nearScale;
      state.probe = null;
      state.probeCooldownUntilMs = nowMs + DETAIL_PROBE_COOLDOWN_MS;
      state.lastAdjustMs = nowMs;
      state.underBudgetSinceMs = null;
      state.stableSinceMs = null;
      state.overBudgetFrames = 0;
      state.meanMs = DETAIL_TARGET_MS;
      state.samples = 0;
    } else if (nowMs - state.probe.startedMs >= DETAIL_PROBE_WINDOW_MS) {
      state.probe = null;
      state.lastAdjustMs = nowMs;
      state.underBudgetSinceMs = null;
      state.stableSinceMs = null;
    }
    return state.bias;
  }
  if (state.samples < 10 || nowMs - state.lastAdjustMs < DETAIL_ADJUST_MS) return state.bias;
  if (state.overBudgetFrames >= 8) {
    if (state.bias >= 3) state.nearScale = Math.max(0.25, state.nearScale / 2);
    else state.bias = Math.min(3, state.bias + 0.25);
    state.lastAdjustMs = nowMs;
    state.underBudgetSinceMs = null;
    state.stableSinceMs = null;
  } else if (
    nowMs >= state.probeCooldownUntilMs &&
    ((state.underBudgetSinceMs !== null &&
      nowMs - state.underBudgetSinceMs >= DETAIL_RECOVERY_MS) ||
      (state.stableSinceMs !== null && nowMs - state.stableSinceMs >= DETAIL_PROBE_STABLE_MS)) &&
    (state.bias > 0 || state.nearScale < 1)
  ) {
    // Vsync hides spare GPU time at 60 Hz. Probe one small quality step even when the measured
    // cadence cannot fall below 16.7 ms, then roll back and cool down if it exceeds the budget.
    state.probe = {bias: state.bias, nearScale: state.nearScale, startedMs: nowMs};
    if (state.nearScale < 1) state.nearScale = Math.min(1, state.nearScale * 2);
    else state.bias = Math.max(0, state.bias - 0.25);
    state.lastAdjustMs = nowMs;
    state.underBudgetSinceMs = nowMs;
  }
  return state.bias;
}

export const DEFAULT_ATTRIBUTES: Readonly<TreeAttributes> = {
  height: 3,
  crownRadius: 2.25,
  growth: 1,
  health: 1,
  foliage: 1,
  flush: 0,
  leanAngle: 0,
  leanBearing: 90,
  damage: 0,
  decay: 0,
  cropCount: 80,
  cropSize: 0.04,
  cropRipeness: 1
};
export const ATTRIBUTE_LIMITS: Record<keyof TreeAttributes, [number, number]> = {
  height: [0.25, 12],
  crownRadius: [0.1, 6],
  growth: [0, 1],
  health: [0, 1],
  foliage: [0, 1],
  flush: [0, 1],
  leanAngle: [0, 90],
  leanBearing: [0, 360],
  damage: [0, 1],
  decay: [0, 1],
  cropCount: [0, 500],
  cropSize: [0.01, 0.1],
  cropRipeness: [0, 1]
};
export const TREE_SPACING = 4.5;
export const ROW_SPACING = 7;
const MAP_ZOOM_OFFSET = 9 - Math.log2(40.03e6 * Math.cos((28.1 * Math.PI) / 180));

/** A deterministic orchard. Its rows, crop objects and array keep their identity while edited. */
export function createPlaygroundField(requestedCount = 20000): PlaygroundTree[] {
  const count = Math.max(1, Math.min(20000, Math.round(requestedCount) || 20000));
  const columns = Math.ceil(Math.sqrt((count * ROW_SPACING) / TREE_SPACING));
  const rows = Math.ceil(count / columns);
  const seeds = Array.from({length: 4}, (_, index) => ({seed: index + 1}));
  return Array.from({length: count}, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const variation = Math.sin(index * 12.9898 + 78.233);
    return {
      position: [
        (column - (columns - 1) / 2) * TREE_SPACING,
        (row - (rows - 1) / 2) * ROW_SPACING,
        0
      ],
      species: 'citrus',
      height: 3 * (1 + variation * 0.05),
      crownRadius: 2.25 * (1 + variation * 0.04),
      characteristics: seeds[index % seeds.length],
      growth: 1,
      health: 1,
      foliage: 1,
      flush: 0,
      lean: [0, 90],
      damage: 0,
      decay: 0,
      crop: {
        kind: 'fruit',
        count: DEFAULT_ATTRIBUTES.cropCount,
        radius: DEFAULT_ATTRIBUTES.cropSize,
        ripeness: DEFAULT_ATTRIBUTES.cropRipeness,
        color: [244, 140, 24, 255],
        unripeColor: [86, 128, 44, 255]
      },
      row,
      column
    };
  });
}

/** Resolve the edit scope once when selection or scope changes, outside the pointer-input path. */
export function getScopeIndices(
  trees: readonly PlaygroundTree[],
  selectedIndex: number,
  scope: TreeScope
): number[] {
  const selected = trees[selectedIndex];
  if (!selected) return [];
  if (scope === 'selected') return [selectedIndex];
  if (scope === 'all') return trees.map((_, index) => index);
  return trees.flatMap((tree, index) => (tree.row === selected.row ? [index] : []));
}

/** Mutate only the requested attributes. No geometry, row, array or crop object is rebuilt here. */
export function applyAttributePatch(
  trees: PlaygroundTree[],
  indices: readonly number[],
  patch: Partial<TreeAttributes>
): void {
  const entries = Object.entries(patch).flatMap(([key, value]) => {
    const limits = ATTRIBUTE_LIMITS[key as keyof TreeAttributes];
    if (!limits || !Number.isFinite(value)) return [];
    return [[key, Math.max(limits[0], Math.min(limits[1], value))] as const];
  });
  for (const index of indices) {
    const tree = trees[index];
    if (!tree) continue;
    for (const [key, value] of entries) {
      if (key === 'leanAngle') tree.lean[0] = value;
      else if (key === 'leanBearing') tree.lean[1] = value;
      else if (key.startsWith('crop')) {
        if (tree.crop) {
          const cropKey = {cropCount: 'count', cropSize: 'radius', cropRipeness: 'ripeness'}[key];
          if (cropKey) tree.crop[cropKey] = value;
        }
      } else {
        tree[key as 'growth'] = value;
      }
    }
  }
}

export function readTreeAttributes(tree: PlaygroundTree): TreeAttributes {
  return {
    height: tree.height,
    crownRadius: tree.crownRadius,
    growth: tree.growth,
    health: tree.health,
    foliage: tree.foliage,
    flush: tree.flush,
    leanAngle: tree.lean[0],
    leanBearing: tree.lean[1],
    damage: tree.damage,
    decay: tree.decay,
    cropCount: Number(tree.crop?.count ?? 0),
    cropSize: Number(tree.crop?.radius ?? DEFAULT_ATTRIBUTES.cropSize),
    cropRipeness: Number(tree.crop?.ripeness ?? 1)
  };
}

/** Matches the field's camera, whose bearing and Z-axis orbit turn east from north. */
export function getOrbitCamera(camera: FieldCamera): OrbitCamera {
  return {
    target: [camera.east, camera.north, camera.up],
    zoom: camera.zoom + MAP_ZOOM_OFFSET,
    rotationX: 90 - camera.pitch,
    rotationOrbit: camera.bearing
  };
}

export function getFieldCamera(camera: OrbitCamera): FieldCamera {
  return {
    east: camera.target[0],
    north: camera.target[1],
    up: camera.target[2],
    zoom: camera.zoom - MAP_ZOOM_OFFSET,
    pitch: 90 - camera.rotationX,
    bearing: camera.rotationOrbit
  };
}

/** Useful distances from the complete orchard to an individual leaf on the selected crown. */
export function getPresetCamera(
  preset: ViewPreset,
  trees: readonly PlaygroundTree[],
  selectedIndex: number,
  viewportHeight: number
): OrbitCamera {
  const selected = trees[selectedIndex] ?? trees[0];
  const position = selected?.position ?? [0, 0, 0];
  let radius = 1;
  if (preset === 'overview') {
    for (const tree of trees) radius = Math.max(radius, Math.hypot(...tree.position));
  }
  const pixelsPerMetre = {
    overview: viewportHeight / (2.4 * radius),
    rows: 20,
    tree: 110,
    leaf: (1.5 * viewportHeight) / 0.65
  }[preset];
  const targets: Record<ViewPreset, [number, number, number]> = {
    overview: [0, 0, 0],
    rows: [position[0], position[1] - ROW_SPACING / 2, 1.8],
    tree: [position[0], position[1], 1.8],
    leaf: [position[0], position[1] - selected.crownRadius * 0.87, selected.height * 0.63]
  };
  return {
    target: targets[preset],
    zoom: Math.log2(pixelsPerMetre),
    rotationX: preset === 'overview' ? 35 : preset === 'rows' ? 12 : 15,
    rotationOrbit: preset === 'overview' ? -18 : 0
  };
}
