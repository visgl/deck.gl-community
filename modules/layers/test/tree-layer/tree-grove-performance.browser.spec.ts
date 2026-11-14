// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, Layer, MapView, type MapViewState} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {expect, it} from 'vitest';
import {commands} from 'vitest/browser';
import {TreeLayer, type TreeSpec} from '../../src';
import {createOrchard, getOrchardLngLat, getTreeRenderTiers} from './tree-grove-test-utils';

// Generated orchard block: ~17k citrus trees, rows 7 m apart and 4.5 m in-row.
const ROWS = 140;
const TREES_PER_ROW = 122;
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 752;

/** A deck driven one frame at a time, as an interleaved basemap drives its overlay. */
async function mountOrchard(data: TreeSpec[], viewState: MapViewState) {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px`;
  document.body.append(parent);
  const errors: string[] = [];
  let rendered = 0;
  const deck = new Deck({
    parent,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
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
  const [longitude, latitude] = getOrchardLngLat(east, 0);
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
