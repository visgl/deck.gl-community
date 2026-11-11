// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitViewport} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {
  createShellDiagnostics,
  createShellSetup,
  getNearSpec,
  ShellNearReason,
  syncShellTrees,
  updateShellBuckets,
  updateShellNear,
  type ShellTree,
  type ShellView
} from '../field/shell/shell-field';
import {updateShellView} from '../field/shell/shell-view';
import {getFieldCamera} from '../playground-settings';

function createTrees(count: number, spacing = 100): ShellTree[] {
  return Array.from({length: count}, (_, index) => ({
    position: [index * spacing, 0, 0],
    height: 3,
    crownRadius: 2.25,
    characteristics: {seed: 1},
    growth: 1,
    health: 1,
    foliage: 1,
    row: 0,
    column: index
  }));
}

function createSetup(trees: ShellTree[]) {
  return createShellSetup(trees, position => [position[0], position[1]], {
    fadeSeconds: 0.45,
    lngLat: false,
    now: 0,
    clock: 0,
    cellColumns: 1,
    cellRows: 1
  });
}

function createView(east = 0): ShellView {
  return {
    position: [east, -10, 1.5],
    forward: [0, 1, 0],
    right: [1, 0, 0],
    up: [0, 0, 1],
    focal: 1000,
    tanX: 0.5,
    tanY: 0.5
  };
}

const NEAR = {in: 330, out: 280, most: 1, fullAt: 1.6, treeMetres: 4.5, now: 0};
const BUCKETS = {coarsePixels: 12, finePixels: 24, crownMetres: 4.5, now: 0, margin: 2};

describe('the field scheduler', () => {
  it('draws wide, short crowns through the dissolve variant even at full foliage', () => {
    const trees = createTrees(1);
    const setup = createSetup(trees);
    const view = createView();
    view.position[1] = -500;
    updateShellBuckets(setup, view, BUCKETS);
    expect(setup.bucketOfCell[0]).toBe(0);

    trees[0].height = 0.6;
    trees[0].crownRadius = 5;
    syncShellTrees(setup, 1, null, 1000, 1);
    updateShellBuckets(setup, view, {...BUCKETS, now: 1});
    expect(setup.bucketOfCell[0]).toBe(4);
  });

  it('bypasses the shell frustum while preserving the detail handoff', () => {
    const setup = createSetup(createTrees(2));
    const view = createView();
    updateShellBuckets(setup, view, BUCKETS);
    expect(Array.from(setup.bucketOfCell)).toEqual([2, -1]);

    updateShellBuckets(setup, view, {...BUCKETS, bypassFrustum: true});
    expect(Array.from(setup.bucketOfCell)).toEqual([2, 2]);

    updateShellNear(setup, view, NEAR);
    updateShellNear(setup, view, {...NEAR, now: 1});
    updateShellBuckets(setup, view, {...BUCKETS, bypassFrustum: true, now: 1});
    expect(Array.from(setup.bucketOfCell)).toEqual([-1, 2]);
  });

  it('maps one tree per cell and keeps picking rows in the source order', () => {
    const trees = createTrees(4);
    const setup = createSetup(trees);
    expect(setup.field.rowsPerCell).toBe(1);
    expect(Array.from(setup.rowOf)).toEqual([0, 1, 2, 3]);
    expect(setup.cells.map(cell => cell.trees)).toEqual([[0], [1], [2], [3]]);
    trees[2].foliage = 0.3;
    syncShellTrees(setup, 1, null, 1, 0.001);
    expect(Array.from(setup.sparseByCell)).toEqual([0, 0, 1, 0]);
  });

  it.each([
    {name: 'behind', position: [0, -3.5, 0]},
    {name: 'peripheral', position: [3.5, 0, 0]}
  ])('prioritizes the viewed crown over a $name crown when safety spheres overlap', ({
    position
  }) => {
    const trees = createTrees(2);
    trees[0].position = position as [number, number, number];
    trees[1].position = [0, 3, 0];
    const setup = createSetup(trees);
    const view = createView();
    view.position = [0, 0, 1.5];
    // Both loose safety spheres contain the camera and previously tied at the same huge size.
    expect(setup.cells.every(cell => cell.radius > Math.hypot(cell.east, cell.north))).toBe(true);
    updateShellNear(setup, view, NEAR);
    expect([...setup.nearByTree.keys()]).toEqual([1]);
  });

  it('keeps an unselected enclosing crown detailed after its centre passes behind the camera', () => {
    const trees = createTrees(2);
    trees[0].position = [0, -2, 0];
    trees[1].position = [0, 6, 0];
    const setup = createSetup(trees);
    const view = {...createView(), position: [0, 0, 1.5] as [number, number, number]};
    updateShellNear(setup, view, NEAR);
    expect([...setup.nearByTree.keys()]).toEqual([0]);
  });

  it('uses selection to break close ties only while the crown intersects the view', () => {
    const trees = createTrees(2);
    trees[0].position = [2, 4.2, 0];
    trees[1].position = [0, 4, 0];
    const view = createView();
    view.position = [0, 0, 1.5];
    const setup = createSetup(trees);
    updateShellNear(setup, view, {...NEAR, selectedIndex: 0});
    expect([...setup.nearByTree.keys()]).toEqual([0]);

    trees[0].position = [2, 8, 0];
    const distant = createSetup(trees);
    updateShellNear(distant, view, {...NEAR, selectedIndex: 0});
    expect([...distant.nearByTree.keys()]).toEqual([1]);

    trees[0].position = [100, 6, 0];
    const offscreen = createSetup(trees);
    updateShellNear(offscreen, view, {...NEAR, selectedIndex: 0});
    expect([...offscreen.nearByTree.keys()]).toEqual([1]);
  });

  it('prefers a larger visible edge crown over a farther central crown', () => {
    const trees = createTrees(2);
    trees[0].position = [4.5, 8, 0];
    trees[1].position = [0, 10.2, 0];
    const setup = createSetup(trees);
    const view = {...createView(), position: [0, 0, 1.5] as [number, number, number], tanX: 0.6};
    updateShellNear(setup, view, {...NEAR, selectedIndex: 1});
    expect([...setup.nearByTree.keys()]).toEqual([0]);
  });

  it('admits equal-depth crowns at the same threshold across the viewport', () => {
    const trees = createTrees(2);
    trees[0].position = [0, 17, 0];
    trees[1].position = [9.5, 17, 0];
    const setup = createSetup(trees);
    const view = {...createView(), position: [0, 0, 1.5] as [number, number, number], tanX: 0.6};
    updateShellNear(setup, view, {...NEAR, most: 2});
    expect([...setup.nearByTree.keys()]).toEqual([0, 1]);
  });

  it.each([
    {axis: 'horizontal', position: [28, 10, 0], tanX: 2, tanY: 0.5},
    {axis: 'vertical', position: [0, 10, 29.5], tanX: 0.5, tanY: 2}
  ])('keeps crowns intersecting a wide $axis side plane', ({position, tanX, tanY}) => {
    const trees = createTrees(1);
    trees[0].position = position as [number, number, number];
    const setup = createSetup(trees);
    const view = {...createView(), position: [0, 0, 1.5] as [number, number, number], tanX, tanY};
    const cell = setup.cells[0];
    // The old fixed 1.2 multiplier rejects this sphere. The exact plane distance intersects it.
    const across = tanX > 1 ? cell.east : cell.up - view.position[2];
    expect(across).toBeGreaterThan(10 * 2 + cell.radius * 1.2);
    expect(across - 10 * 2).toBeLessThan(cell.radius * Math.hypot(1, 2));
    updateShellNear(setup, view, {...NEAR, in: 100, out: 85});
    expect([...setup.nearByTree.keys()]).toEqual([0]);

    const shells = createSetup(trees);
    updateShellBuckets(shells, view, {...BUCKETS, margin: 0});
    expect(shells.bucketOfCell[0]).toBeGreaterThanOrEqual(0);
  });

  it('rejects crowns outside signed side planes behind the camera', () => {
    const trees = createTrees(1);
    trees[0].position = [5, -3, 0];
    const setup = createSetup(trees);
    const view = {...createView(), position: [0, 0, 1.5] as [number, number, number]};
    // Clamping depth to zero used to admit this rear/off-axis sphere into both near and shell lists.
    updateShellNear(setup, view, NEAR);
    expect(setup.nearByTree.size).toBe(0);
    updateShellBuckets(setup, view, {...BUCKETS, margin: 0});
    expect(setup.bucketOfCell[0]).toBe(-1);
  });

  it('chooses the same shell tier for equal-depth crowns across a wide view', () => {
    const setup = createSetup(createTrees(2, 150));
    const view = {
      ...createView(),
      position: [0, -100, 1.5] as [number, number, number],
      focal: 600,
      tanX: 2
    };
    // Both crowns are 27 pixels wide in perspective. A radial metric measured the
    // off-centre crown at only 15 pixels and gave it a coarser hull.
    updateShellBuckets(setup, view, BUCKETS);
    expect(Array.from(setup.bucketOfCell)).toEqual([2, 2]);
  });

  it('keeps shell tiers through small pixel changes and a brief frustum exit', () => {
    const setup = createSetup(createTrees(1));
    const view = createView();
    view.position[1] = -100;
    const setPixels = (pixels: number) => {
      view.focal = (pixels * 100) / setup.cells[0].crownMetres;
      updateShellBuckets(setup, view, BUCKETS);
      return setup.bucketOfCell[0];
    };

    expect(setPixels(11.9)).toBe(0);
    expect(setPixels(12.1)).toBe(1);
    expect(setPixels(11.9)).toBe(1);
    expect(setPixels(10)).toBe(0);
    expect(setPixels(24.1)).toBe(2);
    expect(setPixels(23.9)).toBe(2);
    view.position[0] = 500;
    expect(setPixels(23.9)).toBe(-1);
    view.position[0] = 0;
    expect(setPixels(23.9)).toBe(2);
    expect(setPixels(21)).toBe(1);
    expect(setPixels(9)).toBe(0);
  });

  it('holds the detailed slot when adjacent crowns trade a small score advantage', () => {
    const trees = createTrees(2);
    trees[0].position[0] = -1;
    trees[1].position[0] = 1;
    const setup = createSetup(trees);
    updateShellNear(setup, createView(-0.1), NEAR);
    updateShellNear(setup, createView(-0.1), {...NEAR, now: 1});
    expect([...setup.nearByTree.keys()]).toEqual([0]);

    updateShellNear(setup, createView(0.1), {...NEAR, now: 1.1});
    expect(setup.cells[0].target).toBe(0);
    expect(setup.cells[1].target).toBe(1);

    const closerToOther = createView(4.5);
    updateShellNear(setup, closerToOther, {...NEAR, now: 1.2});
    expect(setup.cells[0].target).toBe(1);
    updateShellNear(setup, closerToOther, {...NEAR, now: 1.7});
    updateShellNear(setup, closerToOther, {...NEAR, now: 1.8});
    expect([...setup.nearByTree.keys()]).toEqual([1]);
  });

  it('keeps coverage continuous when reversing a partly completed handoff', () => {
    const setup = createSetup(createTrees(1));
    const view = createView();
    const cell = setup.cells[0];
    const distance = Math.hypot(view.position[1], view.position[2] - cell.up);
    const setWidth = (pixels: number, now: number) => {
      view.focal = (pixels * Math.max(distance - cell.radius, 0.5)) / cell.crownMetres;
      updateShellNear(setup, view, {...NEAR, now});
      const {canopyColor, trunkColor} = setup.nearByTree.get(0)!.spec;
      expect(trunkColor?.[3]).toBe(canopyColor[3]);
      return canopyColor[3];
    };

    setWidth(331, 0);
    const initial = setWidth(331, 0.2);
    expect(initial).toBeGreaterThan(100);
    expect(initial).toBeLessThan(130);
    // Both reversals move only the coverage represented by the elapsed 10 ms. The apparent
    // size curve lies behind the fade's current position and must not accelerate it.
    const towardShell = setWidth(270, 0.21);
    expect(cell.target).toBe(1);
    expect(Math.abs(towardShell - initial)).toBeLessThanOrEqual(6);
    const towardDetail = setWidth(331, 0.22);
    expect(cell.target).toBe(0);
    expect(Math.abs(towardDetail - towardShell)).toBeLessThanOrEqual(6);
  });

  it('preserves the timed shadow handoff through a large zoom change', () => {
    const setup = createSetup(createTrees(1));
    const view = createView();
    const options = {...NEAR, accelerateBySize: false};
    view.focal *= 4;
    updateShellNear(setup, view, options);
    expect(setup.nearByTree.get(0)?.spec.canopyColor[3]).toBe(0);
    updateShellNear(setup, view, {...options, now: 0.225});
    const {canopyColor, trunkColor} = setup.nearByTree.get(0)!.spec;
    expect(canopyColor[3]).toBeCloseTo(127, -1);
    expect(trunkColor?.[3]).toBe(canopyColor[3]);
    view.focal = 1;
    updateShellNear(setup, view, {...options, now: 0.225});
    expect(setup.nearByTree.get(0)?.spec.canopyColor[3]).toBe(canopyColor[3]);
  });

  it('keeps the near budget through rapid camera changes, with shells covering waiting trees', () => {
    const setup = createSetup(createTrees(4));
    setup.diagnostics = createShellDiagnostics(setup.cells.length);
    updateShellNear(setup, createView(0), {...NEAR, now: 0});
    updateShellNear(setup, createView(0), {...NEAR, now: 1});
    expect([...setup.nearByTree.keys()]).toEqual([0]);

    // Tree 0 still needs geometry during its fade. Tree 1 cannot take another near slot yet,
    // and its fully opaque shell remains present while it waits.
    updateShellNear(setup, createView(100), {...NEAR, now: 1.1});
    expect(setup.nearByTree.size).toBe(1);
    expect(setup.cells[1].target).toBe(1);
    expect(setup.field.cells[1 * 4 + 2]).toBe(1);
    expect(setup.diagnostics.nearReasons[1]).toBe(ShellNearReason.Waiting);
    expect(setup.diagnostics.nearPriority[1]).toBeGreaterThan(0);

    for (let frame = 0; frame < 90; frame++) {
      const east = frame < 5 ? 200 : 300;
      updateShellNear(setup, createView(east), {...NEAR, now: 1.12 + frame / 60});
      expect(setup.nearByTree.size).toBeLessThanOrEqual(1);
    }
    expect([...setup.nearByTree.keys()]).toEqual([3]);
    expect(setup.diagnostics.nearReasons[3]).toBe(ShellNearReason.Detailed);
  });

  it('sizes bounds from actual spacing and updates them after crown, height and lean edits', () => {
    const trees = createTrees(1);
    trees[0].position = [50, 0, 2];
    const setup = createSetup(trees);
    const initial = setup.cells[0].radius;
    updateShellBuckets(setup, createView(), BUCKETS);
    expect(setup.bucketOfCell[0]).toBe(-1);

    trees[0].height = 20;
    trees[0].crownRadius = 10;
    trees[0].lean = [90, 270];
    syncShellTrees(setup, 1, null, 100, 0.1);
    expect(setup.cells[0].radius).toBeGreaterThan(initial * 4);
    expect(setup.cells[0].crownMetres).toBe(40);
    expect(setup.cells[0].up).toBeGreaterThan(2);
    updateShellBuckets(setup, createView(), BUCKETS);
    expect(setup.bucketOfCell[0]).toBeGreaterThanOrEqual(0);
  });

  it('keeps near and far lifecycle values in the same transition without morphing reused near indices', () => {
    const trees = createTrees(2);
    const setup = createSetup(trees);
    updateShellNear(setup, createView(0), {...NEAR, now: 0});
    updateShellNear(setup, createView(0), {...NEAR, now: 1});
    const near = setup.nearByTree.get(0)!;
    const alpha = near.spec.canopyColor[3];
    const transitions = {getTree: 1000};
    const revisionBefore = setup.stateRevision;
    Object.assign(trees[0], {
      height: 6,
      crownRadius: 3,
      growth: 0.2,
      health: 0.3,
      foliage: 0.4,
      flush: 1,
      lean: [30, 90],
      damage: 0.3,
      decay: 0.5
    });
    syncShellTrees(setup, 1, transitions, 1000, 1);
    syncShellTrees(setup, 1, transitions, 1500, 1.5);
    const spec = getNearSpec(near, setup.field.store);
    const values = setup.field.store.getRowValues(setup.rowOf[0]);
    expect(spec.growth).toBeCloseTo(0.6);
    expect(spec.health).toBeCloseTo(values.health);
    expect(spec.foliage).toBeCloseTo(values.foliage);
    expect(spec.flush).toBeCloseTo(values.flush);
    expect(spec.damage).toBeCloseTo(values.damage);
    expect(spec.decay).toBeCloseTo(values.decay);
    expect(spec.height).toBeCloseTo(4.5);
    expect(spec.crownRadius).toBeCloseTo(2.625);
    expect(spec.lean).toEqual([values.leanDegrees, values.leanBearing]);
    expect(near.spec.canopyColor[3]).toBe(alpha);
    expect(setup.stateRevision).toBeGreaterThan(revisionBefore);
    const reusedValues = near.values;
    getNearSpec(near, setup.field.store);
    expect(near.values).toBe(reusedValues);

    // A different source tree takes the same bounded-list index after the hand-over. Its pose
    // comes directly from its own store row rather than transitioning from the previous tree.
    updateShellNear(setup, createView(100), {...NEAR, now: 2});
    updateShellNear(setup, createView(100), {...NEAR, now: 2.6});
    updateShellNear(setup, createView(100), {...NEAR, now: 2.7});
    const replacement = setup.nearByTree.get(1)!;
    const replacementSpec = getNearSpec(replacement, setup.field.store);
    expect(replacement.stateRow).toBe(setup.rowOf[1]);
    expect(replacementSpec.position).toEqual([100, 0, 0]);
    expect(replacementSpec.growth).toBe(1);
    expect(replacementSpec.height).toBe(3);
  });

  it('keeps the old crown inside its bounds until a shrinking transition has finished', () => {
    const trees = createTrees(1);
    trees[0].height = 10;
    trees[0].crownRadius = 6;
    const setup = createSetup(trees);
    const initialRadius = setup.cells[0].radius;
    trees[0].height = 2;
    trees[0].crownRadius = 1;
    syncShellTrees(setup, 1, {getTree: 1000}, 1000, 1);
    expect(setup.cells[0].radius).toBeGreaterThanOrEqual(initialRadius);
    expect(setup.cells[0].crownMetres).toBe(12);
    syncShellTrees(setup, 1, {getTree: 1000}, 1500, 1.5);
    expect(setup.cells[0].radius).toBeGreaterThanOrEqual(initialRadius);
    syncShellTrees(setup, 1, {getTree: 1000}, 2000, 2);
    expect(setup.cells[0].radius).toBeLessThan(initialRadius);
    expect(setup.cells[0].crownMetres).toBe(2);
  });

  it('keeps the same grove section as OrbitView when zoomed in and tilted off-axis', () => {
    const trees = createTrees(6);
    trees.forEach((tree, index) => {
      const sign = index < 3 ? 1 : -1;
      const scale = (index % 3) + 1;
      tree.position = [sign * 32 * scale, 22 * scale, 0];
    });
    const setup = createSetup(trees);
    const width = 1163;
    const height = 654;
    for (const rotationOrbit of [55, -55]) {
      const camera = {
        target: [0, 0, 1.5] as [number, number, number],
        zoom: 9,
        rotationOrbit,
        rotationX: 14
      };
      const viewport = new OrbitViewport({...camera, width, height, fovy: 36.87, far: 500});
      const view = createView();
      updateShellView(view, getFieldCamera(camera), width, height);
      view.position.forEach((value, axis) =>
        expect(value).toBeCloseTo(viewport.cameraPosition[axis], 4)
      );
      const expected = trees.flatMap((tree, index) => {
        const [x, y, depth] = viewport.project([tree.position[0], tree.position[1], 1.5]);
        return x > 0 && x < width && y > 0 && y < height && depth >= 0 && depth < 1 ? [index] : [];
      });
      expect(expected).toEqual(rotationOrbit > 0 ? [0, 1, 2] : [3, 4, 5]);
      updateShellBuckets(setup, view, BUCKETS);
      expect(
        Array.from(setup.bucketOfCell).flatMap((bucket, index) => (bucket >= 0 ? [index] : []))
      ).toEqual(expected);
    }
  });
});
