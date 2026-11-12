// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {type CropConfig, type TreeLayerProps, type TreeSpec, type TreeType} from '../../src';
import {mountTreeScene} from './tree-layer-test-utils';

const SPECIES: TreeType[] = ['citrus', 'pine', 'palm'];
const FRUIT: CropConfig = {kind: 'fruit', color: [240, 140, 20], count: 20, radius: 0.25};
const OPTIONS: Partial<TreeLayerProps<TreeSpec>> = {windTime: 0};

function tree(species: TreeType = 'oak', authored: Partial<TreeSpec> = {}): TreeSpec {
  return {position: [0, 0, 0], species, height: 12, crownRadius: 3, ...authored};
}

function lifecycleScene() {
  const scene = mountTreeScene<TreeSpec>();
  return {
    ...scene,
    render(data: TreeSpec[], props: Partial<TreeLayerProps<TreeSpec>> = {}) {
      return scene.render({...OPTIONS, ...props, data});
    }
  };
}

type StateRow = ReturnType<ReturnType<typeof lifecycleScene>['row']>;

describe('TreeLayer lifecycle state', () => {
  it.each(SPECIES)('%s: uses the same state with omitted and explicit defaults', species => {
    const scene = lifecycleScene();
    scene.render([tree(species)]);
    const implicit = scene.row();
    scene.render([
      tree(species, {
        growth: 1,
        health: 1,
        foliage: 1,
        flush: 0,
        lean: [0, 0],
        damage: 0,
        decay: 0
      })
    ]);
    expect(scene.row()).toEqual(implicit);
    expect(implicit.height).toBe(12);
    expect(implicit.trunkRadius).toBeGreaterThan(0);
    expect(implicit.growth).toBe(1);
    expect(scene.layer().state.stateTexture).toBeTruthy();
  });

  it.each(SPECIES)('%s: keeps authored dimensions and life controls independent', species => {
    const scene = lifecycleScene();
    scene.render([tree(species, {crop: FRUIT})]);
    const adult = scene.row();
    for (const growth of [0, 0.03, 0.12, 0.35, 0.7]) {
      scene.render([
        tree(species, {
          growth,
          health: 0.6,
          foliage: 0.4,
          flush: 0.3,
          lean: [25, 90],
          damage: 0.2,
          decay: 0.1,
          crop: FRUIT
        })
      ]);
      const row = scene.row();
      expect(row).toMatchObject({
        growth,
        health: 0.6,
        foliage: 0.4,
        flush: 0.3,
        leanDegrees: 25,
        leanBearing: 90,
        damage: 0.2,
        decay: 0.1,
        height: adult.height,
        trunkHeight: adult.trunkHeight,
        trunkRadius: adult.trunkRadius,
        crownX: adult.crownX,
        crownY: adult.crownY,
        crops: adult.crops,
        seed: adult.seed,
        yaw: adult.yaw
      });
    }
    expect(scene.layer().state.store!.data.every(Number.isFinite)).toBe(true);
  });

  it('sanitizes out-of-range or non-finite life controls without changing the authored colors', () => {
    const scene = lifecycleScene();
    scene.render([
      tree('oak', {
        growth: Infinity,
        health: -2,
        foliage: 2,
        flush: NaN,
        lean: [110, NaN],
        damage: -0.1,
        decay: 2,
        canopyColor: [40, 120, 30],
        trunkColor: [85, 70, 40]
      })
    ]);
    expect(scene.row()).toMatchObject({
      growth: 1,
      health: 0,
      foliage: 1,
      flush: 0,
      leanDegrees: 90,
      leanBearing: 0,
      damage: 0,
      decay: 1,
      canopyColor: [40, 120, 30, 255],
      trunkColor: [85, 70, 40, 255]
    });
  });

  it('gives wood, foliage and crops the same wind and time', () => {
    const scene = lifecycleScene();
    const data = [tree('citrus', {crop: FRUIT, wind: 1}), tree('oak', {position: [1e-4, 0, 0]})];
    const layer = scene.render(data, {
      windStrength: 0.5,
      windDirection: 90,
      windTime: 2,
      lodBias: -2
    });
    const direction = layer.state.windVector!;
    expect(direction[0]).toBeCloseTo(1, 8);
    expect(direction[1]).toBeCloseTo(0, 8);
    expect(scene.row(0).windFlex).toBe(1);
    expect(scene.row(1).windFlex).toBe(0.5);
    const parts = scene.children().filter(child => /photoreal-(wood|leaves|crops)/.test(child.id));
    expect(parts.some(child => child.id.includes('crops'))).toBe(true);
    for (const child of parts) {
      expect(child.props.windDirection).toBe(direction);
      expect(child.props.windTime).toBe(2);
    }
    scene.render(data, {windStrength: 0.5, windDirection: 90, windTime: 3, lodBias: -2});
    expect(scene.layer().state.windVector).toBe(direction);
  });
});

describe('TreeLayer timeline transitions', () => {
  it('holds a foliage transition and its shared texture while the timeline is paused', () => {
    const scene = lifecycleScene();
    const data = [tree()];
    const render = (foliage: number) =>
      scene.render(data, {
        getFoliage: () => foliage,
        transitions: {getFoliage: 1000},
        updateTriggers: {getFoliage: foliage}
      });
    const texture = render(1).state.stateTexture;
    render(0);
    scene.tick(1250);
    expect(scene.row().foliage).toBeCloseTo(0.75, 8);
    expect(scene.layer().hasUniformTransition()).toBe(true);
    const store = scene.layer().state.store!;
    const held = store.data.slice();
    scene.tick(1250);
    scene.tick(1250);
    expect(scene.layer().state.store).toBe(store);
    expect(scene.layer().state.stateTexture).toBe(texture);
    expect(store.data).toEqual(held);
    scene.tick(1500);
    expect(scene.row().foliage).toBeCloseTo(0.5, 8);
    scene.tick(2100);
    expect(scene.row().foliage).toBe(0);
    expect(scene.layer().hasUniformTransition()).toBe(false);
  });

  it('uses explicit accessor settings ahead of getTree and settles springs', () => {
    const scene = lifecycleScene();
    const render = (lean: TreeSpec['lean'], damage: number) =>
      scene.render([tree('oak', {lean, damage})], {
        getTree: row => row,
        transitions: {getTree: 1000, getLean: {type: 'spring', stiffness: 0.1, damping: 0.4}}
      });
    render([0, 90], 0);
    render([60, 90], 1);
    scene.tick(1500);
    expect(scene.row().damage).toBeCloseTo(0.5, 8);
    expect(scene.row().leanDegrees).toBeGreaterThan(30);
    for (let time = 1600; time <= 12000; time += 100) scene.tick(time);
    expect(scene.row().leanDegrees).toBeCloseTo(60, 3);
    expect(scene.row().damage).toBe(1);
    expect(scene.layer().hasUniformTransition()).toBe(false);
  });

  const cases: [string, Partial<TreeSpec>, Partial<TreeSpec>, (row: StateRow) => number][] = [
    ['getHeight', {height: 10}, {height: 20}, row => row.height],
    ['getCanopyRadius', {crownRadius: 2}, {crownRadius: 4}, row => row.crownX],
    ['getTrunkRadius', {trunkRadius: 0.2}, {trunkRadius: 0.4}, row => row.trunkRadius],
    [
      'getTrunkHeightFraction',
      {trunkHeightFraction: 0.2},
      {trunkHeightFraction: 0.4},
      row => row.trunkHeight
    ],
    ['getElevation', {elevation: 0}, {elevation: 10}, row => row.position[2]],
    [
      'getCanopyColor',
      {canopyColor: [0, 100, 0]},
      {canopyColor: [100, 100, 0]},
      row => row.canopyColor[0]
    ],
    [
      'getTrunkColor',
      {trunkColor: [0, 100, 0]},
      {trunkColor: [100, 100, 0]},
      row => row.trunkColor[0]
    ]
  ];
  it.each(cases)('tweens %s into the shared renderer state', (key, from, to, read) => {
    const scene = lifecycleScene();
    const render = (value: Partial<TreeSpec>) =>
      scene.render([tree('oak', value)], {
        getTree: row => row,
        transitions: {[key]: 1000}
      });
    render(from);
    const start = read(scene.row());
    render(to);
    scene.tick(1500);
    const middle = read(scene.row());
    scene.tick(2100);
    const end = read(scene.row());
    expect(end).not.toBe(start);
    expect(middle).toBeCloseTo((start + end) / 2, 6);
    expect(scene.layer().hasUniformTransition()).toBe(false);
  });

  it('calls transition callbacks for each tree and skips unchanged initial values', () => {
    const scene = lifecycleScene();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const data = [tree(), tree('pine', {position: [1e-4, 0, 0]})];
    const render = (growth: number) =>
      scene.render(data, {
        getGrowth: growth,
        transitions: {getGrowth: {duration: 1000, onStart, onEnd}}
      });
    render(0.5);
    expect(onStart).not.toHaveBeenCalled();
    render(0.9);
    expect(onStart.mock.calls).toEqual([
      [0, 'getGrowth'],
      [1, 'getGrowth']
    ]);
    scene.tick(1500);
    expect(onEnd).not.toHaveBeenCalled();
    scene.tick(2100);
    expect(onEnd.mock.calls).toEqual([
      [0, 'getGrowth'],
      [1, 'getGrowth']
    ]);
  });

  it('keeps both crop shapes during a kind change and tweens count, ripeness and fallen amounts', () => {
    const scene = lifecycleScene();
    const render = (crop: CropConfig | CropConfig[]) =>
      scene.render([tree('citrus', {crop})], {
        transitions: {getCrop: 1000}
      });
    render({...FRUIT, ripeness: 0});
    render({...FRUIT, count: 30, ripeness: 1, fallen: 0.8, droppedCount: 10});
    scene.tick(1500);
    expect(scene.row().crops[0]).toMatchObject({count: 25, ripeness: 0.5, fallen: 0.4, dropped: 5});
    scene.tick(2100);
    render({...FRUIT, kind: 'lemon'});
    scene.tick(2600);
    const kinds = scene.layer().state.cropKinds;
    expect(kinds).toEqual(['fruit', 'lemon']);
    expect(scene.row().crops.map(crop => crop.count)).toEqual([15, 10]);
    scene.tick(3200);
    expect(scene.row().crops.map(crop => crop.count)).toEqual([0, 20]);
  });

  it('tweens deciduous foliage into winter and preserves its owner', () => {
    const scene = lifecycleScene();
    const render = (season: TreeSpec['season']) =>
      scene.render([tree('oak', {season})], {
        getTree: row => row,
        transitions: {getTree: 1000}
      });
    const old = render('summer').state.photoreal!.rows[0];
    render('winter');
    scene.tick(1500);
    expect(scene.row().foliage).toBeCloseTo(0.5, 8);
    expect(scene.layer().state.photoreal!.rows[0]).toBe(old);
    scene.tick(2100);
    expect(scene.row().foliage).toBe(0);
  });

  it('keeps a moving tree’s seed, yaw and crown throughout a position tween', () => {
    const scene = lifecycleScene();
    const render = (x: number) =>
      scene.render([tree('oak', {position: [x, 0, 0]})], {
        transitions: {getPosition: 1000}
      });
    const group = [...render(0).state.photoreal!.groups.values()][0];
    const {seed, yaw, crownX, crownY} = scene.row();
    render(1e-4);
    scene.tick(1500);
    const row = scene.row();
    expect(row.position[0]).toBeCloseTo(0.5e-4, 12);
    expect(row).toMatchObject({seed, yaw, crownX, crownY});
    expect([...scene.layer().state.photoreal!.groups.values()][0]).toBe(group);
  });

  it('tweens per-tree wind under getTree', () => {
    const scene = lifecycleScene();
    const render = (wind: number) =>
      scene.render([tree('oak', {wind}), tree('oak', {position: [1e-4, 0, 0], wind: 0.5})], {
        windStrength: 0.5,
        transitions: {getTree: 1000}
      });
    render(0.5);
    render(0.25);
    scene.tick(1500);
    expect(scene.row().windFlex).toBeCloseTo(0.75, 8);
    expect(scene.row(1).windFlex).toBe(1);
    scene.tick(2100);
    expect(scene.row().windFlex).toBeCloseTo(0.5, 8);
  });

  it('jumps to accessor values when a transition is removed mid-tween', () => {
    const scene = lifecycleScene();
    const data = [tree()];
    const render = (growth: number, transitions: TreeLayerProps<TreeSpec>['transitions']) =>
      scene.render(data, {getGrowth: growth, transitions});
    const {store, stateTexture} = render(0.2, {getGrowth: 1000}).state;
    render(0.8, {getGrowth: 1000});
    scene.tick(1500);
    expect(scene.row().growth).toBeCloseTo(0.5, 8);
    render(0.8, null);
    expect(scene.row().growth).toBe(0.8);
    expect(scene.layer().state.store).toBe(store);
    expect(scene.layer().state.stateTexture).toBe(stateTexture);
    expect(scene.layer().hasUniformTransition()).toBe(false);
  });

  it('starts a new row from enter and leaves existing rows in place', () => {
    const scene = lifecycleScene();
    const one = tree();
    const two = tree('oak', {position: [1e-4, 0, 0]});
    const render = (data: TreeSpec[]) =>
      scene.render(data, {
        transitions: {getGrowth: {duration: 1000, enter: () => [0]}}
      });
    render([one]);
    scene.tick(2000);
    render([one, two]);
    scene.tick(2500);
    expect(scene.row(0).growth).toBe(1);
    expect(scene.row(1).growth).toBeCloseTo(0.5, 8);
    scene.tick(3100);
    expect(scene.row(1).growth).toBe(1);
  });

  it('updates source identity on a trigger and regroups when the species changes', () => {
    const scene = lifecycleScene();
    const first = tree();
    const replacement = tree('oak', {health: 0.6});
    const data = [first];
    const render = (revision: number) => scene.render(data, {updateTriggers: {getTree: revision}});
    const initial = render(0).state.photoreal!.rows[0];
    data[0] = replacement;
    let layer = render(1);
    const row = layer.state.photoreal!.rows[0];
    expect(row).toBe(initial);
    expect(scene.row().health).toBe(0.6);
    const picked = layer.getPickingInfo({info: {index: 0, object: row}} as never);
    expect(picked.object).toBe(replacement);
    data[0] = tree('birch');
    layer = render(2);
    expect([...layer.state.photoreal!.groups.values()].map(group => group.species)).toEqual([
      'birch'
    ]);
  });
});
