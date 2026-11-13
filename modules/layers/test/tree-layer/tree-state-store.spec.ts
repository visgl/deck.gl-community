// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
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
    const store = createStore({getGrowth: {duration: 1000}}, {growth: 0}, 3);
    set(store, {growth: 1}, 0, 0, 0);
    set(store, {growth: 1}, 0, 0, 2);
    store.tick(250, 0.25);
    store.resize(500);
    expect(store.activeTweenCount).toBe(2);
    expect(read(store, 2).growth).toBeCloseTo(0.25, 12);
    store.resize(1);

    expect(store.activeTweenCount).toBe(1);
    store.tick(1000, 1);

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
    const store = createStore({getGrowth: {duration: 1000}}, {growth: 0});
    set(store, {growth: 1});
    store.tick(250, 0.25);
    set(store, {growth: 1}, 250);
    set(store, {growth: 1}, 500);

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
    it(`jumps with ${label}`, () => {
      const store = createStore({getGrowth: settings}, {growth: 0});
      set(store, {growth: 1});
      expect(read(store).growth).toBe(1);
      expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(1);
      expect(store.activeTweenCount).toBe(0);
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

  it('tweens color channels together', () => {
    const store = createStore({getCanopyColor: {duration: 100}}, {canopyColor: [0, 0, 0, 0]});
    set(store, {canopyColor: [10, 20, 30, 40]});
    expect(store.activeTweenCount).toBe(1);

    store.tick(100, 0.1);

    expect(read(store).canopyColor).toEqual([10, 20, 30, 40]);
  });

  it('retargets a tween from its destination once its duration has elapsed', () => {
    const store = createStore({getGrowth: 100}, {growth: 0});
    set(store, {growth: 1});
    set(store, {growth: 0}, 500);
    expect(read(store).growth).toBe(1);
  });

  it('ends the tween when a retarget lands exactly on the current value', () => {
    const store = createStore({getGrowth: 1000}, {growth: 0});
    set(store, {growth: 1});
    store.tick(500, 0.5);
    set(store, {growth: 0.5}, 500);
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
    const store = createStore(
      {getGrowth: 1000, getHealth: {duration: 1000}},
      {growth: 0, health: 0}
    );
    set(store, {growth: 1, health: 1});
    store.tick(500, 0.5);
    set(store, {growth: 0, health: 1}, 500);

    store.tick(750, 0.75);
    expect(read(store).growth).toBeCloseTo(0.375, 12);
    expect(read(store).health).toBeCloseTo(0.75, 12);
  });

  it('moves x, y and z as one transition unless getElevation asks for its own', () => {
    const store = createStore({getPosition: {duration: 1000}}, {position: [0, 0, 0]});
    set(store, {position: [10, 10, 10]});

    const split = createStore(
      {
        getPosition: {duration: 1000},
        getElevation: {duration: 100}
      },
      {position: [0, 0, 0]}
    );
    set(split, {position: [10, 10, 10]});

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
    const store = createStore({getHeight: {duration: 1000}}, {height: 10, trunkHeight: 3.5});
    set(store, {height: 20, trunkHeight: 7});

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
    const crop = (count: number) => ({count, radius: 0.1});
    const store = createStore({getCrop: {duration: 1000}}, {crops: [crop(10), crop(10)]});
    set(store, {crops: [crop(20), crop(10)]});

    store.tick(500, 0.5);
    set(store, {crops: [crop(20), crop(30)]}, 500);

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
      const store = createStore(
        {getGrowth: {duration: 1000}, getHealth: 1000},
        {growth: 0, health: 0}
      );
      set(store, {growth: 1, health: 1});
      store.tick(500, 0.5);
      store.setTransitions({getHealth: 1000});

      expect(read(store).growth).toBe(1);
      expect(readFloat(store, 0, TEXEL.LIFE, 0)).toBe(1);
      expect(read(store).health).toBeCloseTo(0.5, 12);
      store.setTransitions(null);
      expect(read(store).health).toBe(1);
      expect(store.activeTweenCount).toBe(0);
    });

    it('interrupts tweens whose channels move to another group', () => {
      const store = createStore(
        {getPosition: {duration: 1000}, getHeight: {duration: 1000}},
        {position: [0, 0, 0], height: 10, trunkHeight: 1, growth: 0}
      );
      store.setTransitions({
        getPosition: {duration: 1000},
        getHeight: {duration: 1000},
        getGrowth: 1000
      });
      set(store, {position: [10, 10, 10], height: 20, trunkHeight: 2, growth: 1});
      store.tick(500, 0.5);

      store.setTransitions({getElevation: 1000, getTrunkHeightFraction: 1000, getGrowth: 1000});

      expect(read(store).position).toEqual([10, 10, 10]);
      expect(read(store).height).toBe(20);
      expect(read(store).trunkHeight).toBe(2);
      expect(read(store).growth).toBeCloseTo(0.5, 12);
      set(store, {position: [10, 10, 0]}, 500);
      store.tick(1000, 1);
      expect(read(store).position).toEqual([10, 10, 5]);
    });

    it('interrupts tweens that a split reassigns even though their settings remain', () => {
      const getPosition = {duration: 1000};
      const store = createStore({getPosition}, {position: [0, 0, 0]});
      set(store, {position: [10, 10, 10]});
      store.tick(500, 0.5);
      store.setTransitions({getPosition, getElevation: 1000});

      expect(read(store).position).toEqual([10, 10, 10]);
      expect(store.activeTweenCount).toBe(0);

      const heights = createStore({getHeight: {duration: 1000}}, {height: 10, trunkHeight: 1});
      set(heights, {height: 20, trunkHeight: 2});
      heights.tick(500, 0.5);
      heights.setTransitions({getHeight: {duration: 1000}, getTrunkHeightFraction: 0});

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
    });

    it('ignores the same object, and treats an equal new object as no change', () => {
      const transitions = {getGrowth: {duration: 1000}};
      const store = createStore(transitions, {growth: 0});
      set(store, {growth: 1});
      store.tick(500, 0.5);
      store.setTransitions(transitions);
      store.setTransitions({getGrowth: {duration: 1000}});
      store.setTransitions({...transitions, getLean: undefined});
      expect(store.activeTweenCount).toBe(1);

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
    const store = createStore({getLean: 1000}, {leanDegrees: 0, leanBearing: 0});
    set(store, {leanDegrees: 80, leanBearing: 200});
    expect(read(store).leanBearing).toBe(200);
    for (let frame = 0; frame < 40; frame++) {
      store.tick(frame * 20, frame * 0.02);
      expect(read(store).leanBearing).toBe(200);
    }
  });

  it('holds its bearing while returning upright, then takes the target at the end', () => {
    const store = createStore({getLean: 1000}, {leanDegrees: 40, leanBearing: 120});
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
    const store = createStore({getLean: {duration: 1000}}, {leanDegrees: 30, leanBearing: 350});
    set(store, {leanBearing: 10});
    store.tick(500, 0.5);
    set(store, {leanBearing: 370}, 500);
    set(store, {leanBearing: -350}, 500);

    store.tick(750, 0.75);
    expect(read(store).leanBearing).toBeCloseTo(5, 9);
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
    const store = createStore({getGrowth: {duration: 1000}}, {growth: 0});
    set(store, {growth: 1});
    store.tick(250, 0.25);
    set(store, {growth: Number.NaN}, 250);
    set(store, {}, 250);

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
    const store = createStore({getCrop: {duration: 1000}}, {});
    set(store, {crops: [FRUIT]});

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
    const store = createStore({getCrop: {duration: 1000}}, {});
    set(store, {crops: [{...FRUIT, count: 0}]});

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

describe('TreeStateStore repeated updates', () => {
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
  it('keeps initialized rows clean when their values are submitted again', () => {
    const store = createStore({getTree: 600, getGrowth: 2000}, FULL_VALUES, 64);
    for (let frame = 1; frame <= 4; frame++) {
      for (let row = 0; row < 64; row++) {
        set(store, FULL_VALUES, frame * FRAME_MS, frame * FRAME_SECONDS, row);
      }
      expect(store.tick(frame * FRAME_MS, frame * FRAME_SECONDS)).toEqual({
        changed: false,
        active: false
      });
      expect(store.isDirty).toBe(false);
    }
  });
});
