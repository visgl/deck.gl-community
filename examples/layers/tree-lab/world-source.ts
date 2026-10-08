// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {_TileLoadProps} from '@deck.gl/geo-layers';
import type {TreeTileData, TreeType} from '@deck.gl-community/layers';
import type {ForestSpecimen} from './forest-data';
/** Synthetic capacity, never an observed inventory. */
export const WORLD_TREE_COUNT = 3_040_000_000_000;
export const WORLD_LEAF_ZOOM = 20;
export type WorldSourceOptions = {
  count?: number;
  density?: number;
  profile?: 'mixed' | 'rainforest';
};
export type WorldSpecimen = ForestSpecimen & {
  key: string;
  trunkFraction: number;
  shade: [number, number, number, number];
};
const SPECIES: TreeType[] = [
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus'
];
const PATCH_ZOOM = 8;
const PATCHES = [
  [127, 127],
  [127, 128],
  [128, 127],
  [128, 128]
] as const;
function getMorton(x: number, y: number, z: number) {
  let code = 0n;
  for (let bit = z - 1; bit >= 0; bit--)
    code = code * 4n + BigInt(((x >> bit) & 1) + ((y >> bit) & 1) * 2);
  return code;
}
function partition(count: number, code: bigint, depth: number) {
  const denominator = 4n ** BigInt(depth),
    total = BigInt(count);
  return Number(((code + 1n) * total) / denominator - (code * total) / denominator);
}
export function getWorldPosition(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}
/** Redistribute a small part of the global capacity into a dense equatorial forest.
 * Parent/child counts remain exact. Density controls a local forest, not a fictitious observed world density.
 */
export function getWorldSourceSettings(options: WorldSourceOptions = {}) {
  const count = Math.max(
    1,
    Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.round(Number.isFinite(options.count) ? options.count! : WORLD_TREE_COUNT)
    )
  );
  const density = Math.max(
    0,
    Math.min(800, Number.isFinite(options.density) ? options.density! : 0)
  );
  const [west, north] = getWorldPosition(127, 127, PATCH_ZOOM),
    [east, south] = getWorldPosition(128, 128, PATCH_ZOOM);
  const hectares = Math.abs((east - west) * 111320 * (north - south) * 111320) / 10000;
  const patchCount = Math.min(
    Math.floor(count / 8),
    Math.max(
      0,
      Math.round((hectares * density - count / 4 ** PATCH_ZOOM) / (1 - 4 / 4 ** PATCH_ZOOM))
    )
  );
  return {
    count,
    density: (patchCount + (count - patchCount * 4) / 4 ** PATCH_ZOOM) / hectares,
    patchCount,
    baseCount: count - patchCount * 4,
    profile: options.profile ?? 'mixed'
  };
}
export function getWorldTileCount(
  x: number,
  y: number,
  z: number,
  options: WorldSourceOptions = {}
): number {
  const settings = getWorldSourceSettings(options),
    code = getMorton(x, y, z);
  let count = partition(settings.baseCount, code, z);
  for (const [px, py] of PATCHES) {
    if (z <= PATCH_ZOOM) {
      const span = 2 ** (PATCH_ZOOM - z);
      if (Math.floor(px / span) === x && Math.floor(py / span) === y) count += settings.patchCount;
    } else {
      const span = 2 ** (z - PATCH_ZOOM);
      if (Math.floor(x / span) === px && Math.floor(y / span) === py)
        count += partition(
          settings.patchCount,
          code % 4n ** BigInt(z - PATCH_ZOOM),
          z - PATCH_ZOOM
        );
    }
  }
  return count;
}
function noise(seed: number, salt: number) {
  let v = Math.imul(seed ^ salt, 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 16), 0xc2b2ae35);
  return ((v ^ (v >>> 13)) >>> 0) / 4294967296;
}
/** Expand only a bounded requested page; source keys and positions survive refinement/density edits. */
export async function getSyntheticWorldTile(
  tile: _TileLoadProps,
  options: WorldSourceOptions = {}
): Promise<TreeTileData<WorldSpecimen>> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (tile.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const {x, y, z} = tile.index,
    settings = getWorldSourceSettings(options);
  const trees: WorldSpecimen[] = [],
    canopies: TreeTileData['canopies'] = [];
  const count = getWorldTileCount(x, y, z, options);
  if (z >= 16 && count <= 1024) {
    const span = 2 ** (WORLD_LEAF_ZOOM - z);
    for (let yy = y * span; yy < (y + 1) * span; yy++)
      for (let xx = x * span; xx < (x + 1) * span; xx++) {
        const leafCount = getWorldTileCount(xx, yy, WORLD_LEAF_ZOOM, options);
        const seed = Math.imul(xx, 0x9e3779b1) ^ Math.imul(yy, 0x85ebca6b);
        for (let i = 0; i < leafCount; i++) {
          const rain = settings.profile === 'rainforest',
            scale = 0.75 + noise(seed + i, 2) * 0.5;
          const species: TreeType = rain
            ? 'oak'
            : SPECIES[Math.floor(noise(seed + i, 1) * SPECIES.length)];
          const story = noise(seed + i, 8);
          const height = rain
            ? story < 0.15
              ? 13 + noise(seed + i, 9) * 9
              : story > 0.93
                ? 38 + noise(seed + i, 9) * 12
                : 24 + noise(seed + i, 9) * 12
            : (species === 'pine'
                ? 21
                : species === 'citrus'
                  ? 5
                  : species === 'mangrove'
                    ? 10
                    : 16) * scale;
          const radius = rain
            ? story < 0.15
              ? 7 + noise(seed + i, 10) * 3
              : story > 0.93
                ? 16 + noise(seed + i, 10) * 8
                : 10 + noise(seed + i, 10) * 5
            : (species === 'banyan' ? 10 : species === 'citrus' ? 4.2 : 7) * scale;
          const shade = 0.72 + noise(seed + i, 11) * 0.35;
          trees.push({
            key: `${settings.profile}/${xx}/${yy}/${i}`,
            index: i,
            species,
            position: getWorldPosition(
              xx + noise(seed + i, 3),
              yy + noise(seed + i, 4),
              WORLD_LEAF_ZOOM
            ),
            height,
            canopyRadius: radius,
            trunkRadius: rain ? 0.2 + height * 0.007 : (species === 'citrus' ? 0.12 : 0.38) * scale,
            trunkFraction: rain ? 0.62 : 0.35,
            shade: [38 * shade, 107 * shade, 33 * shade, 255]
          });
        }
      }
  } else {
    const subdivisions = Math.min(5, WORLD_LEAF_ZOOM - z),
      n = 2 ** subdivisions;
    for (let cy = 0; cy < n; cy++)
      for (let cx = 0; cx < n; cx++) {
        const xx = x * n + cx,
          yy = y * n + cy,
          zz = z + subdivisions,
          represented = getWorldTileCount(xx, yy, zz, options);
        if (!represented) continue;
        const seed = Math.imul(xx, 0x9e3779b1) ^ Math.imul(yy, 0x85ebca6b);
        const xy = getWorldPosition(
          xx + 0.5 + (noise(seed, 3) - 0.5) * 0.3,
          yy + 0.5 + (noise(seed, 4) - 0.5) * 0.3,
          zz
        );
        const position: [number, number, number] = [
          xy[0],
          xy[1],
          settings.profile === 'rainforest' ? 18 : 0
        ];
        const west = getWorldPosition(xx, yy, zz),
          east = getWorldPosition(xx + 1, yy + 1, zz);
        const width =
            Math.abs(east[0] - west[0]) * 111320 * Math.cos((position[1] * Math.PI) / 180),
          depth = Math.abs(east[1] - west[1]) * 111320;
        const rain = settings.profile === 'rainforest',
          height = rain ? 12 + noise(seed, 2) * 6 : 12 + noise(seed, 2) * 8;
        const spread = rain ? 16 : 12;
        canopies.push({
          position,
          scale: [
            Math.min(width * 0.8, spread * Math.sqrt(represented)) * (0.85 + noise(seed, 5) * 0.3),
            Math.min(depth * 0.8, spread * Math.sqrt(represented)) * (0.85 + noise(seed, 6) * 0.3),
            height
          ],
          treeCount: represented,
          color: [35 + noise(seed, 7) * 14, 90 + noise(seed, 7) * 28, 33 + noise(seed, 7) * 12, 250]
        });
      }
  }
  return {trees, canopies, byteLength: trees.length * 256 + canopies.length * 96};
}
