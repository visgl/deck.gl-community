// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, Layer, MapView, WebMercatorViewport, type MapViewState} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {commands} from 'vitest/browser';
import {TreeLayer, type TreeSpec} from '../../src';
import {getTreeRenderTiers} from './tree-grove-test-utils';

// Generated orchard block: ~17k citrus trees, rows 7 m apart and 4.5 m in-row.
const ROWS = 140;
const TREES_PER_ROW = 122;
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 752;
const ORIGIN = [-81.7, 28.1];
const ORIGIN_VIEWPORT = new WebMercatorViewport({
  width: 1,
  height: 1,
  longitude: ORIGIN[0],
  latitude: ORIGIN[1]
});
const getLngLat = (east: number, north: number) =>
  ORIGIN_VIEWPORT.addMetersToLngLat(ORIGIN, [east, north]);
function createOrchard(rows: number, treesPerRow: number): TreeSpec[] {
  const trees: TreeSpec[] = [];
  for (let row = 0; row < rows; row++)
    for (let tree = 0; tree < treesPerRow; tree++) {
      const [longitude, latitude] = getLngLat(
        (tree - (treesPerRow - 1) / 2) * 4.5,
        (row - (rows - 1) / 2) * 7
      );
      trees.push({
        position: [longitude, latitude, 0],
        species: 'citrus',
        height: 3,
        crownRadius: 2.25,
        wind: false
      });
    }
  return trees;
}

/** A deck driven one frame at a time, as an interleaved basemap drives its overlay. */
async function mountOrchard(
  data: TreeSpec[],
  viewState: MapViewState,
  width = STAGE_WIDTH,
  height = STAGE_HEIGHT
) {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(parent);
  const errors: string[] = [];
  let rendered = 0;
  const deck = new Deck({
    parent,
    width,
    height,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView({id: 'orchard'}),
    viewState,
    layers: [
      new TreeLayer<TreeSpec>({
        id: 'orchard-trees',
        data,
        getTree: tree => tree,
        windStrength: 0
      })
    ],
    onError: error => errors.push(error.message),
    onAfterRender: () => rendered++
  });
  const tiers = () =>
    getTreeRenderTiers(
      deck['layerManager']
        ?.getLayers()
        .find((layer): layer is TreeLayer<TreeSpec> => layer instanceof TreeLayer)
    );
  await expect.poll(() => rendered, {timeout: 60_000}).toBeGreaterThan(0);
  await expect.poll(() => tiers().size, {timeout: 60_000}).toBeGreaterThan(0);
  deck['animationLoop'].stop();
  return {
    deck,
    errors,
    tiers,
    /** Apply a camera and draw one frame; deck.gl updates layers synchronously in setProps. */
    frame(next: MapViewState) {
      deck.setProps({viewState: next});
      deck['_onRenderFrame']();
    },
    finalize() {
      deck.finalize();
      parent.remove();
    }
  };
}

function instrument() {
  const timers = new Map<string, number>();
  const restore: (() => void)[] = [];
  const wrap = (name: string, target: object, method: string) => {
    const original = target[method];
    target[method] = function (...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        timers.set(name, (timers.get(name) ?? 0) + performance.now() - start);
      }
    };
    restore.push(() => (target[method] = original));
  };
  wrap('tree.updateState', TreeLayer.prototype, 'updateState');
  wrap('tree.renderLayers', TreeLayer.prototype, 'renderLayers');
  wrap('attributes', Layer.prototype, '_updateAttributes');
  return {timers, restore: () => restore.forEach(callback => callback())};
}

async function measureOrbit(data: TreeSpec[], zoom: number, east: number, frameCount: number) {
  // Offset the orbit center so a screen edge sweeps across the block, changing membership.
  const [longitude, latitude] = getLngLat(east, 0);
  const viewState = {longitude, latitude, zoom, pitch: 55, bearing: 0};
  const orchard = await mountOrchard(data, viewState);
  const {timers, restore} = instrument();
  const frames: Record<string, number>[] = [];
  try {
    const frame = (bearing: number) => {
      timers.clear();
      const start = performance.now();
      orchard.frame({...viewState, bearing});
      const total = performance.now() - start;
      const tiers = orchard.tiers();
      frames.push({
        total,
        visible: tiers.size,
        individual: [...tiers.values()].filter(tier => tier < 4).length,
        clumps: [...tiers.values()].filter(tier => tier === 4).length,
        hulls: [...tiers.values()].filter(tier => tier > 4).length,
        ...Object.fromEntries(timers)
      });
    };
    // Settle the first camera selection and detail transitions.
    for (let i = 0; i < 30; i++) frame(0);
    frames.length = 0;
    // A slow orbit: every frame moves the camera, as a basemap drag does.
    for (let i = 1; i <= frameCount; i++) frame(i * 0.25);
  } finally {
    restore();
    orchard.finalize();
  }
  expect(orchard.errors).toEqual([]);
  const keys = [...new Set(frames.flatMap(frame => Object.keys(frame)))];
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  return Object.fromEntries(
    keys.map(key => [key, Number(median(frames.map(frame => frame[key] ?? 0)).toFixed(2))])
  );
}

it('reports per-frame CPU while orbiting a large generated citrus block', async ({annotate}) => {
  const data = createOrchard(ROWS, TREES_PER_ROW);
  // Compare a broad orchard orbit with a tighter view.
  const wide = await measureOrbit(data, 15.5, 680, 30);
  const mid = await measureOrbit(data, 18.6, 0, 30);
  const body = JSON.stringify({wide, mid}, null, 2);
  // deck.gl hides passing browser tests' console output; *.log files are not committed.
  await commands.writeFile('tree-grove-performance.log', `median ms per orbit frame\n${body}\n`);
  await annotate('Tree grove orbit profile', {
    body,
    bodyEncoding: 'utf-8',
    contentType: 'application/json'
  });
  expect(wide.visible).toBeGreaterThan(14_000);
  expect(mid.visible).toBeGreaterThan(2_000);
}, 300_000);

it('keeps every partially uploaded instance row equal to a full rebuild while orbiting', async () => {
  const [longitude, latitude] = getLngLat(60, 0);
  const viewState = {longitude, latitude, zoom: 18.6, pitch: 50, bearing: 0};
  const orchard = await mountOrchard(createOrchard(24, 32), viewState, 640, 376);
  // Preserve the viewport and draw path for the attribute comparison at lower framebuffer cost.
  orchard.deck.setProps({useDevicePixels: 0.25});
  let stale = 0,
    checked = 0,
    refining = 0,
    resized = 0,
    entered = 0,
    departed = 0;
  const previousCounts = new Map<string, number>();
  const check = () => {
    for (const layer of orchard.deck['layerManager']!.getLayers()) {
      const manager = layer.isComposite ? null : layer.getAttributeManager();
      if (!manager) continue;
      const count = layer.getNumInstances();
      if (previousCounts.has(layer.id) && previousCounts.get(layer.id) !== count) resized++;
      previousCounts.set(layer.id, count);
      const attributes = Object.entries(manager.getAttributes()).filter(
        ([, attribute]) => attribute.value && !attribute.isConstant
      );
      const before = attributes.map(([, attribute]) =>
        attribute.value!.slice(0, count * attribute.size)
      );
      manager.invalidateAll();
      layer['_updateAttributes']();
      attributes.forEach(([, attribute], i) => {
        checked++;
        const fresh = attribute.value!;
        if (before[i].some((value, j) => value !== fresh[j] && !Number.isNaN(value))) stale++;
      });
    }
  };
  try {
    check();
    let previousTiers = orchard.tiers();
    for (let i = 1; i <= 16; i++) {
      // Orbit through the edge of the planting, then zoom while the orbit continues.
      orchard.frame({
        ...viewState,
        bearing: i * 3,
        zoom: viewState.zoom + Math.max(0, i - 8) * 0.1
      });
      check();
      const tiers = orchard.tiers();
      for (const [owner, tier] of tiers) {
        if (!previousTiers.has(owner)) entered++;
        else if (previousTiers.get(owner) !== tier) refining++;
      }
      for (const owner of previousTiers.keys()) if (!tiers.has(owner)) departed++;
      previousTiers = tiers;
    }
    expect(orchard.errors).toEqual([]);
    expect(checked).toBeGreaterThan(100);
    expect(resized).toBeGreaterThan(0);
    expect(refining).toBeGreaterThan(0);
    expect(entered).toBeGreaterThan(0);
    expect(departed).toBeGreaterThan(0);
    expect(stale).toBe(0);
  } finally {
    orchard.finalize();
  }
}, 120_000);
