// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import {describe, expect, it, vi} from 'vitest';
import {
  TreeStateStore,
  type TreeStateValues
} from '../../../modules/layers/src/tree-layer/tree-state-store';

const FRAME_MS = 1000 / 60;
const FRAME_SECONDS = 1 / 60;

describe('TreeStateStore cost per frame', () => {
  const ROWS = 1000;
  type StoreModule = typeof import('../../../modules/layers/src/tree-layer/tree-state-store');

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
    const module = await import('../../../modules/layers/src/tree-layer/tree-state-store');
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

  it('allocates nothing while 1,000 rows jump every frame, without transitions', async () => {
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
    for (let row = 0; row < 100000; row += 1000)
      store.setRow(row, {growth: 0.5}, {now: 0, clock: 0});
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
