// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {
  getSyntheticWorldTile,
  getWorldTileCount,
  getWorldSourceSettings,
  WORLD_TREE_COUNT
} from './world-source';

it('partitions 3.04 trillion synthetic records exactly and generates only requested bounded leaf rows', async () => {
  expect(getWorldTileCount(0, 0, 0)).toBe(WORLD_TREE_COUNT);
  for (const z of [0, 5, 12, 17]) {
    const x = Math.floor(2 ** z * 0.3),
      y = Math.floor(2 ** z * 0.7);
    const children = [0, 1].flatMap(dx =>
      [0, 1].map(dy => getWorldTileCount(x * 2 + dx, y * 2 + dy, z + 1))
    );
    expect(children.reduce((a, b) => a + b, 0)).toBe(getWorldTileCount(x, y, z));
  }
  const request = {
    index: {x: 131072, y: 131071, z: 18},
    id: 'leaf',
    bbox: {west: 0, east: 1, north: 1, south: 0}
  };
  const a = await getSyntheticWorldTile(request),
    b = await getSyntheticWorldTile(request);
  expect(a).toEqual(b);
  expect(a.trees.length).toBeGreaterThan(40);
  expect(a.trees.length).toBeLessThan(50);
  expect(a.byteLength).toBeLessThan(16000);
  const parent = await getSyntheticWorldTile({...request, index: {x: 32768, y: 32767, z: 16}});
  for (const tree of a.trees) expect(parent.trees).toContainEqual(tree);
  expect(parent.trees.length).toBeLessThanOrEqual(1024);
  const world = await getSyntheticWorldTile({...request, index: {x: 0, y: 0, z: 0}});
  expect(world.trees).toHaveLength(0);
  expect(world.canopies.length).toBeLessThanOrEqual(1024);
  expect(world.canopies.reduce((sum, cell) => sum + cell.treeCount, 0)).toBe(WORLD_TREE_COUNT);
  const controller = new AbortController();
  controller.abort();
  await expect(
    getSyntheticWorldTile({...request, signal: controller.signal})
  ).rejects.toMatchObject({name: 'AbortError'});
});
it('changes rainforest density without changing global count and retains fine-tree identities', async () => {
  const options = {count: WORLD_TREE_COUNT, density: 400, profile: 'rainforest' as const};
  const settings = getWorldSourceSettings(options);
  expect(settings.density).toBeCloseTo(400, 4);
  expect(getWorldTileCount(0, 0, 0, options)).toBe(WORLD_TREE_COUNT);
  for (const z of [0, 5, 8, 17, 19]) {
    const x = (2 ** (z - 1)) | 0,
      y = x;
    expect(
      [0, 1]
        .flatMap(dx => [0, 1].map(dy => getWorldTileCount(x * 2 + dx, y * 2 + dy, z + 1, options)))
        .reduce((a, b) => a + b, 0)
    ).toBe(getWorldTileCount(x, y, z, options));
  }
  const request = {
    index: {x: 524288, y: 524287, z: 20},
    id: 'rain',
    bbox: {west: 0, east: 1, south: 0, north: 1}
  };
  const sparse = await getSyntheticWorldTile(request, {...options, density: 100});
  const dense = await getSyntheticWorldTile(request, {...options, density: 800});
  expect(dense.trees.length).toBeGreaterThan(sparse.trees.length * 6);
  for (const tree of sparse.trees) expect(dense.trees).toContainEqual(tree);
  const parent = await getSyntheticWorldTile(
    {...request, index: {x: 262144, y: 262143, z: 19}},
    options
  );
  const child = await getSyntheticWorldTile(request, options);
  for (const tree of child.trees) expect(parent.trees).toContainEqual(tree);
  expect(parent.trees.length).toBeLessThanOrEqual(1024);
});

it('keeps distant crown volumes physical rather than stretching them above the rainforest', async () => {
  const tile = await getSyntheticWorldTile(
    {index: {x: 65536, y: 65535, z: 17}, id: 'far', bbox: {west: 0, east: 1, south: 0, north: 1}},
    {density: 400, profile: 'rainforest'}
  );
  expect(tile.canopies.length).toBeGreaterThan(0);
  for (const crown of tile.canopies) {
    expect(crown.position[2]).toBe(18);
    expect(crown.scale[2]).toBeLessThan(18);
    // Source cells at z20 are about 38m across; summaries overlap locally.
    expect(crown.scale[0]).toBeLessThan(36);
    expect(crown.scale[1]).toBeLessThan(36);
  }
});

it.each([
  NaN,
  Infinity,
  -Infinity
])('falls back from non-finite source settings %s', async value => {
  const options = {count: value, density: value};
  expect(getWorldTileCount(0, 0, 0, options)).toBe(WORLD_TREE_COUNT);
  expect(getWorldSourceSettings(options)).toEqual(getWorldSourceSettings());
  await expect(
    getSyntheticWorldTile(
      {
        index: {x: 0, y: 0, z: 0},
        id: 'world',
        bbox: {west: -180, east: 180, south: -85, north: 85}
      },
      options
    )
  ).resolves.toHaveProperty('canopies');
});
