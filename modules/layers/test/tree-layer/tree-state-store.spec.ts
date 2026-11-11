// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {readFileSync} from 'node:fs';
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import {describe, expect, it, vi} from 'vitest';
import {
  TREE_STATE_ROWS_PER_LINE,
  TREE_STATE_TEXEL,
  TREE_STATE_TEXELS_PER_ROW,
  TREE_STATE_TEXTURE_WIDTH
} from '../../src/tree-layer/tree-photoreal-layout';
import {
  TreeStateStore,
  createTreeStateValues,
  type TreeStateUpdate,
  type TreeStateValues,
  type TreeTransitionKey,
  type TreeTransitions
} from '../../src/tree-layer/tree-state-store';

const FLOATS_PER_ROW = TREE_STATE_TEXELS_PER_ROW * 4;
const FLOATS_PER_LINE = TREE_STATE_TEXTURE_WIDTH * 4;
const FRAME_MS = 1000 / 60;
const FRAME_SECONDS = 1 / 60;
const TEXEL = TREE_STATE_TEXEL;

function readFloat(store: TreeStateStore, row: number, texel: number, component: number): number {
  return store.data[row * FLOATS_PER_ROW + texel * 4 + component];
}

/** A store whose row 0 was set from `values` at time 0, with `transitions` taking effect after it. */
function createStore(
  transitions: TreeTransitions | null = null,
  values: TreeStateUpdate = {},
  rowCount = 1
): TreeStateStore {
  const store = new TreeStateStore(rowCount);
  for (let row = 0; row < rowCount; row++) store.setRow(row, values, {now: 0, clock: 0});
  store.tick(0, 0);
  store.clearDirty();
  store.setTransitions(transitions);
  return store;
}

function set(
  store: TreeStateStore,
  values: TreeStateUpdate,
  now = 0,
  clock = now / 1000,
  row = 0
): void {
  store.setRow(row, values, {now, clock});
}

function read(store: TreeStateStore, row = 0): TreeStateValues {
  return store.getRowValues(row);
}

/** deck.gl's per-frame spring from `from` at rest. Index i is the value after i steps. */
function getSpringSeries(
  from: number,
  to: number,
  stiffness: number,
  damping: number,
  steps: number
): number[] {
  const series = [from];
  let previous = from;
  let current = from;
  for (let i = 0; i < steps; i++) {
    const velocity = current - previous;
    const next = current + velocity + (to - current) * stiffness - velocity * damping;
    previous = current;
    current = next;
    series.push(current);
  }
  return series;
}

const RATE_TEXELS = {
  foliage: [TEXEL.DETAIL, 2],
  damage: [TEXEL.DETAIL, 3],
  fallen0: [TEXEL.CROP0_UNRIPE, 3],
  fallen1: [TEXEL.CROP1_UNRIPE, 3]
} as const;

function readRate(store: TreeStateStore, kind: keyof typeof RATE_TEXELS, row = 0): number {
  const [texel, component] = RATE_TEXELS[kind];
  return readFloat(store, row, texel, component);
}

const FULL_VALUES: TreeStateUpdate = {
  position: [-122.4194, 37.7749, 12.5],
  yaw: 1.25,
  windPhase: 2.5,
  crownX: 3.25,
  crownY: 2.75,
  height: 7,
  trunkHeight: 1.5,
  growth: 0.5,
  health: 0.75,
  foliage: 0.625,
  flush: 0.125,
  leanDegrees: 30,
  leanBearing: 90,
  damage: 0.25,
  decay: 0.0625,
  canopyColor: [51, 102, 153, 204],
  trunkColor: [10, 20, 30, 40],
  trunkRadius: 0.2,
  windFlex: 0.5,
  coverage: 0.875,
  leafScale: 1.5,
  leafDetail: 0.375,
  seed: 0.3125,
  crops: [
    {
      count: 12,
      radius: 0.02,
      ripeness: 0.5,
      fallen: 0.25,
      color: [255, 252, 240, 128],
      unripeColor: [86, 128, 44]
    },
    {
      count: 30,
      radius: 0.04,
      ripeness: 0.75,
      fallen: 0.125,
      color: [244, 140, 24, 255],
      unripeColor: [20, 40, 60, 255]
    }
  ]
};

describe('TreeStateStore layout', () => {
  it('imports nothing but the shared layout, so it stays pure', () => {
    const source = readFileSync(
      new URL('../../src/tree-layer/tree-state-store.ts', import.meta.url),
      'utf8'
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]);
    expect(imports).toEqual(['./tree-photoreal-layout']);
  });

  it('writes every field to the texel the contract gives it, in the contract units', () => {
    const store = new TreeStateStore(1);
    store.setRow(0, FULL_VALUES, {now: 0, clock: 0, isNew: true});
    const float = (texel: number, component: number) => readFloat(store, 0, texel, component);
    expect(float(TEXEL.ANCHOR, 0)).toBe(Math.fround(-122.4194));
    expect(float(TEXEL.ANCHOR, 1)).toBe(Math.fround(37.7749));
    expect(float(TEXEL.ANCHOR, 2)).toBe(12.5);
    expect(float(TEXEL.ANCHOR, 3)).toBe(1.25);
    expect(float(TEXEL.ANCHOR_LOW, 0)).toBe(Math.fround(-122.4194 - Math.fround(-122.4194)));
    expect(float(TEXEL.ANCHOR_LOW, 1)).toBe(Math.fround(37.7749 - Math.fround(37.7749)));
    expect(float(TEXEL.ANCHOR_LOW, 2)).toBe(0);
    expect(float(TEXEL.ANCHOR_LOW, 3)).toBe(2.5);
    expect([0, 1, 2, 3].map(i => float(TEXEL.SIZE, i))).toEqual([3.25, 2.75, 7, 1.5]);
    expect([0, 1, 2, 3].map(i => float(TEXEL.LIFE, i))).toEqual([0.5, 0.75, 0.625, 0.125]);
    expect(float(TEXEL.POSE, 0)).toBeCloseTo((30 * Math.PI) / 180, 6);
    expect(float(TEXEL.POSE, 1)).toBeCloseTo(0, 6);
    expect(float(TEXEL.POSE, 2)).toBe(0.25);
    expect(float(TEXEL.POSE, 3)).toBe(0.0625);
    [51, 102, 153, 204].forEach((value, i) =>
      expect(float(TEXEL.CANOPY, i)).toBeCloseTo(value / 255, 6)
    );
    [10, 20, 30, 40].forEach((value, i) =>
      expect(float(TEXEL.TRUNK, i)).toBeCloseTo(value / 255, 6)
    );
    expect(float(TEXEL.MISC, 0)).toBeCloseTo(0.2, 6);
    expect(float(TEXEL.MISC, 1)).toBe(0.5);
    expect(float(TEXEL.MISC, 2)).toBe(0.875);
    expect(float(TEXEL.MISC, 3)).toBe(1.5);
    expect(float(TEXEL.DETAIL, 0)).toBe(0.375);
    expect(float(TEXEL.DETAIL, 1)).toBe(0.3125);
    expect(float(TEXEL.DETAIL, 2)).toBe(0);
    expect(float(TEXEL.DETAIL, 3)).toBe(0);
    expect(float(TEXEL.CROP0, 0)).toBe(12);
    expect(float(TEXEL.CROP0, 1)).toBeCloseTo(0.02, 6);
    expect(float(TEXEL.CROP0, 2)).toBe(0.5);
    expect(float(TEXEL.CROP0, 3)).toBe(0.25);
    [255, 252, 240, 128].forEach((value, i) =>
      expect(float(TEXEL.CROP0_COLOR, i)).toBeCloseTo(value / 255, 6)
    );
    [86, 128, 44].forEach((value, i) =>
      expect(float(TEXEL.CROP0_UNRIPE, i)).toBeCloseTo(value / 255, 6)
    );
    expect(float(TEXEL.CROP0_UNRIPE, 3)).toBe(0);
    expect(float(TEXEL.CROP1, 0)).toBe(30);
    expect(float(TEXEL.CROP1, 1)).toBeCloseTo(0.04, 6);
    expect(float(TEXEL.CROP1, 2)).toBe(0.75);
    expect(float(TEXEL.CROP1, 3)).toBe(0.125);
    [244, 140, 24, 255].forEach((value, i) =>
      expect(float(TEXEL.CROP1_COLOR, i)).toBeCloseTo(value / 255, 6)
    );
    [20, 40, 60].forEach((value, i) =>
      expect(float(TEXEL.CROP1_UNRIPE, i)).toBeCloseTo(value / 255, 6)
    );
    expect(float(TEXEL.CROP1_UNRIPE, 3)).toBe(0);
    expect([0, 1, 2, 3].map(i => float(TEXEL.CROP_DROPPED, i))).toEqual([0, 0, 0, 0]);
    set(store, {crops: [{dropped: 7}, {dropped: 9}]});
    expect([0, 1, 2, 3].map(i => float(TEXEL.CROP_DROPPED, i))).toEqual([7, 9, 0, 0]);
  });

  it('stores the lean direction as the math angle atan2(y, x) of a clockwise compass bearing', () => {
    const store = new TreeStateStore(1);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315, 359]) {
      set(store, {leanDegrees: 20, leanBearing: bearing});
      const radians = (bearing * Math.PI) / 180;
      expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(
        Math.atan2(Math.cos(radians), Math.sin(radians)),
        6
      );
    }
    set(store, {leanBearing: 0});
    expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(Math.PI / 2, 6);
    set(store, {leanBearing: 90});
    expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(0, 6);
    set(store, {leanBearing: 180});
    expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('addresses a row exactly where the shaders fetch it', () => {
    const store = new TreeStateStore(200);
    const row = 131;
    set(store, {growth: 0.25, trunkRadius: 0.75}, 0, 0, row);
    const fetch = (texel: number, component: number) => {
      const x = (row % TREE_STATE_ROWS_PER_LINE) * TREE_STATE_TEXELS_PER_ROW + texel;
      const y = Math.floor(row / TREE_STATE_ROWS_PER_LINE);
      return store.data[(y * TREE_STATE_TEXTURE_WIDTH + x) * 4 + component];
    };
    expect(fetch(TEXEL.LIFE, 0)).toBe(0.25);
    expect(fetch(TEXEL.MISC, 0)).toBe(0.75);
  });

  it('splits a position into high and low parts that keep its double precision', () => {
    const store = new TreeStateStore(1);
    const x = 1234567.890123;
    set(store, {position: [x, -x / 3, x / 7]});
    for (const [axis, value] of [x, -x / 3, x / 7].entries()) {
      const high = readFloat(store, 0, TEXEL.ANCHOR, axis);
      const low = readFloat(store, 0, TEXEL.ANCHOR_LOW, axis);
      expect(Math.abs(high + low - value)).toBeLessThan(1e-8);
      expect(high).toBe(Math.fround(value));
    }
    expect(read(store).position).toEqual([x, -x / 3, x / 7]);
    set(store, {position: [100, 200, 300], positionLow: [0.25, 0.5, -0.25]});
    expect(read(store).position).toEqual([100.25, 200.5, 299.75]);
    expect(readFloat(store, 0, TEXEL.ANCHOR, 0)).toBe(100.25);
    expect(readFloat(store, 0, TEXEL.ANCHOR_LOW, 0)).toBe(0);
  });

  it('holds the documented defaults on a new row, and reads back exactly what was set', () => {
    const store = new TreeStateStore(1);
    const expected = {
      position: [0, 0, 0],
      positionLow: undefined,
      yaw: 0,
      windPhase: 0,
      crownX: 3,
      crownY: 3,
      height: 10,
      trunkHeight: 3.5,
      growth: 1,
      health: 1,
      foliage: 1,
      flush: 0,
      leanDegrees: 0,
      leanBearing: 0,
      damage: 0,
      decay: 0,
      canopyColor: [255, 255, 255, 255],
      trunkColor: [255, 255, 255, 255],
      trunkRadius: 0.5,
      windFlex: 1,
      coverage: 1,
      leafScale: 1,
      leafDetail: 1,
      seed: 0,
      crops: [0, 1].map(() => ({
        count: 0,
        radius: 0,
        ripeness: 1,
        fallen: 0,
        color: [255, 255, 255, 255],
        unripeColor: [86, 128, 44],
        dropped: 0
      }))
    };
    expect(read(store)).toEqual(expected);
    expect(createTreeStateValues()).toEqual(expected);
    expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(1);
    expect(readFloat(store, 0, TEXEL.CROP0_UNRIPE, 0)).toBeCloseTo(86 / 255, 6);

    set(store, FULL_VALUES);
    const values = read(store);
    expect(values.position).toEqual([-122.4194, 37.7749, 12.5]);
    expect(values.trunkRadius).toBe(0.2);
    expect(values.canopyColor).toEqual([51, 102, 153, 204]);
    expect(values.crops[1]).toEqual({
      count: 30,
      radius: 0.04,
      ripeness: 0.75,
      fallen: 0.125,
      color: [244, 140, 24, 255],
      unripeColor: [20, 40, 60],
      dropped: 0
    });
  });

  it('reuses `out` when reading, and a read does not disturb the row', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1});
    store.tick(250, 0.25);
    store.clearDirty();
    const out = createTreeStateValues();
    const {position, canopyColor, crops} = out;
    expect(store.getRowValues(0, out)).toBe(out);
    expect(out.position).toBe(position);
    expect(out.canopyColor).toBe(canopyColor);
    expect(out.crops).toBe(crops);
    expect(out.growth).toBeCloseTo(0.25, 12);
    expect(store.isDirty).toBe(false);
    expect(store.activeTweenCount).toBe(1);
  });
});

describe('TreeStateStore.resize', () => {
  it('holds whole 64-row lines, and always at least one', () => {
    const store = new TreeStateStore();
    for (const [rows, lines] of [
      [0, 1],
      [1, 1],
      [64, 1],
      [65, 2],
      [128, 2],
      [129, 3],
      [0, 1]
    ]) {
      store.resize(rows);
      expect(store.rowCount).toBe(rows);
      expect(store.lineCount).toBe(lines);
      expect(store.data.length).toBe(lines * FLOATS_PER_LINE);
    }
    store.resize(Number.NaN);
    expect(store.rowCount).toBe(0);
    store.resize(2.9);
    expect(store.rowCount).toBe(2);
    store.resize(-1);
    expect(store.rowCount).toBe(0);
  });

  it('keeps the same array inside a line, and marks only the added rows', () => {
    const store = new TreeStateStore(1);
    set(store, {growth: 0.5});
    store.clearDirty();
    const {data} = store;
    store.resize(64);
    expect(store.data).toBe(data);
    expect(store.dirtyLineStart).toBe(0);
    expect(store.dirtyLineEnd).toBe(1);
    expect(read(store).growth).toBe(0.5);
    expect(read(store, 63).growth).toBe(1);
  });

  it('keeps values and marks every line when a new height means a new texture', () => {
    const store = new TreeStateStore(64);
    set(store, {growth: 0.5}, 0, 0, 63);
    store.clearDirty();
    const {data} = store;
    store.resize(200);
    expect(store.data).not.toBe(data);
    expect(store.dirtyLineStart).toBe(0);
    expect(store.dirtyLineEnd).toBe(4);
    expect(read(store, 63).growth).toBe(0.5);
    expect(readFloat(store, 63, TEXEL.LIFE, 0)).toBe(0.5);
    expect(readFloat(store, 199, TEXEL.LIFE, 0)).toBe(1);
    store.clearDirty();
    store.resize(64);
    expect(store.lineCount).toBe(1);
    expect(store.dirtyLineEnd).toBe(1);
    expect(read(store, 63).growth).toBe(0.5);
  });

  it('keeps running tweens across growth, and interrupts those of removed rows', () => {
    const onEnd = vi.fn();
    const onInterrupt = vi.fn();
    const store = createStore({getGrowth: {duration: 1000, onEnd, onInterrupt}}, {growth: 0}, 3);
    set(store, {growth: 1}, 0, 0, 0);
    set(store, {growth: 1}, 0, 0, 2);
    store.tick(250, 0.25);
    store.resize(500);
    expect(store.activeTweenCount).toBe(2);
    expect(read(store, 2).growth).toBeCloseTo(0.25, 12);
    store.resize(1);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith(2, 'getGrowth');
    expect(store.activeTweenCount).toBe(1);
    store.tick(1000, 1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(0, 'getGrowth');
    expect(read(store).growth).toBe(1);
  });

  it('stops everything of a removed row at once, so nothing keeps ticking for it', () => {
    const store = createStore(null, {foliage: 1}, 2);
    store.setRow(1, {foliage: 0.9}, {now: 16, clock: FRAME_SECONDS});
    expect(store.tick(16, FRAME_SECONDS).active).toBe(true);
    store.resize(1);
    expect(store.tick(32, 2 * FRAME_SECONDS).active).toBe(false);
  });

  it('starts a row grown back from the defaults, with nothing left of the old row', () => {
    const store = createStore({getFoliage: 1000}, {foliage: 1}, 2);
    set(store, {foliage: 0, growth: 0.5}, 0, 0, 1);
    store.tick(100, 0.1);
    store.tick(116, 0.116);
    expect(readRate(store, 'foliage', 1)).toBeGreaterThan(0);
    store.resize(1);
    store.resize(2);
    expect(read(store, 1).foliage).toBe(1);
    expect(read(store, 1).growth).toBe(1);
    expect(readRate(store, 'foliage', 1)).toBe(0);
    expect(store.activeTweenCount).toBe(0);
    expect(store.tick(132, 0.132)).toMatchObject({active: false});
    expect(readRate(store, 'foliage', 1)).toBe(0);
    set(store, {foliage: 0.5}, 200, 0.2, 1);
    expect(read(store, 1).foliage).toBe(0.5);
  });

  it('rejects rows that do not exist', () => {
    const store = new TreeStateStore(2);
    for (const row of [-1, 2, 0.5, Number.NaN]) {
      expect(() => set(store, {}, 0, 0, row)).toThrow(RangeError);
      expect(() => store.getRowValues(row)).toThrow(RangeError);
    }
  });
});

describe('TreeStateStore unchanged values', () => {
  it('marks nothing dirty and reports no change', () => {
    const store = new TreeStateStore(1);
    store.setRow(0, FULL_VALUES, {now: 0, clock: 0, isNew: true});
    expect(store.isDirty).toBe(true);
    store.tick(0, 0);
    store.clearDirty();
    const before = store.data.slice();
    for (let frame = 1; frame < 10; frame++) {
      store.setRow(0, FULL_VALUES, {now: frame * FRAME_MS, clock: frame * FRAME_SECONDS});
      expect(store.isDirty).toBe(false);
      expect(store.dirtyLineStart).toBe(0);
      expect(store.dirtyLineEnd).toBe(0);
      expect(store.tick(frame * FRAME_MS, frame * FRAME_SECONDS)).toEqual({
        changed: false,
        active: false
      });
    }
    expect(store.data).toEqual(before);
  });

  it('marks nothing when a new object holds equal values or equal colors of another shape', () => {
    const store = createStore(null, {canopyColor: [1, 2, 3, 255], position: [1, 2, 3]});
    set(store, {
      canopyColor: new Uint8Array([1, 2, 3, 255]),
      position: new Float64Array([1, 2, 3])
    });
    expect(store.isDirty).toBe(false);
    set(store, {canopyColor: [1, 2, 3]});
    expect(store.isDirty).toBe(false);
  });

  it('lets a running tween carry on when its target is set again', () => {
    const onStart = vi.fn();
    const onInterrupt = vi.fn();
    const store = createStore({getGrowth: {duration: 1000, onStart, onInterrupt}}, {growth: 0});
    set(store, {growth: 1});
    store.tick(250, 0.25);
    set(store, {growth: 1}, 250);
    set(store, {growth: 1}, 500);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onInterrupt).not.toHaveBeenCalled();
    store.tick(500, 0.5);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
  });

  it('jumps a changed field and marks only what changed since the last tick', () => {
    const store = createStore();
    set(store, {growth: 0.5});
    expect(read(store).growth).toBe(0.5);
    expect(store.isDirty).toBe(true);
    expect(store.tick(0, 0)).toEqual({changed: true, active: false});
    expect(store.tick(0, 0)).toEqual({changed: false, active: false});
  });
});

describe('TreeStateStore interpolation', () => {
  it('takes a number as a linear duration in milliseconds', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1});
    expect(read(store).growth).toBe(0);
    expect(store.tick(0, 0)).toEqual({changed: false, active: true});
    expect(store.tick(250, 0.25)).toEqual({changed: true, active: true});
    expect(read(store).growth).toBeCloseTo(0.25, 12);
    expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBeCloseTo(0.25, 6);
    store.tick(600, 0.6);
    expect(read(store).growth).toBeCloseTo(0.6, 12);
    expect(store.tick(1000, 1)).toEqual({changed: true, active: false});
    expect(read(store).growth).toBe(1);
    expect(store.activeTweenCount).toBe(0);
    expect(store.tick(1100, 1.1)).toEqual({changed: false, active: false});
  });

  it('applies easing, including one that overshoots, while 0-1 fields stay in range', () => {
    const store = createStore({getGrowth: {duration: 1000, easing: t => t * t}}, {growth: 0});
    set(store, {growth: 1});
    store.tick(500, 0.5);
    expect(read(store).growth).toBeCloseTo(0.25, 12);

    const overshooting = createStore(
      {
        getGrowth: {duration: 1000, easing: t => t * 1.5},
        getHeight: {duration: 1000, easing: t => t * 1.5}
      },
      {growth: 0, height: 10}
    );
    set(overshooting, {growth: 1, height: 20});
    overshooting.tick(900, 0.9);
    expect(read(overshooting).growth).toBe(1);
    expect(readFloat(overshooting, 0, TEXEL.LIFE, 0)).toBe(1);
    expect(read(overshooting).height).toBeCloseTo(23.5, 9);
    overshooting.tick(1000, 1);
    expect(read(overshooting).height).toBe(20);
  });

  it('falls back to linear when an easing returns something unusable', () => {
    const store = createStore({getGrowth: {duration: 1000, easing: () => Number.NaN}}, {growth: 0});
    set(store, {growth: 1});
    store.tick(500, 0.5);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
  });

  for (const [label, settings] of [
    ['a zero number', 0],
    ['a zero duration', {duration: 0}],
    ['a negative duration', {duration: -5}],
    ['a NaN duration', {duration: Number.NaN}],
    ['an infinite duration', {duration: Number.POSITIVE_INFINITY}],
    ['null', null],
    ['false', false]
  ] as const) {
    it(`jumps with ${label}, with no callbacks`, () => {
      const onStart = vi.fn();
      const callbacks = typeof settings === 'object' && settings ? {onStart} : {};
      const store = createStore(
        {
          getGrowth:
            typeof settings === 'object' && settings ? {...settings, ...callbacks} : settings
        },
        {growth: 0}
      );
      set(store, {growth: 1});
      expect(read(store).growth).toBe(1);
      expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(1);
      expect(store.activeTweenCount).toBe(0);
      expect(onStart).not.toHaveBeenCalled();
    });
  }

  it('starts a retarget from the current value', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1});
    store.tick(500, 0.5);
    set(store, {growth: 0}, 500);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
    store.tick(500, 0.5);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
    store.tick(1000, 1);
    expect(read(store).growth).toBeCloseTo(0.25, 12);
    store.tick(1500, 1.5);
    expect(read(store).growth).toBe(0);
  });

  it('retargets from the value at `now`, not from the last tick', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1});
    store.tick(100, 0.1);
    set(store, {growth: 0.5}, 500);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
    expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBeCloseTo(0.5, 6);
  });

  it('keeps moving when the target changes every frame, as with animated data', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    let previous = 0;
    for (let frame = 1; frame <= 30; frame++) {
      const now = frame * FRAME_MS;
      set(store, {growth: 0.5 + frame * 0.01}, now);
      store.tick(now, now / 1000);
      const {growth} = read(store);
      // The first tween starts at this frame's time, so it moves from the next frame on.
      if (frame > 1) expect(growth).toBeGreaterThan(previous);
      previous = growth;
    }
    expect(previous).toBeGreaterThan(0.25);
  });

  it('fires onStart once per start, onEnd once, in deck.gl order across an interruption', () => {
    const events: string[] = [];
    const store = createStore(
      {
        getGrowth: {
          duration: 1000,
          onStart: () => events.push('start'),
          onEnd: () => events.push('end'),
          onInterrupt: () => events.push('interrupt')
        }
      },
      {growth: 0}
    );
    set(store, {growth: 1});
    expect(events).toEqual(['start']);
    store.tick(100, 0.1);
    store.tick(200, 0.2);
    expect(events).toEqual(['start']);
    set(store, {growth: 0.5}, 200);
    expect(events).toEqual(['start', 'interrupt', 'start']);
    store.tick(600, 0.6);
    expect(events).toEqual(['start', 'interrupt', 'start']);
    store.tick(1200, 1.2);
    expect(events).toEqual(['start', 'interrupt', 'start', 'end']);
    store.tick(1300, 1.3);
    expect(events).toEqual(['start', 'interrupt', 'start', 'end']);
  });

  it('fires one start for a group however many of its channels changed', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const store = createStore(
      {getCanopyColor: {duration: 100, onStart, onEnd}},
      {canopyColor: [0, 0, 0, 0]}
    );
    set(store, {canopyColor: [10, 20, 30, 40]});
    expect(onStart).toHaveBeenCalledTimes(1);
    store.tick(100, 0.1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(read(store).canopyColor).toEqual([10, 20, 30, 40]);
  });

  it('tells a callback which row and accessor it is about, in start order', () => {
    const calls: [string, number, string][] = [];
    const record =
      (name: string) =>
      (row: number, key: TreeTransitionKey): void => {
        calls.push([name, row, key]);
      };
    const store = createStore(
      {
        getTree: {duration: 100, onStart: record('start'), onEnd: record('end')},
        getHealth: {duration: 100, onEnd: record('healthEnd')}
      },
      {growth: 0, health: 0},
      3
    );
    for (const row of [0, 1, 2]) set(store, {growth: 1}, 0, 0, row);
    set(store, {health: 1}, 0, 0, 1);
    store.tick(100, 0.1);
    expect(calls).toEqual([
      ['start', 0, 'getGrowth'],
      ['start', 1, 'getGrowth'],
      ['start', 2, 'getGrowth'],
      ['end', 0, 'getGrowth'],
      ['end', 1, 'getGrowth'],
      ['end', 2, 'getGrowth'],
      ['healthEnd', 1, 'getHealth']
    ]);
  });

  it('calls onEnd rather than onInterrupt for a tween that had already finished by `now`', () => {
    const events: string[] = [];
    const store = createStore(
      {
        getGrowth: {
          duration: 100,
          onStart: () => events.push('start'),
          onEnd: () => events.push('end'),
          onInterrupt: () => events.push('interrupt')
        }
      },
      {growth: 0}
    );
    set(store, {growth: 1});
    set(store, {growth: 0}, 500);
    expect(events).toEqual(['start', 'end', 'start']);
    expect(read(store).growth).toBe(1);
  });

  it('interrupts with no restart when a retarget lands exactly on the current value', () => {
    const events: string[] = [];
    const store = createStore(
      {
        getGrowth: {
          duration: 1000,
          onStart: () => events.push('start'),
          onEnd: () => events.push('end'),
          onInterrupt: () => events.push('interrupt')
        }
      },
      {growth: 0}
    );
    set(store, {growth: 1});
    store.tick(500, 0.5);
    set(store, {growth: 0.5}, 500);
    expect(events).toEqual(['start', 'interrupt']);
    expect(store.activeTweenCount).toBe(0);
    expect(read(store).growth).toBe(0.5);
    expect(store.tick(600, 0.6).active).toBe(false);
  });

  it('holds while the timeline is paused and replays when it is stepped back', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1});
    store.tick(400, 0.4);
    store.clearDirty();
    for (let i = 0; i < 5; i++) {
      expect(store.tick(400, 0.4)).toEqual({changed: false, active: true});
      expect(read(store).growth).toBeCloseTo(0.4, 12);
    }
    expect(store.isDirty).toBe(false);
    store.tick(200, 0.2);
    expect(read(store).growth).toBeCloseTo(0.2, 12);
    store.tick(-100, 0);
    expect(read(store).growth).toBe(0);
    store.tick(1000, 1);
    expect(read(store).growth).toBe(1);
  });

  it('lets channels of one group keep their own timing, so one cannot stall another', () => {
    const easing = (t: number) => t * t * (3 - 2 * t);
    const crop = (ripeness: number, fallen: number) => ({
      count: 10,
      radius: 0.1,
      ripeness,
      fallen,
      color: [255, 255, 255, 255],
      unripeColor: [0, 0, 0]
    });
    const store = createStore({getCrop: {duration: 1000, easing}}, {crops: [crop(0, 0)]});
    set(store, {crops: [crop(0, 1)]});
    for (let frame = 1; frame * FRAME_MS < 1000; frame++) {
      const now = frame * FRAME_MS;
      set(store, {crops: [crop(frame * 0.001, 1)]}, now);
      store.tick(now, now / 1000);
      expect(read(store).crops[0].fallen).toBeCloseTo(easing(now / 1000), 9);
    }
  });

  it('does not restart the rest of a group for an easing written inline in layer props', () => {
    const easing = (t: number) => t * t * (3 - 2 * t);
    const crop = (ripeness: number, fallen: number) => ({count: 10, radius: 0.1, ripeness, fallen});
    const store = createStore({getCrop: {duration: 1000, easing}}, {crops: [crop(0, 0)]});
    set(store, {crops: [crop(0, 1)]});
    for (let frame = 1; frame * FRAME_MS < 1000; frame++) {
      const now = frame * FRAME_MS;
      store.setTransitions({getCrop: {duration: 1000, easing: t => easing(t)}});
      set(store, {crops: [crop(frame * 0.001, 1)]}, now);
      store.tick(now, now / 1000);
      expect(read(store).crops[0].fallen).toBeCloseTo(easing(now / 1000), 9);
    }
  });

  it('runs many tweens at once and reuses their records', () => {
    const rows = 300;
    const store = createStore(
      {getTree: 100},
      {growth: 0, health: 0, canopyColor: [0, 0, 0, 0]},
      rows
    );
    const internals = store as unknown as {tweens: {capacity: number}};
    let capacity = 0;
    for (let cycle = 0; cycle < 5; cycle++) {
      const target = cycle % 2 ? 0 : 1;
      const now = cycle * 1000;
      for (let row = 0; row < rows; row++)
        set(
          store,
          {growth: target, health: target, canopyColor: [target, 0, 0, 255]},
          now,
          now / 1000,
          row
        );
      expect(store.activeTweenCount).toBe(rows * 3);
      store.tick(now + 50, now / 1000 + 0.05);
      for (let row = 0; row < rows; row += 37) expect(read(store, row).growth).toBeCloseTo(0.5, 12);
      store.tick(now + 100, now / 1000 + 0.1);
      expect(store.activeTweenCount).toBe(0);
      for (let row = 0; row < rows; row += 37) {
        expect(read(store, row).growth).toBe(target);
        expect(readFloat(store, row, TEXEL.LIFE, 1)).toBe(target);
      }
      if (cycle === 0) capacity = internals.tweens.capacity;
    }
    expect(internals.tweens.capacity).toBe(capacity);
  });

  it('does not leak records when tweens stop without a tick to collect them', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    const internals = store as unknown as {tweens: {capacity: number}};
    for (let i = 1; i < 2000; i++) {
      // Each start is ended by a jump, since the settings go away, and nothing ever ticks.
      store.setTransitions({getGrowth: 1000});
      set(store, {growth: i % 2}, i);
      store.setTransitions(null);
    }
    expect(store.activeTweenCount).toBe(0);
    expect(internals.tweens.capacity).toBe(16);
  });
});

describe('TreeStateStore field groups', () => {
  const START: TreeStateUpdate = {
    position: [0, 0, 0],
    crownX: 2,
    crownY: 2,
    height: 10,
    trunkHeight: 2,
    trunkRadius: 0.2,
    growth: 0,
    health: 0,
    foliage: 0,
    flush: 0,
    leanDegrees: 10,
    leanBearing: 10,
    damage: 0,
    decay: 0,
    canopyColor: [0, 0, 0, 0],
    trunkColor: [0, 0, 0, 0],
    windFlex: 0,
    leafScale: 1,
    crops: [
      {count: 2, radius: 0.2, ripeness: 0, fallen: 0, color: [0, 0, 0, 0], unripeColor: [0, 0, 0]},
      {count: 2, radius: 0.2, ripeness: 0, fallen: 0, color: [0, 0, 0, 0], unripeColor: [0, 0, 0]}
    ]
  };
  const END: TreeStateUpdate = {
    position: [10, 20, 30],
    crownX: 4,
    crownY: 6,
    height: 20,
    trunkHeight: 6,
    trunkRadius: 0.4,
    growth: 1,
    health: 1,
    foliage: 1,
    flush: 1,
    leanDegrees: 30,
    leanBearing: 30,
    damage: 1,
    decay: 1,
    canopyColor: [100, 100, 100, 100],
    trunkColor: [100, 100, 100, 100],
    windFlex: 2,
    leafScale: 2,
    crops: [
      {
        count: 4,
        radius: 0.4,
        ripeness: 1,
        fallen: 1,
        color: [100, 100, 100, 100],
        unripeColor: [100, 100, 100],
        dropped: 6
      },
      {
        count: 4,
        radius: 0.4,
        ripeness: 1,
        fallen: 1,
        color: [100, 100, 100, 100],
        unripeColor: [100, 100, 100],
        dropped: 6
      }
    ]
  };

  type Probe = (values: TreeStateValues) => number;
  const probes: Record<string, Probe> = {
    x: v => v.position[0],
    y: v => v.position[1],
    z: v => v.position[2],
    crownX: v => v.crownX,
    crownY: v => v.crownY,
    height: v => v.height,
    leafScale: v => v.leafScale,
    trunkHeight: v => v.trunkHeight,
    trunkRadius: v => v.trunkRadius,
    growth: v => v.growth,
    health: v => v.health,
    foliage: v => v.foliage,
    flush: v => v.flush,
    leanDegrees: v => v.leanDegrees,
    leanBearing: v => v.leanBearing,
    damage: v => v.damage,
    decay: v => v.decay,
    canopyR: v => v.canopyColor[0],
    canopyA: v => v.canopyColor[3],
    trunkR: v => v.trunkColor[0],
    trunkA: v => v.trunkColor[3],
    windFlex: v => v.windFlex,
    crop0Count: v => v.crops[0].count,
    crop0Radius: v => v.crops[0].radius,
    crop0Ripeness: v => v.crops[0].ripeness,
    crop0Fallen: v => v.crops[0].fallen,
    crop0Color: v => v.crops[0].color[1],
    crop0Unripe: v => v.crops[0].unripeColor[2],
    crop1Count: v => v.crops[1].count,
    crop1Radius: v => v.crops[1].radius,
    crop1Ripeness: v => v.crops[1].ripeness,
    crop1Fallen: v => v.crops[1].fallen,
    crop1Color: v => v.crops[1].color[1],
    crop1Unripe: v => v.crops[1].unripeColor[2],
    crop0Dropped: v => v.crops[0].dropped,
    crop1Dropped: v => v.crops[1].dropped
  };
  const ALL = Object.keys(probes);
  const CROP = ALL.filter(name => name.startsWith('crop') && name !== 'crownX');

  /** Which fields are halfway at half the duration; the others must already be at their end. */
  function getTweening(transitions: TreeTransitions): string[] {
    const start = createStore(null, START);
    const from = read(start);
    const store = createStore(transitions, START);
    set(store, END);
    store.tick(500, 0.5);
    const middle = read(store);
    const finished = createStore(null, START);
    set(finished, END);
    const to = read(finished);
    const tweening: string[] = [];
    for (const name of ALL) {
      const probe = probes[name];
      if (probe(middle) === probe(to)) continue;
      expect(probe(middle), name).toBeCloseTo((probe(from) + probe(to)) / 2, 9);
      tweening.push(name);
    }
    store.tick(1000, 1);
    expect(read(store)).toEqual(to);
    expect(store.activeTweenCount).toBe(0);
    return tweening.sort();
  }

  const expected: [TreeTransitionKey, string[]][] = [
    ['getGrowth', ['growth']],
    ['getHealth', ['health']],
    ['getFoliage', ['foliage']],
    ['getFlush', ['flush']],
    ['getLean', ['leanBearing', 'leanDegrees']],
    ['getDamage', ['damage']],
    ['getDecay', ['decay']],
    ['getPosition', ['x', 'y', 'z']],
    ['getElevation', ['z']],
    ['getHeight', ['height', 'leafScale', 'trunkHeight']],
    ['getCanopyRadius', ['crownX', 'crownY']],
    ['getTrunkRadius', ['trunkRadius']],
    ['getTrunkHeightFraction', ['trunkHeight']],
    ['getCanopyColor', ['canopyA', 'canopyR']],
    ['getSeason', ['canopyA', 'canopyR']],
    ['getTrunkColor', ['trunkA', 'trunkR']],
    ['getCrop', CROP]
  ];
  for (const [key, fields] of expected) {
    it(`${key} tweens exactly its own fields`, () => {
      expect(getTweening({[key]: 1000})).toEqual([...fields].sort());
    });
  }

  it('getTree is the fallback for every group, and a tree identity never tweens', () => {
    expect(getTweening({getTree: 1000})).toEqual([...ALL].sort());
    const store = createStore(
      {getTree: 1000},
      {yaw: 0, windPhase: 0, coverage: 0, leafDetail: 0, seed: 0}
    );
    set(store, {yaw: 2, windPhase: 3, coverage: 0.5, leafDetail: 0.25, seed: 0.75});
    expect(read(store)).toMatchObject({
      yaw: 2,
      windPhase: 3,
      coverage: 0.5,
      leafDetail: 0.25,
      seed: 0.75
    });
    expect(store.activeTweenCount).toBe(0);
  });

  it('lets each group run its own duration at once', () => {
    const store = createStore(
      {
        getTree: 500,
        getGrowth: 2000,
        getHealth: {duration: 1000, easing: t => t * t},
        getDamage: 0
      },
      {growth: 0, health: 0, foliage: 0, damage: 0}
    );
    set(store, {growth: 1, health: 1, foliage: 1, damage: 1});
    expect(read(store).damage).toBe(1);
    expect(store.activeTweenCount).toBe(3);
    store.tick(250, 0.25);
    expect(read(store).growth).toBeCloseTo(0.125, 12);
    expect(read(store).health).toBeCloseTo(0.0625, 12);
    expect(read(store).foliage).toBeCloseTo(0.5, 12);
    store.tick(500, 0.5);
    expect(read(store).foliage).toBe(1);
    expect(store.activeTweenCount).toBe(2);
    store.tick(1000, 1);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
    expect(read(store).health).toBe(1);
    expect(store.activeTweenCount).toBe(1);
    expect(store.tick(2000, 2)).toMatchObject({active: false});
    expect(read(store).growth).toBe(1);
  });

  it('lets a falsy own key make a group jump even with getTree settings', () => {
    for (const off of [0, null, false] as const) {
      const store = createStore({getTree: 1000, getGrowth: off}, {growth: 0, health: 0});
      set(store, {growth: 1, health: 1});
      expect(read(store).growth).toBe(1);
      expect(read(store).health).toBe(0);
    }
  });

  it('retargeting one group leaves the others alone', () => {
    const onHealth = vi.fn();
    const store = createStore(
      {getGrowth: 1000, getHealth: {duration: 1000, onInterrupt: onHealth}},
      {growth: 0, health: 0}
    );
    set(store, {growth: 1, health: 1});
    store.tick(500, 0.5);
    set(store, {growth: 0, health: 1}, 500);
    expect(onHealth).not.toHaveBeenCalled();
    store.tick(750, 0.75);
    expect(read(store).growth).toBeCloseTo(0.375, 12);
    expect(read(store).health).toBeCloseTo(0.75, 12);
  });

  it('moves x, y and z as one transition unless getElevation asks for its own', () => {
    const onStart = vi.fn();
    const store = createStore({getPosition: {duration: 1000, onStart}}, {position: [0, 0, 0]});
    set(store, {position: [10, 10, 10]});
    expect(onStart).toHaveBeenCalledTimes(1);

    const onPosition = vi.fn();
    const onElevation = vi.fn();
    const split = createStore(
      {
        getPosition: {duration: 1000, onStart: onPosition},
        getElevation: {duration: 100, onStart: onElevation}
      },
      {position: [0, 0, 0]}
    );
    set(split, {position: [10, 10, 10]});
    expect(onPosition).toHaveBeenCalledTimes(1);
    expect(onElevation).toHaveBeenCalledTimes(1);
    expect(onElevation).toHaveBeenCalledWith(0, 'getElevation');
    split.tick(50, 0.05);
    expect(read(split).position[0]).toBeCloseTo(0.5, 12);
    expect(read(split).position[2]).toBeCloseTo(5, 12);
    split.tick(100, 0.1);
    expect(read(split).position[2]).toBe(10);
    expect(split.activeTweenCount).toBe(1);
  });

  it('honours getElevation alone, and a falsy getElevation keeps z out of getPosition', () => {
    const store = createStore({getElevation: 1000}, {position: [0, 0, 0]});
    set(store, {position: [10, 10, 10]});
    store.tick(500, 0.5);
    expect(read(store).position).toEqual([10, 10, 5]);

    const off = createStore({getPosition: 1000, getElevation: 0}, {position: [0, 0, 0]});
    set(off, {position: [10, 10, 10]});
    off.tick(500, 0.5);
    expect(read(off).position).toEqual([5, 5, 10]);
  });

  it('carries trunk height with getHeight in one transition, in proportion', () => {
    const onStart = vi.fn();
    const store = createStore(
      {getHeight: {duration: 1000, onStart}},
      {height: 10, trunkHeight: 3.5}
    );
    set(store, {height: 20, trunkHeight: 7});
    expect(onStart).toHaveBeenCalledTimes(1);
    store.tick(500, 0.5);
    expect(read(store).height).toBeCloseTo(15, 9);
    expect(read(store).trunkHeight).toBeCloseTo(5.25, 9);
    expect(readFloat(store, 0, TEXEL.SIZE, 3)).toBeCloseTo(5.25, 5);
  });

  it('holds trunk height when a taller tree keeps its trunk, with no dip', () => {
    const store = createStore({getHeight: 1000}, {height: 10, trunkHeight: 3.5});
    set(store, {height: 20, trunkHeight: 3.5});
    store.tick(500, 0.5);
    expect(read(store).trunkHeight).toBe(3.5);
  });

  it('gives getTrunkHeightFraction its own trunk height tween', () => {
    const store = createStore(
      {getHeight: 1000, getTrunkHeightFraction: 100},
      {height: 10, trunkHeight: 2}
    );
    set(store, {height: 20, trunkHeight: 6});
    store.tick(50, 0.05);
    expect(read(store).height).toBeCloseTo(10.5, 9);
    expect(read(store).trunkHeight).toBeCloseTo(4, 9);
    store.tick(100, 0.1);
    expect(read(store).trunkHeight).toBe(6);
    expect(store.activeTweenCount).toBe(1);
  });

  it('prefers getCanopyColor over getSeason for the canopy tint', () => {
    const store = createStore(
      {getSeason: 3000, getCanopyColor: 1000},
      {canopyColor: [0, 0, 0, 255]}
    );
    set(store, {canopyColor: [100, 0, 0, 255]});
    store.tick(500, 0.5);
    expect(read(store).canopyColor[0]).toBeCloseTo(50, 9);
  });

  it('tweens crop slots independently of each other', () => {
    const onStart = vi.fn();
    const onInterrupt = vi.fn();
    const crop = (count: number) => ({count, radius: 0.1});
    const store = createStore(
      {getCrop: {duration: 1000, onStart, onInterrupt}},
      {crops: [crop(10), crop(10)]}
    );
    set(store, {crops: [crop(20), crop(10)]});
    expect(onStart).toHaveBeenCalledTimes(1);
    store.tick(500, 0.5);
    set(store, {crops: [crop(20), crop(30)]}, 500);
    expect(onInterrupt).not.toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledTimes(2);
    store.tick(1000, 1);
    expect(read(store).crops[0].count).toBe(20);
    expect(read(store).crops[1].count).toBeCloseTo(20, 9);
  });

  describe('setTransitions', () => {
    it('keeps a running tween on the settings it started with, as deck.gl does', () => {
      const store = createStore({getGrowth: 1000}, {growth: 0});
      set(store, {growth: 1});
      store.tick(500, 0.5);
      store.setTransitions({getGrowth: 100});
      store.tick(750, 0.75);
      expect(read(store).growth).toBeCloseTo(0.75, 12);
      set(store, {growth: 0}, 750);
      store.tick(800, 0.8);
      expect(read(store).growth).toBeCloseTo(0.375, 9);
    });

    it('moves everything still running to new settings on a retarget', () => {
      const crop = (count: number, ripeness: number) => ({count, ripeness});
      const store = createStore({getCrop: 1000}, {crops: [crop(0.5, 0)]});
      set(store, {crops: [crop(1.5, 0)]});
      store.tick(500, 0.5);
      store.setTransitions({getCrop: 100});
      set(store, {crops: [crop(1.5, 1)]}, 500);
      expect(read(store).crops[0].count).toBeCloseTo(1, 9);
      store.tick(550, 0.55);
      expect(read(store).crops[0].count).toBeCloseTo(1.25, 9);
      expect(read(store).crops[0].ripeness).toBeCloseTo(0.5, 9);
    });

    it('interrupts and finishes a group whose settings are removed', () => {
      const onInterrupt = vi.fn();
      const onEnd = vi.fn();
      const store = createStore(
        {getGrowth: {duration: 1000, onInterrupt, onEnd}, getHealth: 1000},
        {growth: 0, health: 0}
      );
      set(store, {growth: 1, health: 1});
      store.tick(500, 0.5);
      store.setTransitions({getHealth: 1000});
      expect(onInterrupt).toHaveBeenCalledTimes(1);
      expect(read(store).growth).toBe(1);
      expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(1);
      expect(read(store).health).toBeCloseTo(0.5, 12);
      store.setTransitions(null);
      expect(read(store).health).toBe(1);
      expect(store.activeTweenCount).toBe(0);
      expect(onEnd).not.toHaveBeenCalled();
    });

    it('interrupts tweens whose channels move to another group', () => {
      const onInterrupt = vi.fn();
      const store = createStore(
        {getPosition: {duration: 1000, onInterrupt}, getHeight: {duration: 1000, onInterrupt}},
        {position: [0, 0, 0], height: 10, trunkHeight: 1, growth: 0}
      );
      store.setTransitions({
        getPosition: {duration: 1000, onInterrupt},
        getHeight: {duration: 1000, onInterrupt},
        getGrowth: 1000
      });
      set(store, {position: [10, 10, 10], height: 20, trunkHeight: 2, growth: 1});
      store.tick(500, 0.5);
      expect(onInterrupt).not.toHaveBeenCalled();
      store.setTransitions({getElevation: 1000, getTrunkHeightFraction: 1000, getGrowth: 1000});
      expect(onInterrupt).toHaveBeenCalledTimes(2);
      expect(read(store).position).toEqual([10, 10, 10]);
      expect(read(store).height).toBe(20);
      expect(read(store).trunkHeight).toBe(2);
      expect(read(store).growth).toBeCloseTo(0.5, 12);
      set(store, {position: [10, 10, 0]}, 500);
      store.tick(1000, 1);
      expect(read(store).position).toEqual([10, 10, 5]);
    });

    it('interrupts tweens that a split reassigns even though their settings remain', () => {
      const onInterrupt = vi.fn();
      const getPosition = {duration: 1000, onInterrupt};
      const store = createStore({getPosition}, {position: [0, 0, 0]});
      set(store, {position: [10, 10, 10]});
      store.tick(500, 0.5);
      store.setTransitions({getPosition, getElevation: 1000});
      expect(onInterrupt).toHaveBeenCalledTimes(1);
      expect(read(store).position).toEqual([10, 10, 10]);
      expect(store.activeTweenCount).toBe(0);

      const heights = createStore(
        {getHeight: {duration: 1000, onInterrupt}},
        {height: 10, trunkHeight: 1}
      );
      set(heights, {height: 20, trunkHeight: 2});
      heights.tick(500, 0.5);
      heights.setTransitions({getHeight: {duration: 1000, onInterrupt}, getTrunkHeightFraction: 0});
      expect(onInterrupt).toHaveBeenCalledTimes(2);
      expect(read(heights).height).toBe(20);
      expect(read(heights).trunkHeight).toBe(2);
    });

    it('uses settings that changed in any field for the next tween', () => {
      const growth = (settings: TreeTransitions['getGrowth']) => {
        const store = createStore({getGrowth: {duration: 1000}}, {growth: 0});
        store.setTransitions({getGrowth: settings});
        set(store, {growth: 1});
        store.tick(500, 0.5);
        return store;
      };
      expect(read(growth({duration: 2000})).growth).toBeCloseTo(0.25, 12);
      expect(read(growth({duration: 1000, easing: t => t * t})).growth).toBeCloseTo(0.25, 12);

      const events: string[] = [];
      const log = (event: string) => () => {
        events.push(event);
      };
      const store = createStore(
        {getGrowth: {duration: 100, onStart: log('a'), onEnd: log('b'), onInterrupt: log('c')}},
        {growth: 0}
      );
      store.setTransitions({getGrowth: {duration: 100, onStart: log('d'), onEnd: log('e')}});
      set(store, {growth: 1});
      store.tick(100, 0.1);
      expect(events).toEqual(['d', 'e']);
      store.setTransitions({getGrowth: {duration: 100, onInterrupt: log('f')}});
      set(store, {growth: 0}, 100, 0.1);
      store.tick(150, 0.15);
      set(store, {growth: 1}, 150, 0.15);
      expect(events).toEqual(['d', 'e', 'f']);

      for (const name of ['onStart', 'onEnd', 'onInterrupt'] as const) {
        const before = vi.fn();
        const after = vi.fn();
        const others = {onStart: vi.fn(), onEnd: vi.fn(), onInterrupt: vi.fn()};
        const callbacks = createStore(
          {getGrowth: {duration: 100, ...others, [name]: before}},
          {growth: 0}
        );
        callbacks.setTransitions({getGrowth: {duration: 100, ...others, [name]: after}});
        set(callbacks, {growth: 1});
        callbacks.tick(50, 0.05);
        set(callbacks, {growth: 0}, 50, 0.05);
        callbacks.tick(200, 0.2);
        expect(before).not.toHaveBeenCalled();
        expect(after).toHaveBeenCalled();
      }

      const springs = (stiffness: number, damping: number) => {
        const spring = createStore(
          {getHeight: {type: 'spring', stiffness: 0.05, damping: 0.5}},
          {height: 10, trunkHeight: 1}
        );
        spring.setTransitions({getHeight: {type: 'spring', stiffness, damping}});
        set(spring, {height: 20, trunkHeight: 1});
        spring.tick(5 * FRAME_MS, 5 * FRAME_SECONDS);
        return read(spring).height;
      };
      expect(springs(0.2, 0.5)).toBeCloseTo(getSpringSeries(10, 20, 0.2, 0.5, 5)[5], 9);
      expect(springs(0.05, 0.2)).toBeCloseTo(getSpringSeries(10, 20, 0.05, 0.2, 5)[5], 9);

      const enter = createStore({getGrowth: {duration: 100, enter: () => [0]}}, {growth: 0});
      enter.setTransitions({getGrowth: {duration: 100, enter: () => [0.5]}});
      enter.setRow(0, {growth: 1}, {now: 0, clock: 0, isNew: true});
      expect(read(enter).growth).toBe(0.5);
    });

    it('ignores the same object, and treats an equal new object as no change', () => {
      const onStart = vi.fn();
      const transitions = {getGrowth: {duration: 1000, onStart}};
      const store = createStore(transitions, {growth: 0});
      set(store, {growth: 1});
      store.tick(500, 0.5);
      store.setTransitions(transitions);
      store.setTransitions({getGrowth: {duration: 1000, onStart}});
      store.setTransitions({...transitions, getLean: undefined});
      expect(store.activeTweenCount).toBe(1);
      expect(onStart).toHaveBeenCalledTimes(1);
      store.tick(750, 0.75);
      expect(read(store).growth).toBeCloseTo(0.75, 12);
    });

    it('accepts undefined and unknown keys', () => {
      const store = createStore(undefined as unknown as null, {growth: 0});
      store.setTransitions({getSomethingElse: 1000} as TreeTransitions);
      store.setTransitions(undefined);
      set(store, {growth: 1});
      expect(read(store).growth).toBe(1);
    });
  });
});

describe('TreeStateStore enter', () => {
  it('runs only for rows flagged new', () => {
    const enter = vi.fn(() => [0]);
    const store = new TreeStateStore(2);
    store.setTransitions({getGrowth: {duration: 1000, enter}});
    store.setRow(0, {growth: 0.75}, {now: 0, clock: 0});
    expect(enter).not.toHaveBeenCalled();
    expect(read(store).growth).toBe(0.75);
    store.setRow(0, {growth: 0.25}, {now: 0, clock: 0});
    expect(enter).not.toHaveBeenCalled();
    store.setRow(1, {growth: 0.5}, {now: 0, clock: 0, isNew: true});
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith([0.5]);
  });

  it('starts a new row from the value it gives, and tweens to the target with callbacks', () => {
    const events: string[] = [];
    const store = new TreeStateStore(1);
    store.setTransitions({
      getGrowth: {
        duration: 1000,
        enter: () => [0],
        onStart: () => events.push('start'),
        onEnd: () => events.push('end')
      }
    });
    store.setRow(0, {growth: 0.8}, {now: 0, clock: 0, isNew: true});
    expect(events).toEqual(['start']);
    expect(read(store).growth).toBe(0);
    expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(0);
    expect(store.isDirty).toBe(true);
    store.tick(500, 0.5);
    expect(read(store).growth).toBeCloseTo(0.4, 12);
    store.tick(1000, 1);
    expect(read(store).growth).toBe(0.8);
    expect(events).toEqual(['start', 'end']);
  });

  it('jumps a new row with no enter, with no tween and no callbacks', () => {
    const onStart = vi.fn();
    const store = new TreeStateStore(1);
    store.setTransitions({getGrowth: {duration: 1000, onStart}, getTree: 1000});
    store.setRow(0, FULL_VALUES, {now: 0, clock: 0, isNew: true});
    expect(read(store).growth).toBe(0.5);
    expect(store.activeTweenCount).toBe(0);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('jumps the first set of a row not flagged new, even with enter and settings', () => {
    const enter = vi.fn(() => [0]);
    const store = new TreeStateStore(1);
    store.setTransitions({getGrowth: {duration: 1000, enter}});
    store.setRow(0, {growth: 0.5}, {now: 0, clock: 0});
    expect(read(store).growth).toBe(0.5);
    expect(store.activeTweenCount).toBe(0);
    expect(enter).not.toHaveBeenCalled();
  });

  it('passes each group the array that matches its accessor', () => {
    const calls: Partial<Record<TreeTransitionKey, number[]>> = {};
    const capture = (key: TreeTransitionKey) => ({
      duration: 1000,
      enter: (toValue: number[]) => {
        calls[key] = [...toValue];
        return toValue;
      }
    });
    const keys: TreeTransitionKey[] = [
      'getGrowth',
      'getHealth',
      'getFoliage',
      'getFlush',
      'getLean',
      'getDamage',
      'getDecay',
      'getPosition',
      'getElevation',
      'getHeight',
      'getTrunkHeightFraction',
      'getCanopyRadius',
      'getTrunkRadius',
      'getCanopyColor',
      'getTrunkColor',
      'getCrop'
    ];
    const store = new TreeStateStore(1);
    store.setTransitions(Object.fromEntries(keys.map(key => [key, capture(key)])));
    store.setRow(0, FULL_VALUES, {now: 0, clock: 0, isNew: true});
    expect(calls).toEqual({
      getGrowth: [0.5],
      getHealth: [0.75],
      getFoliage: [0.625],
      getFlush: [0.125],
      getLean: [30, 90],
      getDamage: [0.25],
      getDecay: [0.0625],
      getPosition: [-122.4194, 37.7749, 12.5],
      getElevation: [12.5],
      getHeight: [7, 1.5, 1.5],
      getTrunkHeightFraction: [1.5 / 7],
      getCanopyRadius: [3.25, 2.75],
      getTrunkRadius: [0.2],
      getCanopyColor: [51, 102, 153, 204],
      getTrunkColor: [10, 20, 30, 40],
      getCrop: [30, 0.04, 0.75, 0.125, 244, 140, 24, 255, 20, 40, 60, 0]
    });
    // enter returned the target in every case, so nothing has anywhere to go.
    expect(store.activeTweenCount).toBe(0);
  });

  it('runs a getTree enter once per group, and a fade-in keeps its color', () => {
    const enter = vi.fn((toValue: number[]) => toValue);
    const store = new TreeStateStore(1);
    store.setTransitions({
      getTree: {duration: 1000, enter},
      getCanopyColor: {duration: 1000, enter: ([r, g, b]) => [r, g, b, 0]}
    });
    store.setRow(0, {canopyColor: [10, 20, 30, 200]}, {now: 0, clock: 0, isNew: true});
    expect(enter.mock.calls.length).toBeGreaterThan(5);
    expect(read(store).canopyColor).toEqual([10, 20, 30, 0]);
    store.tick(500, 0.5);
    expect(read(store).canopyColor).toEqual([10, 20, 30, 100]);
  });

  it('lifts a tree in on z through getPosition, with one transition', () => {
    const onStart = vi.fn();
    const store = new TreeStateStore(1);
    store.setTransitions({
      getPosition: {duration: 1000, onStart, enter: ([x, y, z]) => [x, y, z + 50]}
    });
    store.setRow(0, {position: [1, 2, 3]}, {now: 0, clock: 0, isNew: true});
    expect(read(store).position).toEqual([1, 2, 53]);
    expect(onStart).toHaveBeenCalledTimes(1);
    store.tick(500, 0.5);
    expect(read(store).position).toEqual([1, 2, 28]);
  });

  it('reads a getTrunkHeightFraction enter as a fraction', () => {
    const store = new TreeStateStore(1);
    store.setTransitions({getTrunkHeightFraction: {duration: 1000, enter: () => [0.1]}});
    store.setRow(0, {height: 20, trunkHeight: 10}, {now: 0, clock: 0, isNew: true});
    expect(read(store).trunkHeight).toBe(2);
    store.tick(1000, 1);
    expect(read(store).trunkHeight).toBe(10);
  });

  it('accepts a number, a short array, junk entries, and clamps the result', () => {
    const store = new TreeStateStore(1);
    store.setTransitions({
      getGrowth: {duration: 1000, enter: () => 0.25},
      getHealth: {duration: 1000, enter: () => [Number.NaN]},
      getFoliage: {duration: 1000, enter: () => [-3]},
      getLean: {duration: 1000, enter: () => [999, -90]},
      getCanopyColor: {duration: 1000, enter: () => [1000, Number.POSITIVE_INFINITY]},
      getCanopyRadius: {duration: 1000, enter: () => null as unknown as number[]},
      getHeight: {duration: 1000, enter: () => [1]}
    });
    store.setRow(
      0,
      {
        growth: 1,
        health: 0.5,
        foliage: 1,
        leanDegrees: 45,
        leanBearing: 10,
        canopyColor: [1, 2, 3, 4],
        crownX: 5,
        crownY: 6,
        height: 10,
        trunkHeight: 4
      },
      {now: 0, clock: 0, isNew: true}
    );
    const values = read(store);
    expect(values.growth).toBe(0.25);
    expect(values.health).toBe(0.5);
    expect(values.foliage).toBe(0);
    expect(values.leanDegrees).toBe(90);
    expect(values.leanBearing).toBe(270);
    expect(values.canopyColor).toEqual([255, 2, 3, 4]);
    expect(values.crownX).toBe(5);
    expect(values.crownY).toBe(6);
    expect(values.height).toBe(1);
    expect(values.trunkHeight).toBe(4);
  });

  it('moves from the clamped start, not from where a wild value would have put it', () => {
    const store = new TreeStateStore(1);
    store.setTransitions({getFoliage: {duration: 1000, enter: () => [-3]}});
    store.setRow(0, {foliage: 1}, {now: 0, clock: 0, isNew: true});
    store.tick(500, 0.5);
    expect(read(store).foliage).toBeCloseTo(0.5, 12);
  });

  it('runs with a spring too', () => {
    const store = new TreeStateStore(1);
    store.setTransitions({getHeight: {type: 'spring', enter: () => [0]}});
    store.setRow(0, {height: 10}, {now: 0, clock: 0, isNew: true});
    const series = getSpringSeries(0, 10, 0.05, 0.5, 10);
    expect(read(store).height).toBe(0);
    store.tick(10 * FRAME_MS, 10 * FRAME_SECONDS);
    expect(read(store).height).toBeCloseTo(series[10], 9);
  });

  it('replaces a row in use: tween interrupted, absent fields back to defaults', () => {
    const onInterrupt = vi.fn();
    const store = createStore(
      {getGrowth: {duration: 1000, onInterrupt, enter: () => [0]}},
      {growth: 0.2, health: 0.3, foliage: 0.4}
    );
    set(store, {growth: 1});
    store.tick(100, 0.1);
    store.setRow(0, {foliage: 0.9}, {now: 100, clock: 0.1, isNew: true});
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(read(store).health).toBe(1);
    expect(read(store).foliage).toBe(0.9);
    expect(read(store).growth).toBe(0);
    store.tick(600, 0.6);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
  });
});

describe('TreeStateStore spring', () => {
  it("follows deck.gl's per-frame formula at the default stiffness and damping", () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    const series = getSpringSeries(10, 20, 0.05, 0.5, 100);
    for (let frame = 0; frame <= 100; frame++) {
      expect(store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active).toBe(true);
      expect(read(store).height).toBeCloseTo(series[frame], 9);
    }
  });

  it('follows the formula at authored settings, when it overshoots', () => {
    const settings = {type: 'spring', stiffness: 0.2, damping: 0.1} as const;
    const store = createStore({getHeight: settings}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    const series = getSpringSeries(10, 20, 0.2, 0.1, 60);
    expect(Math.max(...series)).toBeGreaterThan(20);
    for (let frame = 0; frame <= 60; frame++) {
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      expect(read(store).height).toBeCloseTo(series[frame], 9);
    }
  });

  it('does not depend on the frame rate', () => {
    const runAt = (getNow: (frame: number) => number, frames: number) => {
      const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
      set(store, {height: 20, trunkHeight: 1});
      for (let frame = 0; frame < frames; frame++) store.tick(getNow(frame), getNow(frame) / 1000);
      store.tick(1000, 1);
      return read(store).height;
    };
    const at60 = runAt(frame => frame * FRAME_MS, 60);
    expect(at60).toBeCloseTo(getSpringSeries(10, 20, 0.05, 0.5, 60)[60], 9);
    expect(runAt(frame => frame * 2 * FRAME_MS, 30)).toBeCloseTo(at60, 9);
    expect(runAt(frame => (frame * FRAME_MS) / 2, 120)).toBeCloseTo(at60, 9);
    expect(runAt(frame => (frame * 1000) / 144, 144)).toBeCloseTo(at60, 9);
    expect(runAt(frame => frame * 100, 10)).toBeCloseTo(at60, 9);
    expect(runAt(() => 0, 1)).toBeCloseTo(at60, 9);
    expect(runAt(frame => (frame + Math.sin(frame * 9) * 0.45) * FRAME_MS, 59)).toBeCloseTo(
      at60,
      9
    );
  });

  it('moves smoothly between steps instead of holding, whatever the phase of the frames', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    let previous = 10;
    let previousDelta = 0;
    // 240 Hz frames, slightly out of phase with the 1/60 s steps, on the rising part of the curve.
    for (let frame = 1; frame < 40; frame++) {
      store.tick(frame * 4.1, (frame * 4.1) / 1000);
      const {height} = read(store);
      const delta = height - previous;
      expect(delta).toBeGreaterThan(0);
      if (frame > 8) expect(delta).toBeLessThan(previousDelta * 1.8 + 1e-9);
      previous = height;
      previousDelta = delta;
    }
  });

  it('ends when velocity and distance are both tiny, exactly on target, once', () => {
    const onEnd = vi.fn();
    const store = createStore({getGrowth: {type: 'spring', onEnd}}, {growth: 0});
    set(store, {growth: 1});
    const series = getSpringSeries(0, 1, 0.05, 0.5, 2000);
    const settleStep = series.findIndex(
      (value, i) => i > 0 && Math.abs(value - 1) < 1e-5 && Math.abs(value - series[i - 1]) < 1e-5
    );
    expect(settleStep).toBeGreaterThan(10);
    for (let frame = 0; frame < settleStep; frame++) {
      expect(store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active).toBe(true);
      expect(onEnd).not.toHaveBeenCalled();
    }
    store.tick(settleStep * FRAME_MS, settleStep * FRAME_SECONDS);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(read(store).growth).toBe(1);
    expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(1);
    expect(store.activeTweenCount).toBe(0);
    store.tick(99999, 1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('settles a position closely enough not to snap in longitude and latitude', () => {
    const store = createStore({getPosition: {type: 'spring'}}, {position: [-122.42, 37.77, 0]});
    set(store, {position: [-122.41, 37.78, 0]});
    let frame = 0;
    let last = read(store).position[0];
    while (store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active) {
      last = read(store).position[0];
      frame++;
      expect(frame).toBeLessThan(2000);
    }
    expect(Math.abs(last - -122.41)).toBeLessThan(2e-9);
    expect(read(store).position[0]).toBe(-122.41);
  });

  it('keeps velocity across a retarget and stays continuous', () => {
    const events: string[] = [];
    const store = createStore(
      {
        getHeight: {
          type: 'spring',
          onStart: () => events.push('start'),
          onEnd: () => events.push('end'),
          onInterrupt: () => events.push('interrupt')
        }
      },
      {height: 10, trunkHeight: 1}
    );
    set(store, {height: 20, trunkHeight: 1});
    const series = getSpringSeries(10, 20, 0.05, 0.5, 30);
    store.tick(30 * FRAME_MS, 30 * FRAME_SECONDS);
    const atRetarget = read(store).height;
    expect(atRetarget).toBeCloseTo(series[30], 9);

    // Retargeting downward from a rising spring: it must keep rising before it turns.
    set(store, {height: 0, trunkHeight: 1}, 30 * FRAME_MS, 30 * FRAME_SECONDS);
    expect(read(store).height).toBe(atRetarget);
    expect(events).toEqual(['start', 'interrupt', 'start']);

    let previous = series[29];
    let current = series[30];
    for (let frame = 31; frame < 60; frame++) {
      const velocity = current - previous;
      const next = current + velocity + (0 - current) * 0.05 - velocity * 0.5;
      previous = current;
      current = next;
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      expect(read(store).height).toBeCloseTo(current, 9);
    }
    let frame = 60;
    while (store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active) frame++;
    expect(read(store).height).toBe(0);
    expect(events).toEqual(['start', 'interrupt', 'start', 'end']);
  });

  it('stays continuous when retargeted between its steps', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    const now = 30.5 * FRAME_MS;
    store.tick(now, now / 1000);
    const before = read(store).height;
    set(store, {height: 40, trunkHeight: 1}, now);
    expect(read(store).height).toBe(before);
    store.tick(now, now / 1000);
    expect(read(store).height).toBe(before);
    store.tick(now + 0.01, now / 1000);
    expect(Math.abs(read(store).height - before)).toBeLessThan(0.01);
  });

  it('runs a retarget every frame without stalling', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    let previous = 10;
    for (let frame = 1; frame < 60; frame++) {
      const now = frame * FRAME_MS;
      set(store, {height: 100 + frame, trunkHeight: 1}, now);
      store.tick(now, now / 1000);
      const {height} = read(store);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
    expect(previous).toBeGreaterThan(50);
  });

  it('clamps what it writes, not its motion, so 0-1 fields overshoot safely', () => {
    const settings = {type: 'spring', stiffness: 0.2, damping: 0.1} as const;
    const store = createStore({getFoliage: settings}, {foliage: 1});
    set(store, {foliage: 0});
    const series = getSpringSeries(1, 0, 0.2, 0.1, 40);
    expect(Math.min(...series)).toBeLessThan(0);
    for (let frame = 0; frame <= 40; frame++) {
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      const expected = Math.max(0, Math.min(1, series[frame]));
      expect(read(store).foliage).toBeCloseTo(expected, 9);
      expect(readFloat(store, 0, TEXEL.LIFE, 2)).toBeCloseTo(expected, 5);
      expect(readRate(store, 'foliage')).toBeGreaterThanOrEqual(0);
      // The fall is what the rate measures, so it drains away over frames once foliage reaches 0,
      // however far the spring's own motion overshoots, and however it comes back.
      if (series[frame] < 0 && series[frame - 1] >= 0)
        expect(readRate(store, 'foliage')).toBeGreaterThan(0);
    }
  });

  it('holds while the timeline is paused', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    store.tick(200, 0.2);
    const {height} = read(store);
    store.clearDirty();
    for (let i = 0; i < 5; i++) expect(store.tick(200, 0.2).changed).toBe(false);
    expect(read(store).height).toBe(height);
    expect(store.isDirty).toBe(false);
    store.tick(100, 0.1);
    expect(read(store).height).toBe(height);
  });

  it('does not end when it merely passes through its target at speed', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    const series = getSpringSeries(10, 20, 0.05, 0.5, 20);
    store.tick(20 * FRAME_MS, 20 * FRAME_SECONDS);
    // Solved so that the next step lands exactly on the new target, still moving.
    const velocity = series[20] - series[19];
    const target = series[20] + (velocity * 0.5) / 0.95;
    set(store, {height: target, trunkHeight: 1}, 20 * FRAME_MS, 20 * FRAME_SECONDS);
    expect(store.tick(21 * FRAME_MS, 21 * FRAME_SECONDS).active).toBe(true);
    expect(read(store).height).toBeCloseTo(target, 9);
    store.tick(25 * FRAME_MS, 25 * FRAME_SECONDS);
    expect(read(store).height).toBeGreaterThan(target);
    store.tick(1000000, 1000);
    expect(read(store).height).toBe(target);
  });

  it('carries the velocity it had at that moment when retargeted between steps', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    const series = getSpringSeries(10, 20, 0.05, 0.5, 40);
    const now = 30.5 * FRAME_MS;
    store.tick(now, now / 1000);
    set(store, {height: 40, trunkHeight: 1}, now);

    const step = (position: number, velocity: number, to: number) =>
      position + velocity + (to - position) * 0.05 - velocity * 0.5;
    let current = series[30] + (series[31] - series[30]) * 0.5;
    const velocityBefore = series[30] - series[29];
    const velocityAfter = series[31] - series[30];
    let velocity = velocityBefore + (velocityAfter - velocityBefore) * 0.5;
    for (let i = 1; i <= 10; i++) {
      const next = step(current, velocity, 40);
      velocity = next - current;
      current = next;
      store.tick(now + i * FRAME_MS, (now + i * FRAME_MS) / 1000);
      expect(read(store).height).toBeCloseTo(current, 9);
    }
  });

  it('starts at rest when retargeted after a gap so long that it had finished', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    store.tick(5 * FRAME_MS, 5 * FRAME_SECONDS);
    const now = 10 * 60 * 1000;
    set(store, {height: 30, trunkHeight: 1}, now, 600);
    expect(read(store).height).toBe(20);
    store.tick(now + 10 * FRAME_MS, 600 + 10 * FRAME_SECONDS);
    expect(read(store).height).toBeCloseTo(getSpringSeries(20, 30, 0.05, 0.5, 10)[10], 9);
  });

  it('finishes at once after a huge time gap instead of simulating it', () => {
    const onEnd = vi.fn();
    const rows = 2000;
    const store = createStore(
      {getGrowth: {type: 'spring', stiffness: 0.0001, damping: 1, onEnd}},
      {growth: 0},
      rows
    );
    for (let row = 0; row < rows; row++) set(store, {growth: 1}, 0, 0, row);
    store.tick(10, 0.01);
    // Simulating this would be some 200 million steps.
    const start = performance.now();
    store.tick(1e9, 1e6);
    expect(performance.now() - start).toBeLessThan(50);
    expect(onEnd).toHaveBeenCalledTimes(rows);
    expect(read(store, rows - 1).growth).toBe(1);
  });

  for (const [label, settings, atTarget] of [
    ['a NaN stiffness', {stiffness: Number.NaN}, true],
    ['a zero stiffness', {stiffness: 0}, true],
    ['a negative stiffness', {stiffness: -1}, true],
    ['an infinite damping', {damping: Number.POSITIVE_INFINITY}, true],
    ['an unstable stiffness', {stiffness: 50, damping: 0.5}, true],
    ['an unstable damping', {stiffness: 0.1, damping: 5}, true],
    ['no damping', {stiffness: 0.1, damping: 0}, true]
  ] as const) {
    it(`always settles with ${label}`, () => {
      const store = createStore(
        {getHeight: {type: 'spring', ...settings}},
        {height: 10, trunkHeight: 1}
      );
      set(store, {height: 20, trunkHeight: 1});
      let frame = 0;
      while (store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active) {
        expect(Number.isFinite(read(store).height)).toBe(true);
        frame += 10;
        expect(frame).toBeLessThan(2e6);
      }
      expect(atTarget).toBe(true);
      expect(read(store).height).toBe(20);
    });
  }

  it('hands over between interpolation and spring without a jump', () => {
    const store = createStore({getHeight: 1000}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    store.tick(500, 0.5);
    expect(read(store).height).toBeCloseTo(15, 9);

    store.setTransitions({getHeight: {type: 'spring'}});
    set(store, {height: 30, trunkHeight: 1}, 500);
    expect(read(store).height).toBeCloseTo(15, 9);
    store.tick(500 + 10 * FRAME_MS, 0.6);
    expect(read(store).height).toBeCloseTo(getSpringSeries(15, 30, 0.05, 0.5, 10)[10], 9);
    const atHandover = read(store).height;

    store.setTransitions({getHeight: 1000});
    const handoverTime = 500 + 10 * FRAME_MS;
    set(store, {height: 40, trunkHeight: 1}, handoverTime);
    expect(read(store).height).toBe(atHandover);
    store.tick(handoverTime + 500, 1);
    expect(read(store).height).toBeCloseTo((atHandover + 40) / 2, 9);
  });

  it('restarts a spring cleanly after it settled, with no leftover velocity', () => {
    const store = createStore({getHeight: {type: 'spring'}}, {height: 10, trunkHeight: 1});
    set(store, {height: 20, trunkHeight: 1});
    store.tick(100000, 100);
    expect(read(store).height).toBe(20);
    set(store, {height: 30, trunkHeight: 1}, 100000, 100);
    store.tick(100000 + 10 * FRAME_MS, 100 + 10 * FRAME_SECONDS);
    expect(read(store).height).toBeCloseTo(getSpringSeries(20, 30, 0.05, 0.5, 10)[10], 9);
  });
});

describe('TreeStateStore lean', () => {
  const LEANING = {leanDegrees: 30, leanBearing: 350};

  it('takes the short way across north, in both directions', () => {
    const store = createStore({getLean: 1000}, LEANING);
    set(store, {leanDegrees: 30, leanBearing: 10});
    store.tick(250, 0.25);
    expect(read(store).leanBearing).toBeCloseTo(355, 9);
    store.tick(500, 0.5);
    expect(read(store).leanBearing).toBeCloseTo(0, 9);
    store.tick(750, 0.75);
    expect(read(store).leanBearing).toBeCloseTo(5, 9);
    store.tick(1000, 1);
    expect(read(store).leanBearing).toBe(10);
    expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(((90 - 10) * Math.PI) / 180, 6);

    const back = createStore({getLean: 1000}, {leanDegrees: 30, leanBearing: 10});
    set(back, LEANING);
    back.tick(500, 0.5);
    expect(back.getRowValues(0).leanBearing).toBeCloseTo(0, 9);
    back.tick(750, 0.75);
    expect(back.getRowValues(0).leanBearing).toBeCloseTo(355, 9);
    back.tick(1000, 1);
    expect(back.getRowValues(0).leanBearing).toBe(350);
  });

  it('writes the angle it interpolates to the state row', () => {
    const store = createStore({getLean: 1000}, LEANING);
    set(store, {leanDegrees: 60, leanBearing: 10});
    store.tick(500, 0.5);
    expect(readFloat(store, 0, TEXEL.POSE, 0)).toBeCloseTo((45 * Math.PI) / 180, 6);
    expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('takes the short way with a spring', () => {
    const store = createStore({getLean: {type: 'spring'}}, LEANING);
    set(store, {leanDegrees: 30, leanBearing: 10});
    const series = getSpringSeries(350, 370, 0.05, 0.5, 40);
    for (let frame = 0; frame <= 40; frame++) {
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      expect(read(store).leanBearing).toBeCloseTo(series[frame] % 360, 9);
    }
    store.tick(100000, 100);
    expect(read(store).leanBearing).toBe(10);
  });

  it('retargets across north from the current bearing', () => {
    const store = createStore({getLean: 1000}, {leanDegrees: 30, leanBearing: 340});
    set(store, {leanDegrees: 30, leanBearing: 40});
    store.tick(500, 0.5);
    expect(read(store).leanBearing).toBeCloseTo(10, 9);
    set(store, {leanDegrees: 30, leanBearing: 330}, 500);
    store.tick(1000, 1);
    expect(read(store).leanBearing).toBeCloseTo(350, 9);
    store.tick(1500, 1.5);
    expect(read(store).leanBearing).toBe(330);
  });

  it('falls straight toward its bearing from upright, without spinning', () => {
    for (const settings of [1000, {type: 'spring'} as const]) {
      const store = createStore({getLean: settings}, {leanDegrees: 0, leanBearing: 0});
      set(store, {leanDegrees: 80, leanBearing: 200});
      expect(read(store).leanBearing).toBe(200);
      for (let frame = 0; frame < 40; frame++) {
        store.tick(frame * 20, frame * 0.02);
        expect(read(store).leanBearing).toBe(200);
      }
    }
  });

  it('holds its bearing while returning upright, then takes the target at the end', () => {
    for (const settings of [1000, {type: 'spring'} as const]) {
      const store = createStore({getLean: settings}, {leanDegrees: 40, leanBearing: 120});
      set(store, {leanDegrees: 0, leanBearing: 300});
      for (let frame = 0; frame < 20; frame++) {
        store.tick(frame * 20, frame * 0.02);
        expect(read(store).leanBearing).toBe(120);
      }
      store.tick(1e6, 1000);
      expect(read(store).leanDegrees).toBe(0);
      expect(read(store).leanBearing).toBe(300);
      const radians = (300 * Math.PI) / 180;
      expect(readFloat(store, 0, TEXEL.POSE, 1)).toBeCloseTo(
        Math.atan2(Math.cos(radians), Math.sin(radians)),
        5
      );
    }
  });

  it('stops a spring turning when it starts returning upright', () => {
    const store = createStore({getLean: {type: 'spring'}}, {leanDegrees: 40, leanBearing: 100});
    set(store, {leanDegrees: 40, leanBearing: 200});
    store.tick(20 * FRAME_MS, 20 * FRAME_SECONDS);
    const {leanBearing: turning} = read(store);
    expect(turning).toBeGreaterThan(110);
    expect(turning).toBeLessThan(190);
    set(store, {leanDegrees: 0, leanBearing: 200}, 20 * FRAME_MS, 20 * FRAME_SECONDS);
    for (let frame = 21; frame < 30; frame++) {
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      expect(read(store).leanBearing).toBe(turning);
    }
  });

  it('turns toward a new target once it is no longer returning upright', () => {
    const store = createStore({getLean: 1000}, {leanDegrees: 40, leanBearing: 120});
    set(store, {leanDegrees: 0, leanBearing: 120});
    store.tick(500, 0.5);
    set(store, {leanDegrees: 40, leanBearing: 140}, 500);
    store.tick(1000, 1);
    expect(read(store).leanBearing).toBeCloseTo(130, 9);
    expect(read(store).leanDegrees).toBeCloseTo(30, 9);
  });

  it('still takes the short way when it stays upright throughout', () => {
    const store = createStore({getLean: 1000}, {leanDegrees: 0, leanBearing: 350});
    set(store, {leanDegrees: 0, leanBearing: 10});
    store.tick(500, 0.5);
    expect(read(store).leanBearing).toBeCloseTo(0, 9);
  });

  it('does not restart a bearing when only the angle is retargeted', () => {
    const easing = (t: number) => t * t;
    const store = createStore(
      {getLean: {duration: 1000, easing}},
      {leanDegrees: 10, leanBearing: 350}
    );
    set(store, {leanDegrees: 10, leanBearing: 10});
    store.tick(500, 0.5);
    expect(read(store).leanBearing).toBeCloseTo(355, 9);
    set(store, {leanDegrees: 40, leanBearing: 10}, 500);
    store.tick(750, 0.75);
    expect(read(store).leanBearing).toBeCloseTo((350 + 20 * 0.75 * 0.75) % 360, 9);
    store.tick(1000, 1);
    expect(read(store).leanBearing).toBe(10);
    expect(store.activeTweenCount).toBe(1);
  });

  it('does not retarget a running tween for the same bearing written another way', () => {
    const onInterrupt = vi.fn();
    const store = createStore(
      {getLean: {duration: 1000, onInterrupt}},
      {leanDegrees: 30, leanBearing: 350}
    );
    set(store, {leanBearing: 10});
    store.tick(500, 0.5);
    set(store, {leanBearing: 370}, 500);
    set(store, {leanBearing: -350}, 500);
    expect(onInterrupt).not.toHaveBeenCalled();
    store.tick(750, 0.75);
    expect(read(store).leanBearing).toBeCloseTo(5, 9);
  });

  it('starts a new row exactly on the bearing that enter gives', () => {
    const store = new TreeStateStore(1);
    store.setTransitions({getLean: {duration: 1000, enter: () => [10, 0.1]}});
    store.setRow(0, {leanDegrees: 40, leanBearing: 0.2}, {now: 0, clock: 0, isNew: true});
    expect(read(store).leanBearing).toBe(0.1);
  });

  it('reads back a bearing exactly, and keeping it does not count as a change', () => {
    const store = createStore(null, {leanDegrees: 30, leanBearing: 0.1});
    expect(read(store).leanBearing).toBe(0.1);
    set(store, {leanDegrees: 30});
    set(store, {});
    expect(store.isDirty).toBe(false);
    expect(read(store).leanBearing).toBe(0.1);
  });

  it('treats equal bearings as equal, whichever turn of the circle they are given in', () => {
    const store = createStore({getLean: 1000}, {leanDegrees: 30, leanBearing: 10});
    for (const bearing of [10, 370, -350, 730]) {
      set(store, {leanBearing: bearing});
      expect(read(store).leanBearing).toBeCloseTo(10, 9);
      expect(store.activeTweenCount).toBe(0);
    }
    expect(store.isDirty).toBe(false);
    set(store, {leanBearing: -10});
    store.tick(1000, 1);
    expect(read(store).leanBearing).toBe(350);
  });
});

describe('TreeStateStore loss rates', () => {
  /** Runs one frame of data-driven values, with no transitions. */
  const frameOf = (store: TreeStateStore, values: TreeStateUpdate, frame: number) => {
    const now = frame * FRAME_MS;
    store.setRow(0, values, {now, clock: frame * FRAME_SECONDS});
    return store.tick(now, frame * FRAME_SECONDS);
  };

  it('is 0 while a value is constant, with nothing kept active', () => {
    const store = createStore(null, {foliage: 0.5});
    for (let frame = 1; frame < 10; frame++) {
      expect(frameOf(store, {foliage: 0.5}, frame).active).toBe(false);
      expect(readRate(store, 'foliage')).toBe(0);
    }
  });

  it('is 0 while a value rises, including from the first frame it rises', () => {
    const store = createStore(null, {foliage: 0.1});
    for (let frame = 1; frame < 10; frame++) {
      expect(frameOf(store, {foliage: 0.1 + frame * 0.01}, frame).active).toBe(false);
      expect(readRate(store, 'foliage')).toBe(0);
    }
  });

  it('drops to 0 the moment a falling value rises', () => {
    const store = createStore(null, {foliage: 0.5});
    for (let frame = 1; frame <= 6; frame++) frameOf(store, {foliage: 0.5 - frame * 0.01}, frame);
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    frameOf(store, {foliage: 0.45}, 7);
    expect(readRate(store, 'foliage')).toBe(0);
  });

  it('reaches the true rate of equal per-frame decreases, and holds it', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 20; frame++) {
      frameOf(store, {foliage: 1 - frame * 0.01}, frame);
      expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    }
  });

  it('returns to exactly 0 within a few frames of the value stopping, falling all the way', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 20; frame++) frameOf(store, {foliage: 1 - frame * 0.01}, frame);
    const rates: number[] = [];
    let frame = 21;
    let active = true;
    while (active) {
      active = frameOf(store, {foliage: 0.8}, frame++).active;
      rates.push(readRate(store, 'foliage'));
      expect(rates.length).toBeLessThan(10);
    }
    expect(rates.length).toBeLessThanOrEqual(4);
    expect(rates.at(-1)).toBe(0);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThan(rates[i - 1]);
    expect(rates[0]).toBeGreaterThan(0);
  });

  it('follows the value through ticks alone once data stops arriving', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 10; frame++) frameOf(store, {foliage: 1 - frame * 0.01}, frame);
    let frame = 11;
    for (; frame < 15; frame++) store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
    expect(readRate(store, 'foliage')).toBe(0);
    expect(store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active).toBe(false);
  });

  it('works from setRow alone, for a caller that ticks later or not at all', () => {
    const store = new TreeStateStore(1);
    store.setRow(0, {foliage: 1}, {now: 0, clock: 0, isNew: true});
    for (let frame = 1; frame <= 8; frame++) {
      store.setRow(0, {foliage: 1 - frame * 0.01}, {now: 0, clock: frame * FRAME_SECONDS});
      expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    }
    for (let frame = 9; frame <= 12; frame++)
      store.setRow(0, {foliage: 0.92}, {now: 0, clock: frame * FRAME_SECONDS});
    expect(readRate(store, 'foliage')).toBe(0);
    expect(store.tick(0, 12 * FRAME_SECONDS).active).toBe(false);
  });

  it('keeps ticking active until the rate reaches 0, so nothing is left in mid-air', () => {
    const store = createStore({getFoliage: 1000}, {foliage: 1});
    set(store, {foliage: 0});
    let frame = 0;
    while (frame * FRAME_MS < 1000) {
      expect(store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active).toBe(true);
      frame++;
    }
    let tailFrames = 0;
    while (store.tick(frame * FRAME_MS, frame * FRAME_SECONDS).active) {
      frame++;
      tailFrames++;
      expect(store.activeTweenCount).toBe(0);
      expect(readRate(store, 'foliage')).toBeGreaterThan(0);
      expect(tailFrames).toBeLessThan(10);
    }
    expect(tailFrames).toBeGreaterThan(0);
    expect(readRate(store, 'foliage')).toBe(0);
    expect(read(store).foliage).toBe(0);
  });

  it('measures a tween, tracking how fast an eased curve really falls', () => {
    const linear = createStore({getDamage: 2000}, {damage: 1});
    set(linear, {damage: 0});
    for (let frame = 1; frame < 100; frame++) {
      linear.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      expect(readRate(linear, 'damage')).toBeCloseTo(0.5, 5);
    }

    const easing = (t: number) => t * t * (3 - 2 * t);
    const eased = createStore({getFoliage: {duration: 2000, easing}}, {foliage: 1});
    set(eased, {foliage: 0});
    for (let frame = 1; frame < 120; frame++) {
      eased.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      const t = (frame * FRAME_SECONDS) / 2;
      // The slope of smoothstep over 2 s, a little behind because the secant looks back two frames.
      const slope = (6 * t * (1 - t)) / 2;
      expect(Math.abs(readRate(eased, 'foliage') - slope)).toBeLessThan(0.05);
    }
  });

  it('measures a tween while setRow keeps being called with the same target, as a layer does', () => {
    const store = createStore({getFoliage: 1000}, {foliage: 1});
    set(store, {foliage: 0});
    for (let frame = 1; frame < 50; frame++) {
      const now = frame * FRAME_MS;
      store.setRow(0, {foliage: 0}, {now, clock: frame * FRAME_SECONDS});
      expect(readRate(store, 'foliage')).toBeLessThan(1.001);
      store.tick(now, frame * FRAME_SECONDS);
      expect(readRate(store, 'foliage')).toBeCloseTo(1, 4);
      expect(read(store).foliage).toBeCloseTo(1 - frame * FRAME_SECONDS, 9);
    }
  });

  it('is 0 after a clock jump above 0.25 s, then right again on the next frame', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 10; frame++) frameOf(store, {foliage: 1 - frame * 0.01}, frame);
    store.setRow(0, {foliage: 0.5}, {now: 5000, clock: 5});
    expect(readRate(store, 'foliage')).toBe(0);
    expect(store.tick(5000, 5).active).toBe(false);
    store.setRow(0, {foliage: 0.49}, {now: 5016, clock: 5 + FRAME_SECONDS});
    expect(store.tick(5016, 5 + FRAME_SECONDS).active).toBe(true);
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
  });

  it('treats 0.25 s as a usable step and anything above it as a jump', () => {
    const atLimit = createStore(null, {foliage: 1});
    atLimit.setRow(0, {foliage: 0.75}, {now: 250, clock: 0.25});
    expect(readRate(atLimit, 'foliage')).toBe(1);

    const above = createStore(null, {foliage: 1});
    above.setRow(0, {foliage: 0.75}, {now: 260, clock: 0.26});
    expect(readRate(above, 'foliage')).toBe(0);

    const ticking = createStore({getFoliage: 1000}, {foliage: 1});
    set(ticking, {foliage: 0});
    ticking.tick(100, 0.1);
    ticking.tick(116, 0.116);
    expect(readRate(ticking, 'foliage')).toBeGreaterThan(0);
    ticking.tick(500, 0.5);
    expect(readRate(ticking, 'foliage')).toBe(0);
  });

  it('gets the rate right at a random-access frame rendered as t - 1/60, then t', () => {
    const getFoliage = (t: number) => 0.9 - 0.02 * t;
    for (const t of [20, 7.5, 40.25]) {
      const store = new TreeStateStore(1);
      store.setRow(0, {foliage: getFoliage(0)}, {now: 0, clock: 0, isNew: true});
      store.tick(0, 0);
      store.setRow(0, {foliage: getFoliage(t - FRAME_SECONDS)}, {now: 0, clock: t - FRAME_SECONDS});
      store.tick(0, t - FRAME_SECONDS);
      expect(readRate(store, 'foliage')).toBe(0);
      store.setRow(0, {foliage: getFoliage(t)}, {now: 0, clock: t});
      store.tick(0, t);
      expect(readRate(store, 'foliage')).toBeCloseTo(0.02, 5);
    }
  });

  it('gives the same rate scrubbing back through a fall as playing it', () => {
    const getFoliage = (t: number) => 1 - 0.6 * t;
    const store = createStore(null, {foliage: getFoliage(1)});
    store.setRow(0, {}, {now: 0, clock: 1});
    store.tick(0, 1);
    let previous = 0;
    for (let frame = 1; frame <= 10; frame++) {
      const clock = 1 - frame * FRAME_SECONDS;
      store.setRow(0, {foliage: getFoliage(clock)}, {now: 0, clock});
      store.tick(0, clock);
      previous = readRate(store, 'foliage');
      expect(previous).toBeCloseTo(0.6, 4);
    }
    // Turning around mid-fall keeps the same slope.
    const clock = 1 - 9 * FRAME_SECONDS;
    store.setRow(0, {foliage: getFoliage(clock)}, {now: 0, clock});
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
  });

  it('keeps a sound rate when a scrub turns around and revisits the same clocks', () => {
    const getFoliage = (t: number) => 0.9 - 0.3 * t;
    const store = createStore(null, {foliage: getFoliage(0)});
    for (const frame of [1, 2, 3, 4, 3, 2, 1, 0, 1, 2]) {
      const clock = frame * FRAME_SECONDS;
      store.setRow(0, {foliage: getFoliage(clock)}, {now: 0, clock});
      store.tick(0, clock);
      expect(readRate(store, 'foliage')).toBeCloseTo(0.3, 4);
    }
  });

  it('is 0 scrubbing back through a rise, since the value rises against the clock', () => {
    const getFoliage = (t: number) => 0.2 + 0.6 * t;
    const store = createStore(null, {foliage: getFoliage(1)});
    store.setRow(0, {}, {now: 0, clock: 1});
    store.tick(0, 1);
    for (let frame = 1; frame <= 5; frame++) {
      const clock = 1 - frame * FRAME_SECONDS;
      store.setRow(0, {foliage: getFoliage(clock)}, {now: 0, clock});
      store.tick(0, clock);
      expect(readRate(store, 'foliage')).toBe(0);
    }
  });

  it('is 0 when a value changes with the clock stopped, as with a slider on a paused film', () => {
    const store = createStore(null, {foliage: 1});
    store.setRow(0, {}, {now: 0, clock: 7});
    store.tick(0, 7);
    store.setRow(0, {}, {now: 0, clock: 7 + FRAME_SECONDS});
    store.tick(0, 7 + FRAME_SECONDS);
    for (const foliage of [0.8, 0.6, 0.4]) {
      store.setRow(0, {foliage}, {now: 0, clock: 7 + FRAME_SECONDS});
      expect(store.tick(0, 7 + FRAME_SECONDS).active).toBe(false);
      expect(readRate(store, 'foliage')).toBe(0);
    }
    // Moving on from there is a fresh start, not a spike from the slider's whole travel.
    store.setRow(0, {foliage: 0.4}, {now: 0, clock: 7 + 2 * FRAME_SECONDS});
    store.tick(0, 7 + 2 * FRAME_SECONDS);
    expect(readRate(store, 'foliage')).toBe(0);
  });

  it('holds while the clock is stopped, so things in flight wait, then carries on', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 10; frame++) frameOf(store, {foliage: 1 - frame * 0.01}, frame);
    for (let i = 0; i < 5; i++) {
      expect(store.tick(5000 + i * 16, 10 * FRAME_SECONDS)).toEqual({changed: false, active: true});
      expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    }
    frameOf(store, {foliage: 0.89}, 11);
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
  });

  it('does not flicker when data arrives every second frame', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 40; frame++) {
      frameOf(store, {foliage: 1 - Math.floor(frame / 2) * 0.02}, frame);
      if (frame > 6) expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    }
  });

  it('reads a single drop as a brief spike that lands', () => {
    const store = createStore(null, {foliage: 1});
    frameOf(store, {foliage: 0.5}, 1);
    expect(readRate(store, 'foliage')).toBeCloseTo(30, 3);
    let frame = 2;
    while (frameOf(store, {foliage: 0.5}, frame).active) frame++;
    expect(frame).toBeLessThanOrEqual(5);
    expect(readRate(store, 'foliage')).toBe(0);
  });

  it("tracks foliage, damage and both crops' fallen separately, each in its own texel", () => {
    const crop = (fallen: number) => ({count: 5, radius: 0.1, fallen});
    const store = createStore(null, {foliage: 1, damage: 1, crops: [crop(1), crop(1)]});
    for (let frame = 1; frame <= 8; frame++) {
      frameOf(
        store,
        {
          foliage: 1 - frame * 0.01,
          damage: 1 - frame * 0.02,
          crops: [crop(1 - frame * 0.03), crop(1 - frame * 0.04)]
        },
        frame
      );
    }
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    expect(readRate(store, 'damage')).toBeCloseTo(1.2, 4);
    expect(readRate(store, 'fallen0')).toBeCloseTo(1.8, 4);
    expect(readRate(store, 'fallen1')).toBeCloseTo(2.4, 4);
    for (const i of [0, 1, 2])
      expect(readFloat(store, 0, TEXEL.CROP0_UNRIPE, i)).toBeCloseTo([86, 128, 44][i] / 255, 6);
    // A color update does not touch the rate sharing its texel.
    frameOf(
      store,
      {
        foliage: 1 - 9 * 0.01,
        damage: 1 - 9 * 0.02,
        crops: [{...crop(1 - 9 * 0.03), unripeColor: [1, 2, 3, 255]}, crop(1 - 9 * 0.04)]
      },
      9
    );
    expect(readRate(store, 'fallen0')).toBeCloseTo(1.8, 4);
    expect(readFloat(store, 0, TEXEL.CROP0_UNRIPE, 0)).toBeCloseTo(1 / 255, 6);
  });

  it('measures a crop tween', () => {
    const crop = (fallen: number) => ({count: 5, radius: 0.1, fallen});
    const store = createStore({getCrop: 1000}, {crops: [crop(0), crop(1)]});
    set(store, {crops: [crop(0), crop(0)]});
    for (let frame = 1; frame < 50; frame++) {
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      expect(readRate(store, 'fallen1')).toBeCloseTo(1, 4);
      expect(readRate(store, 'fallen0')).toBe(0);
    }
  });

  it('measures fallen and damage as they rise, since that is when things fall', () => {
    const crop = (fallen: number) => ({count: 5, radius: 0.1, fallen});
    const store = createStore(null, {damage: 0, foliage: 0.1, crops: [crop(0), crop(0)]});
    for (let frame = 1; frame <= 8; frame++) {
      frameOf(
        store,
        {
          damage: frame * 0.02,
          foliage: 0.1 + frame * 0.01,
          crops: [crop(frame * 0.03), crop(frame * 0.04)]
        },
        frame
      );
      expect(readRate(store, 'damage')).toBeCloseTo(1.2, 4);
      expect(readRate(store, 'fallen0')).toBeCloseTo(1.8, 4);
      expect(readRate(store, 'fallen1')).toBeCloseTo(2.4, 4);
      // Falling is what foliage loses by; a rise grows leaves in place.
      expect(readRate(store, 'foliage')).toBe(0);
    }
  });

  it('brings a rising fallen to rest, and measures a tween of it', () => {
    const crop = (fallen: number) => ({count: 5, radius: 0.1, fallen});
    const held = createStore(null, {crops: [crop(0), crop(0)]});
    for (let frame = 1; frame <= 8; frame++)
      frameOf(held, {crops: [crop(frame * 0.03), crop(0)]}, frame);
    let frame = 9;
    while (frameOf(held, {crops: [crop(8 * 0.03), crop(0)]}, frame).active) frame++;
    expect(frame).toBeLessThanOrEqual(13);
    expect(readRate(held, 'fallen0')).toBe(0);

    const tween = createStore({getCrop: 1000}, {crops: [crop(0), crop(1)]});
    set(tween, {crops: [crop(1), crop(1)]});
    for (let step = 1; step < 50; step++) {
      tween.tick(step * FRAME_MS, step * FRAME_SECONDS);
      expect(readRate(tween, 'fallen0')).toBeCloseTo(1, 4);
      expect(readRate(tween, 'fallen1')).toBe(0);
    }
  });

  it('gives the same rate scrubbing back through a rise of fallen', () => {
    const crop = (fallen: number) => ({count: 5, radius: 0.1, fallen});
    const getFallen = (t: number) => 0.6 * t;
    const store = createStore(null, {crops: [crop(getFallen(1)), crop(0)]});
    store.setRow(0, {}, {now: 0, clock: 1});
    store.tick(0, 1);
    for (let frame = 1; frame <= 6; frame++) {
      const clock = 1 - frame * FRAME_SECONDS;
      store.setRow(0, {crops: [crop(getFallen(clock)), crop(0)]}, {now: 0, clock});
      store.tick(0, clock);
      expect(readRate(store, 'fallen0')).toBeCloseTo(0.6, 4);
    }
  });

  it('marks the row dirty when a rate changes, and not again when it holds', () => {
    const store = createStore(null, {foliage: 1}, 200);
    const row = 150;
    store.setRow(row, {foliage: 0.5}, {now: 16, clock: FRAME_SECONDS});
    expect(store.dirtyLineStart).toBe(2);
    expect(store.dirtyLineEnd).toBe(3);
    store.clearDirty();
    store.setRow(row, {foliage: 0.5}, {now: 16, clock: FRAME_SECONDS});
    expect(store.isDirty).toBe(false);
    store.setRow(row, {foliage: 0.5}, {now: 32, clock: 2 * FRAME_SECONDS});
    expect(store.dirtyLineStart).toBe(2);
    expect(store.dirtyLineEnd).toBe(3);
    expect(readRate(store, 'foliage', row)).toBeGreaterThan(0);
  });

  it('starts over for a new tree in the same row, with no difference across trees', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 5; frame++) frameOf(store, {foliage: 1 - frame * 0.01}, frame);
    expect(readRate(store, 'foliage')).toBeGreaterThan(0);
    store.setRow(0, {foliage: 0.2}, {now: 100, clock: 6 * FRAME_SECONDS, isNew: true});
    expect(readRate(store, 'foliage')).toBe(0);
    expect(store.tick(100, 6 * FRAME_SECONDS).active).toBe(false);
    frameOf(store, {foliage: 0.19}, 7);
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
  });

  it('does not count a new row as a fall from the defaults', () => {
    const store = new TreeStateStore(1);
    store.tick(0, 0);
    store.tick(16, FRAME_SECONDS);
    store.setRow(0, {foliage: 0}, {now: 32, clock: 2 * FRAME_SECONDS, isNew: true});
    expect(readRate(store, 'foliage')).toBe(0);
    expect(store.tick(32, 2 * FRAME_SECONDS).active).toBe(false);
  });

  it('ends the rate when removing settings lands a falling tween at once', () => {
    const store = createStore({getFoliage: 1000}, {foliage: 1});
    set(store, {foliage: 0});
    for (let frame = 1; frame < 10; frame++) store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
    expect(readRate(store, 'foliage')).toBeCloseTo(1, 4);
    store.setTransitions(null);
    expect(read(store).foliage).toBe(0);
    expect(readRate(store, 'foliage')).toBe(0);
    expect(store.tick(10 * FRAME_MS, 10 * FRAME_SECONDS).active).toBe(false);
  });
});

describe('TreeStateStore input checks', () => {
  const NUMERIC_FIELDS = [
    'yaw',
    'windPhase',
    'crownX',
    'crownY',
    'height',
    'trunkHeight',
    'growth',
    'health',
    'foliage',
    'flush',
    'leanDegrees',
    'leanBearing',
    'damage',
    'decay',
    'trunkRadius',
    'windFlex',
    'coverage',
    'leafScale',
    'leafDetail',
    'seed'
  ] as const;
  const BAD_VALUES = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
    null,
    'not a number',
    {}
  ] as unknown as number[];

  for (const field of NUMERIC_FIELDS) {
    it(`${field} falls back to its previous value, or its default on a new row`, () => {
      const defaults = createTreeStateValues();
      const store = new TreeStateStore(1);
      for (const bad of BAD_VALUES) {
        store.setRow(0, {[field]: bad}, {now: 0, clock: 0, isNew: true});
        expect(read(store)[field]).toBe(defaults[field]);
      }
      const previous = FULL_VALUES[field];
      store.setRow(0, {[field]: previous}, {now: 0, clock: 0});
      store.clearDirty();
      for (const bad of BAD_VALUES) {
        store.setRow(0, {[field]: bad}, {now: 0, clock: 0});
        expect(read(store)[field]).toBe(previous);
      }
      expect(store.isDirty).toBe(false);
    });
  }

  it('checks position and colors component by component', () => {
    const store = createStore(null, {
      position: [1, 2, 3],
      canopyColor: [10, 20, 30, 40],
      trunkColor: [50, 60, 70, 80]
    });
    set(store, {
      position: [Number.NaN, 5, Number.POSITIVE_INFINITY],
      canopyColor: [Number.NaN, 21, Number.NaN, 41],
      trunkColor: [1, Number.NaN, 3, Number.NaN]
    });
    expect(read(store).position).toEqual([1, 5, 3]);
    expect(read(store).canopyColor).toEqual([10, 21, 30, 41]);
    expect(read(store).trunkColor).toEqual([1, 60, 3, 80]);
    set(store, {position: null, canopyColor: null, trunkColor: undefined});
    expect(read(store).position).toEqual([1, 5, 3]);
    expect(read(store).canopyColor).toEqual([10, 21, 30, 41]);
    set(store, {position: [7]});
    expect(read(store).position).toEqual([7, 5, 3]);
    set(store, {
      position: [8, 9, 10],
      positionLow: [Number.NaN, 0.5, undefined as unknown as number]
    });
    expect(read(store).position).toEqual([8, 9.5, 10]);
  });

  it('never lets bad input reach the state row', () => {
    const store = new TreeStateStore(1);
    const bad = {
      position: [Number.NaN, Number.NaN, Number.NaN],
      canopyColor: [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      crops: [{count: Number.NaN, radius: Number.NaN, ripeness: Number.NaN, fallen: Number.NaN}]
    };
    store.setRow(0, bad, {now: Number.NaN, clock: Number.NaN, isNew: true});
    store.tick(Number.NaN, Number.NaN);
    for (const value of store.data) expect(Number.isFinite(value)).toBe(true);
    for (const field of NUMERIC_FIELDS)
      store.setRow(0, {[field]: Number.NaN}, {now: Number.NaN, clock: Number.NaN});
    for (const value of store.data) expect(Number.isFinite(value)).toBe(true);
  });

  it('does not disturb a running tween', () => {
    const onInterrupt = vi.fn();
    const store = createStore({getGrowth: {duration: 1000, onInterrupt}}, {growth: 0});
    set(store, {growth: 1});
    store.tick(250, 0.25);
    set(store, {growth: Number.NaN}, 250);
    set(store, {}, 250);
    expect(onInterrupt).not.toHaveBeenCalled();
    store.tick(500, 0.5);
    expect(read(store).growth).toBeCloseTo(0.5, 12);
    store.tick(1000, 1);
    expect(read(store).growth).toBe(1);
  });

  it('survives a non-finite time by using the last good one', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1}, 100, 0.1);
    store.tick(Number.NaN, Number.NaN);
    expect(read(store).growth).toBe(0);
    store.tick(600, 0.6);
    expect(read(store).growth).toBeCloseTo(0.5, 12);

    // A tween set at a bad time starts from the last good one.
    const late = createStore({getGrowth: 1000}, {growth: 0});
    late.tick(200, 0.2);
    late.setRow(0, {growth: 1}, {now: Number.NaN, clock: 0.2});
    late.tick(700, 0.7);
    expect(read(late).growth).toBeCloseTo(0.5, 12);
  });

  it('keeps measuring a rate across a frame with a non-finite clock', () => {
    const store = createStore(null, {foliage: 1});
    for (let frame = 1; frame <= 5; frame++) {
      store.setRow(0, {foliage: 1 - frame * 0.01}, {now: 0, clock: frame * FRAME_SECONDS});
      store.tick(0, frame * FRAME_SECONDS);
    }
    store.setRow(0, {}, {now: 0, clock: Number.NaN});
    store.tick(0, Number.NaN);
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
    store.setRow(0, {foliage: 1 - 6 * 0.01}, {now: 0, clock: 6 * FRAME_SECONDS});
    store.tick(0, 6 * FRAME_SECONDS);
    expect(readRate(store, 'foliage')).toBeCloseTo(0.6, 4);
  });

  for (const field of [
    'growth',
    'health',
    'foliage',
    'flush',
    'damage',
    'decay',
    'coverage',
    'leafDetail',
    'seed'
  ] as const) {
    it(`clamps ${field} to 0-1`, () => {
      const store = new TreeStateStore(1);
      set(store, {[field]: 2});
      expect(read(store)[field]).toBe(1);
      set(store, {[field]: -2});
      expect(read(store)[field]).toBe(0);
      set(store, {[field]: 0.5});
      expect(read(store)[field]).toBe(0.5);
    });
  }

  it('clamps crop ripeness and fallen to 0-1, and sizes, counts and colors to their ranges', () => {
    const store = new TreeStateStore(1);
    set(store, {
      height: -1,
      trunkHeight: -1,
      crownX: -1,
      crownY: -1,
      trunkRadius: -1,
      windFlex: -1,
      leafScale: -1,
      leanDegrees: 120,
      canopyColor: [-5, 300, 128, 1000],
      crops: [
        {
          count: -3,
          radius: -1,
          ripeness: 2,
          fallen: -1,
          color: [999, -1, 0, 0],
          unripeColor: [300, -1, 7]
        }
      ]
    });
    expect(read(store)).toMatchObject({
      height: 0,
      trunkHeight: 0,
      crownX: 0,
      crownY: 0,
      trunkRadius: 0,
      windFlex: 0,
      leafScale: 0,
      leanDegrees: 90,
      canopyColor: [0, 255, 128, 255]
    });
    expect(read(store).crops[0]).toMatchObject({
      count: 0,
      radius: 0,
      ripeness: 1,
      fallen: 0,
      color: [255, 0, 0, 0],
      unripeColor: [255, 0, 7]
    });
    set(store, {leanDegrees: -30});
    expect(read(store).leanDegrees).toBe(0);
    expect(readFloat(store, 0, TEXEL.CANOPY, 3)).toBe(1);
  });

  it('leaves position, yaw and wind phase free of any range', () => {
    const store = new TreeStateStore(1);
    set(store, {position: [-1e6, 1e6, -1e4], yaw: 100, windPhase: -100});
    expect(read(store)).toMatchObject({position: [-1e6, 1e6, -1e4], yaw: 100, windPhase: -100});
  });
});

describe('TreeStateStore crops', () => {
  const FRUIT = {
    count: 10,
    radius: 0.05,
    ripeness: 0.5,
    fallen: 0.25,
    color: [240, 140, 20, 255],
    unripeColor: [80, 120, 40],
    dropped: 0
  };

  it('keeps both slots when crops is left out', () => {
    const store = createStore({getCrop: 1000}, {crops: [FRUIT, FRUIT]});
    set(store, {growth: 0.5});
    expect(store.activeTweenCount).toBe(0);
    expect(read(store).crops[0].count).toBe(10);
    expect(read(store).crops[1].count).toBe(10);
  });

  it('empties a slot that is missing from the array, holding its appearance as it goes', () => {
    for (const crops of [[], [null], [undefined], null]) {
      const store = createStore({getCrop: 1000}, {crops: [FRUIT]});
      set(store, {crops: crops as TreeStateUpdate['crops']});
      store.tick(500, 0.5);
      expect(read(store).crops[0]).toEqual({...FRUIT, count: 5});
      store.tick(1000, 1);
      expect(read(store).crops[0]).toEqual({...FRUIT, count: 0});
    }
  });

  it('empties without transitions at once, and ignores a third slot', () => {
    const store = createStore(null, {crops: [FRUIT, FRUIT]});
    set(store, {crops: [null, FRUIT, FRUIT]});
    expect(read(store).crops[0].count).toBe(0);
    expect(read(store).crops[1].count).toBe(10);
    expect(read(store).crops.length).toBe(2);
    expect(readFloat(store, 0, TEXEL.CROP0, 0)).toBe(0);
    expect(readFloat(store, 0, TEXEL.CROP1, 0)).toBe(10);
  });

  it('gives a slot with nothing on the tree its new look at once, so only count tweens', () => {
    const onStart = vi.fn();
    const store = createStore({getCrop: {duration: 1000, onStart}}, {});
    set(store, {crops: [FRUIT]});
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(read(store).crops[0]).toEqual({...FRUIT, count: 0});
    expect(readFloat(store, 0, TEXEL.CROP0, 1)).toBeCloseTo(0.05, 6);
    store.tick(500, 0.5);
    expect(read(store).crops[0]).toEqual({...FRUIT, count: 5});
  });

  it('tweens dropped crops, and a slot holding only those is not empty', () => {
    const store = createStore({getCrop: 1000}, {crops: [{...FRUIT, count: 0, dropped: 8}]});
    set(store, {crops: [{...FRUIT, count: 0, dropped: 16, radius: 0.15}]});
    store.tick(500, 0.5);
    expect(read(store).crops[0].dropped).toBeCloseTo(12, 9);
    expect(read(store).crops[0].radius).toBeCloseTo(0.1, 9);
    expect(readFloat(store, 0, TEXEL.CROP_DROPPED, 0)).toBeCloseTo(12, 5);
    // Dropping them, and the crop slot that held them, animates out.
    set(store, {crops: []}, 500);
    store.tick(1000, 1);
    expect(read(store).crops[0].dropped).toBeCloseTo(6, 9);
    store.tick(1500, 1.5);
    expect(read(store).crops[0].dropped).toBe(0);
  });

  it('starts no tween when a slot stays empty', () => {
    const onStart = vi.fn();
    const store = createStore({getCrop: {duration: 1000, onStart}}, {});
    set(store, {crops: [{...FRUIT, count: 0}]});
    expect(onStart).not.toHaveBeenCalled();
    expect(store.activeTweenCount).toBe(0);
    expect(read(store).crops[0].radius).toBe(0.05);
  });

  it('tweens every field of a slot that has something on the tree', () => {
    const store = createStore({getCrop: 1000}, {crops: [FRUIT]});
    set(store, {
      crops: [
        {
          count: 20,
          radius: 0.15,
          ripeness: 1,
          fallen: 0.75,
          color: [0, 0, 0, 0],
          unripeColor: [0, 0, 0]
        }
      ]
    });
    store.tick(500, 0.5);
    expect(read(store).crops[0].count).toBeCloseTo(15, 9);
    expect(read(store).crops[0].radius).toBeCloseTo(0.1, 9);
    expect(read(store).crops[0].ripeness).toBeCloseTo(0.75, 9);
    expect(read(store).crops[0].fallen).toBeCloseTo(0.5, 9);
    expect(read(store).crops[0].color).toEqual([120, 70, 10, 127.5]);
    expect(read(store).crops[0].unripeColor).toEqual([40, 60, 20]);
    expect(readFloat(store, 0, TEXEL.CROP0_COLOR, 0)).toBeCloseTo(120 / 255, 6);
  });

  it('keeps a crop field that is left out, and treats a three-part color as opaque', () => {
    const store = createStore(null, {crops: [FRUIT]});
    set(store, {crops: [{count: 3}]});
    expect(read(store).crops[0]).toEqual({...FRUIT, count: 3});
    set(store, {crops: [{color: [1, 2, 3, 100]}]});
    expect(read(store).crops[0].color).toEqual([1, 2, 3, 100]);
    set(store, {crops: [{color: [1, 2, 3]}]});
    expect(read(store).crops[0].color).toEqual([1, 2, 3, 255]);
    set(store, {crops: [{color: [1, 2, 3, 9], unripeColor: [4, 5, 6, 7]}]});
    expect(read(store).crops[0].color).toEqual([1, 2, 3, 9]);
    expect(read(store).crops[0].unripeColor).toEqual([4, 5, 6]);
  });
});

describe('TreeStateStore dirty lines', () => {
  it('is empty on a clean store', () => {
    const store = createStore(null, {}, 100);
    expect(store.isDirty).toBe(false);
    expect(store.dirtyLineStart).toBe(0);
    expect(store.dirtyLineEnd).toBe(0);
  });

  it('covers the line of a changed row, then stretches to span every change', () => {
    const store = createStore(null, {}, 1000);
    set(store, {growth: 0.5}, 0, 0, 300);
    expect(store.dirtyLineStart).toBe(4);
    expect(store.dirtyLineEnd).toBe(5);
    set(store, {growth: 0.5}, 0, 0, 64);
    expect(store.dirtyLineStart).toBe(1);
    expect(store.dirtyLineEnd).toBe(5);
    set(store, {growth: 0.5}, 0, 0, 900);
    expect(store.dirtyLineStart).toBe(1);
    expect(store.dirtyLineEnd).toBe(15);
    store.clearDirty();
    expect(store.isDirty).toBe(false);
    set(store, {growth: 0.5}, 0, 0, 300);
    expect(store.isDirty).toBe(false);
  });

  it('accumulates over ticks until cleared, since a frame may not upload', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0}, 200);
    set(store, {growth: 1}, 0, 0, 10);
    expect(store.isDirty).toBe(false);
    store.tick(0, 0);
    expect(store.isDirty).toBe(false);
    store.tick(100, 0.1);
    expect(store.dirtyLineStart).toBe(0);
    expect(store.dirtyLineEnd).toBe(1);
    set(store, {growth: 1}, 100, 0.1, 199);
    store.tick(200, 0.2);
    expect(store.dirtyLineStart).toBe(0);
    expect(store.dirtyLineEnd).toBe(4);
    store.clearDirty();
    store.tick(300, 0.3);
    expect(store.dirtyLineStart).toBe(0);
    expect(store.dirtyLineEnd).toBe(4);
  });

  it('gives a range that uploads the changed texels', () => {
    const store = createStore(null, {}, 300);
    set(store, {growth: 0.5}, 0, 0, 130);
    const lines = store.data.subarray(
      store.dirtyLineStart * FLOATS_PER_LINE,
      store.dirtyLineEnd * FLOATS_PER_LINE
    );
    expect(lines.length).toBe(FLOATS_PER_LINE);
    const offset = (130 % TREE_STATE_ROWS_PER_LINE) * FLOATS_PER_ROW + TEXEL.LIFE * 4;
    expect(lines[offset]).toBe(0.5);
  });

  it('does not mark a tween that is not moving yet, or whose value did not change', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1e-12});
    store.tick(10, 0.01);
    expect(store.activeTweenCount).toBe(1);
    expect(store.isDirty).toBe(true);
    store.clearDirty();
    store.tick(10, 0.01);
    expect(store.isDirty).toBe(false);
  });
});

describe('TreeStateStore callbacks', () => {
  it('runs a callback after the store is consistent, so it can set the row again', () => {
    const store = createStore(null, {growth: 0});
    const events: string[] = [];
    store.setTransitions({
      getGrowth: {
        duration: 100,
        onStart: row => {
          events.push(`start ${read(store, row).growth}`);
        },
        onEnd: row => {
          events.push(`end ${read(store, row).growth}`);
          if (read(store, row).growth === 1) set(store, {growth: 0}, 100, 0.1, row);
        }
      }
    });
    set(store, {growth: 1});
    expect(events).toEqual(['start 0']);
    const result = store.tick(100, 0.1);
    expect(events).toEqual(['start 0', 'end 1', 'start 1']);
    expect(result.active).toBe(true);
    store.tick(200, 0.2);
    expect(events).toEqual(['start 0', 'end 1', 'start 1', 'end 0']);
    expect(read(store).growth).toBe(0);
  });

  it('keeps order when a callback starts another tween on another row', () => {
    const events: string[] = [];
    const store = createStore(null, {growth: 0}, 2);
    store.setTransitions({
      getGrowth: {
        duration: 100,
        onStart: row => {
          events.push(`start ${row}`);
          if (row === 0) set(store, {growth: 1}, 0, 0, 1);
          events.push(`started ${row}`);
        },
        onEnd: row => {
          events.push(`end ${row}`);
        }
      }
    });
    set(store, {growth: 1});
    expect(events).toEqual(['start 0', 'started 0', 'start 1', 'started 1']);
    store.tick(100, 0.1);
    expect(events.slice(4)).toEqual(['end 0', 'end 1']);
  });

  it('survives a callback that throws: the error surfaces and later callbacks still run', () => {
    const later = vi.fn();
    const store = createStore(
      {
        getGrowth: {
          duration: 100,
          onEnd: () => {
            throw new Error('user callback');
          }
        },
        getHealth: {duration: 100, onEnd: later}
      },
      {growth: 0, health: 0}
    );
    set(store, {growth: 1, health: 1});
    expect(() => store.tick(100, 0.1)).toThrow('user callback');
    expect(read(store).growth).toBe(1);
    expect(read(store).health).toBe(1);
    expect(later).not.toHaveBeenCalled();
    expect(store.tick(100, 0.1).active).toBe(false);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('does not keep growing its queue of callbacks', () => {
    const onStart = vi.fn();
    const store = createStore({getGrowth: {duration: 10, onStart}}, {growth: 0});
    const internals = store as unknown as {callbacks: unknown[]};
    for (let i = 1; i <= 500; i++) set(store, {growth: i % 2}, i * 100, i * 0.1);
    expect(onStart).toHaveBeenCalledTimes(500);
    expect(internals.callbacks.length).toBeLessThan(10);
  });

  it('has shared, frozen tick results that are safe to keep', () => {
    const store = createStore({getGrowth: 100}, {growth: 0});
    set(store, {growth: 1});
    const first = store.tick(50, 0.05);
    const second = store.tick(100, 0.1);
    const third = store.tick(150, 0.15);
    expect(first).toEqual({changed: true, active: true});
    expect(second).toEqual({changed: true, active: false});
    expect(third).toEqual({changed: false, active: false});
    expect(Object.isFrozen(first)).toBe(true);
    expect(store.tick(150, 0.15)).toBe(third);
  });
});

describe('TreeStateStore cost per frame', () => {
  const ROWS = 1000;
  type StoreModule = typeof import('../../src/tree-layer/tree-state-store');

  setFlagsFromString('--expose-gc');
  const collectGarbage = runInNewContext('gc') as () => void;

  /**
   * A new instance of the module, so V8 has no type feedback from the rest of this file, whose many
   * partial objects no real caller passes, and which would make every `values.x` box. It then
   * exercises every feature through the one `values` shape a layer would use, as a real page does,
   * which leaves feedback as mixed as it realistically gets. Doubles are most likely to box then.
   */
  async function importExercisedStore(): Promise<StoreModule> {
    vi.resetModules();
    const module = await import('../../src/tree-layer/tree-state-store');
    const store = new module.TreeStateStore(4);
    const values = module.createTreeStateValues();
    const onEvent = () => {};
    store.setTransitions({
      getTree: {duration: 100, easing: t => t * t, onStart: onEvent, onEnd: onEvent},
      getGrowth: {type: 'spring', onStart: onEvent, enter: () => [0]},
      getLean: {type: 'spring', stiffness: 0.2, damping: 0.1},
      getHealth: {duration: 100, onInterrupt: onEvent, enter: toValue => toValue},
      getElevation: 100
    });
    for (let frame = 0; frame < 300; frame++) {
      const now = frame * FRAME_MS;
      const clock = frame * FRAME_SECONDS;
      const target = 0.25 + ((frame >> 3) % 2) * 0.5;
      for (let row = 0; row < 4; row++) {
        values.growth = target;
        values.health = target;
        values.foliage = target;
        values.damage = 1 - target;
        values.leanDegrees = target * 40;
        values.leanBearing = target * 700;
        values.position[2] = target;
        values.crops[0].count = target * 20;
        values.crops[0].fallen = target;
        store.setRow(row, values, {now, clock, isNew: row === 0 && frame % 50 === 0});
      }
      store.tick(now, clock);
      store.getRowValues(1, values);
    }
    return module;
  }

  /** Median cost, in milliseconds, of `run`, after warming it up as a browser would. */
  function getMedianMs(run: () => void, warmup = 300, samples = 200): number {
    for (let i = 0; i < warmup; i++) run();
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      run();
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b)[samples >> 1];
  }

  /**
   * Heap growth, in bytes, of `iterations` runs. Each try starts from a collected heap, so nothing
   * old can be swept during it, which is what makes this exact enough to compare against a few
   * kilobytes: over 50 frames of 1,000 rows, that is under a byte per row.
   */
  function getHeapGrowth(run: () => void, warmup = 300, iterations = 50): number {
    for (let i = 0; i < warmup; i++) run();
    const growths: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      collectGarbage();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < iterations; i++) run();
      growths.push(process.memoryUsage().heapUsed - before);
    }
    return growths.sort((a, b) => a - b)[growths.length >> 1];
  }
  const NOTHING = 64 * 1024;

  /** Rows of plain objects with stable double fields, so writing a field allocates nothing. */
  function getMutableValues(module: StoreModule): TreeStateValues[] {
    return Array.from({length: ROWS}, (_, row) => {
      const values = module.createTreeStateValues();
      values.position = [row + 0.5, row + 0.25, 0.125];
      values.growth = 0.5;
      values.foliage = 0.75;
      values.damage = 0.75;
      values.leanDegrees = 30.5;
      values.leanBearing = 350.5;
      values.crops[0].count = 5.5;
      values.crops[0].radius = 0.125;
      values.crops[0].fallen = 0.75;
      return values;
    });
  }

  /** Checks a frame's work allocates nothing, and that the test's own part of it does not either. */
  function expectNoAllocation(label: string, run: () => void, harness: () => void): void {
    const growth = getHeapGrowth(run);
    const harnessGrowth = getHeapGrowth(harness);
    console.log(`${label}: ${growth} bytes of heap growth, ${harnessGrowth} from the test itself`);
    expect(harnessGrowth).toBeLessThan(NOTHING);
    expect(growth).toBeLessThan(NOTHING);
  }

  it('can tell when something allocates, or the checks below would mean nothing', () => {
    const sink: {value: unknown} = {value: null};
    for (const perRow of [1, 4]) {
      const growth = getHeapGrowth(() => {
        for (let row = 0; row < ROWS; row++) for (let i = 0; i < perRow; i++) sink.value = {row};
      });
      // A small object or two per row, for 50 frames of 1,000 rows, well above what counts as none.
      expect(sink.value).toBeTruthy();
      expect(growth).toBeGreaterThan(NOTHING * 10);
    }
  });

  it('sets 1,000 unchanged rows and ticks well under 1 ms', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(ROWS);
    store.setTransitions({getTree: 600, getGrowth: 2000});
    const values = getMutableValues(module);
    const options = {now: 0.5, clock: 0.5, isNew: false};
    let frame = 0;
    for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
    store.tick(0, 0);
    store.clearDirty();
    const median = getMedianMs(() => {
      frame++;
      options.now = frame * FRAME_MS;
      options.clock = frame * FRAME_SECONDS;
      for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
      store.tick(options.now, options.clock);
    });
    expect(store.isDirty).toBe(false);
    console.log(`1,000 unchanged rows, set and ticked: ${median.toFixed(3)} ms median`);
    expect(median).toBeLessThan(1);
  });

  it('allocates nothing setting unchanged rows and ticking', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(ROWS);
    store.setTransitions({getTree: 600});
    const values = getMutableValues(module);
    const options = {now: 0.5, clock: 0.5, isNew: false};
    for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
    store.tick(0, 0);
    let frame = 0;
    expectNoAllocation(
      'Unchanged rows, 50 frames',
      () => {
        frame++;
        options.now = frame * FRAME_MS;
        options.clock = frame * FRAME_SECONDS;
        for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
        store.tick(options.now, options.clock);
      },
      () => {
        frame++;
        options.now = frame * FRAME_MS;
        options.clock = frame * FRAME_SECONDS;
      }
    );
  });

  it('allocates nothing while tweens and springs run, with only ticks', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(ROWS);
    const soft = {type: 'spring', stiffness: 0.0002, damping: 1} as const;
    store.setTransitions({
      getFoliage: 1e9,
      getGrowth: soft,
      getDamage: soft,
      getLean: 1e9,
      getPosition: soft,
      getCrop: 1e9
    });
    const values = getMutableValues(module);
    const options = {now: 0.5, clock: 0.5, isNew: false};
    for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
    store.tick(0, 0);
    for (let row = 0; row < ROWS; row++) {
      const value = values[row];
      value.foliage = 0.125;
      value.growth = 0.875;
      value.damage = 0.125;
      value.leanDegrees = 50.5;
      value.leanBearing = 200.5;
      value.position[0] += 90.5;
      value.crops[0].fallen = 0.25;
      store.setRow(row, value, options);
    }
    let frame = 0;
    const run = () => {
      frame++;
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
    };
    expectNoAllocation('Running tweens, ticked 50 frames', run, () => {
      frame++;
    });
    expect(store.activeTweenCount).toBe(ROWS * 6);
  });

  it('allocates nothing while 1,000 rows retarget six groups every frame', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(ROWS);
    store.setTransitions({
      getFoliage: 500,
      getGrowth: {type: 'spring'},
      getDamage: {type: 'spring'},
      getLean: 500,
      getPosition: {type: 'spring'},
      getCrop: 500
    });
    const values = getMutableValues(module);
    const options = {now: 0.5, clock: 0.5, isNew: false};
    for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
    store.tick(0, 0);
    let frame = 0;
    const change = (row: number, target: number) => {
      const value = values[row];
      value.foliage = target;
      value.growth = target;
      value.damage = target;
      value.leanBearing = target * 20;
      value.position[0] = row + target;
      value.crops[0].fallen = target;
      return value;
    };
    const run = () => {
      frame++;
      options.now = frame * FRAME_MS;
      options.clock = frame * FRAME_SECONDS;
      const target = frame % 2 ? 0.25 : 0.75;
      for (let row = 0; row < ROWS; row++) store.setRow(row, change(row, target), options);
      store.tick(options.now, options.clock);
    };
    expectNoAllocation('Retargeting every frame, 50 frames', run, () => {
      frame++;
      const target = frame % 2 ? 0.25 : 0.75;
      for (let row = 0; row < ROWS; row++) change(row, target);
    });
    console.log(`Retargeting 6 groups on 1,000 rows: ${getMedianMs(run, 0).toFixed(3)} ms median`);
  });

  it('allocates nothing while 1,000 rows jump every frame, as a film driven by data does', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(ROWS);
    const values = getMutableValues(module);
    const options = {now: 0.5, clock: 0.5, isNew: false};
    for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
    store.tick(0, 0);
    let frame = 0;
    const change = (row: number, value: number) => {
      const tree = values[row];
      tree.foliage = value;
      tree.damage = value;
      tree.growth = value;
      tree.leanDegrees = value * 30;
      tree.leanBearing = value * 300;
      tree.crops[0].fallen = value;
      return tree;
    };
    const run = () => {
      frame++;
      options.now = frame * FRAME_MS;
      options.clock = frame * FRAME_SECONDS;
      // Falling, so loss rates run too, and wrapping around so it can go on as long as it needs to.
      const value = 1 - (frame % 500) * 0.002;
      for (let row = 0; row < ROWS; row++) store.setRow(row, change(row, value), options);
      store.tick(options.now, options.clock);
    };
    expectNoAllocation('Jumping every frame with rates, 50 frames', run, () => {
      frame++;
      const value = 1 - (frame % 500) * 0.002;
      for (let row = 0; row < ROWS; row++) change(row, value);
    });
    console.log(`Jumping 1,000 rows with rates: ${getMedianMs(run, 0).toFixed(3)} ms median`);
  });

  it('allocates nothing reading every row into a reused object', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(ROWS);
    store.setTransitions({getTree: 1e9});
    const values = getMutableValues(module);
    const options = {now: 0.5, clock: 0.5, isNew: false};
    for (let row = 0; row < ROWS; row++) store.setRow(row, values[row], options);
    for (let row = 0; row < ROWS; row++) {
      values[row].growth = 0.125;
      values[row].leanBearing = 200.5;
      store.setRow(row, values[row], options);
    }
    const out = module.createTreeStateValues();
    const total = new Float64Array(1);
    let frame = 0;
    const growth = getHeapGrowth(() => {
      frame++;
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
      for (let row = 0; row < ROWS; row++) total[0] += store.getRowValues(row, out).growth;
    });
    console.log(`Reading 1,000 rows, 50 frames: ${growth} bytes of heap growth`);
    expect(total[0]).toBeGreaterThan(0);
    expect(growth).toBeLessThan(NOTHING);
  });

  it('allocates nothing setting transitions that are new objects but equal', async () => {
    const module = await importExercisedStore();
    const store = new module.TreeStateStore(1);
    const easing = (t: number) => t;
    const onEnd = () => {};
    const transitions = Array.from({length: 2}, () => ({
      getTree: 600,
      getGrowth: {duration: 2000, easing, onEnd},
      getLean: {type: 'spring', stiffness: 0.02, damping: 0.25} as const
    }));
    let frame = 0;
    const growth = getHeapGrowth(() => {
      for (let i = 0; i < 1000; i++) store.setTransitions(transitions[frame++ % 2]);
    });
    console.log(`Equal transitions, 50,000 calls: ${growth} bytes of heap growth`);
    expect(growth).toBeLessThan(NOTHING);
  });

  it('costs almost nothing to tick when a huge grove is at rest', () => {
    const store = new TreeStateStore(100000);
    for (let row = 0; row < 100000; row += 1000) set(store, {growth: 0.5}, 0, 0, row);
    store.tick(0, 0);
    let frame = 0;
    const median = getMedianMs(() => {
      frame++;
      store.tick(frame * FRAME_MS, frame * FRAME_SECONDS);
    });
    console.log(`100,000 rows at rest, ticked: ${median.toFixed(4)} ms median`);
    expect(median).toBeLessThan(0.05);
  });
});
