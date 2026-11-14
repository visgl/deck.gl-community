// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import {expect, it} from 'vitest';
import type {TreeSpec} from '../../src';
import {createOrchard, getOrchardLngLat, getTreeRenderTiers} from './tree-grove-test-utils';
import {mountTreeScene} from './tree-layer-test-utils';

it('keeps partially updated instance attributes byte-equal to a full rebuild while orbiting', async ({
  annotate
}) => {
  const [longitude, latitude] = getOrchardLngLat(60, 0);
  const viewState = {
    width: 640,
    height: 376,
    longitude,
    latitude,
    zoom: 18.6,
    pitch: 50,
    bearing: 0
  };
  const scene = mountTreeScene<TreeSpec>(new WebMercatorViewport(viewState));
  scene.render({data: createOrchard(24, 32), getTree: tree => tree, windStrength: 0});

  const counts = {checked: 0, resized: 0, refining: 0, entered: 0, departed: 0};
  const stale: string[] = [];
  const previousCounts = new Map<string, number>();
  const check = () => {
    for (const layer of scene.children()) {
      const manager = layer.isComposite ? null : layer.getAttributeManager();
      if (!manager) continue;
      const count = layer.getNumInstances();
      if (previousCounts.has(layer.id) && previousCounts.get(layer.id) !== count) counts.resized++;
      previousCounts.set(layer.id, count);
      const attributes = Object.entries(manager.getAttributes()).filter(
        ([, attribute]) => attribute.value && !attribute.isConstant
      );
      const before = attributes.map(([, attribute]) => {
        const snapshot = attribute.value!.slice(0, count * attribute.size);
        return new Uint8Array(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
      });
      manager.invalidateAll();
      layer['_updateAttributes']();
      attributes.forEach(([name, attribute], i) => {
        counts.checked++;
        const value = attribute.value!;
        const fresh = new Uint8Array(
          value.buffer,
          value.byteOffset,
          Math.min(value.byteLength, before[i].length)
        );
        if (fresh.length !== before[i].length || before[i].some((byte, j) => byte !== fresh[j])) {
          stale.push(`${layer.id}.${name}`);
        }
      });
    }
  };

  check();
  let previousTiers = getTreeRenderTiers(scene.layer());
  for (let i = 1; i <= 16; i++) {
    // Orbit through the edge of the planting, then zoom while the orbit continues.
    scene.setViewport(
      new WebMercatorViewport({
        ...viewState,
        bearing: i * 3,
        zoom: viewState.zoom + Math.max(0, i - 8) * 0.1
      })
    );
    check();
    const tiers = getTreeRenderTiers(scene.layer());
    for (const [owner, tier] of tiers) {
      if (!previousTiers.has(owner)) counts.entered++;
      else if (previousTiers.get(owner) !== tier) counts.refining++;
    }
    for (const owner of previousTiers.keys()) if (!tiers.has(owner)) counts.departed++;
    previousTiers = tiers;
  }
  await annotate('Grove instance attribute coverage', {
    body: JSON.stringify(counts),
    contentType: 'application/json'
  });
  expect(counts.checked).toBeGreaterThan(100);
  expect(counts.resized).toBeGreaterThan(0);
  expect(counts.refining).toBeGreaterThan(0);
  expect(counts.entered).toBeGreaterThan(0);
  expect(counts.departed).toBeGreaterThan(0);
  expect(stale).toEqual([]);
});
