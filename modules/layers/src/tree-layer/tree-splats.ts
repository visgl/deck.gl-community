// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Quaternion, Matrix3, Vector3} from '@math.gl/core';
import {createSplatHierarchy, type SplatHierarchy} from '../splat-layer/splat-hierarchy';
import type {SplatSource} from '../splat-layer/splat-source';
import type {PreparedSplatData} from '../splat-layer/splat-input';
import {createTreeRng, samplePineSurface, createPineTiers} from './tree-geometry';
import {evaluatePalmFrond, getPalmFronds} from './tree-palm';
import type {TreeType} from './tree-layer';
import {getTreeBotany} from './tree-botany';
import {
  resolveTreeCharacteristics,
  getTreeCharacteristicsKey,
  TreeTemplateCache,
  type TreeCharacteristics
} from './tree-characteristics';

type Point = [number, number, number];
const CACHE = new TreeTemplateCache<SplatSource>();
const PALM_LEAFLET_COUNT = 16;

/** Return nominal leaflet anchors along the rachis without extrapolating past its tip. */
export function getPalmFrondLeafletT(index: number): number {
  return 0.15 + (index / (PALM_LEAFLET_COUNT - 1)) * 0.71;
}

/** Procedural leaf clusters, not sampled opaque crown triangles. Templates are shared by species/tier. */
export function getTreeSplatSource(
  type: TreeType,
  levels = 3,
  characteristics?: TreeCharacteristics
): SplatSource {
  const traits = resolveTreeCharacteristics(characteristics);
  const key = `${type}-${type === 'pine' ? levels : 0}-${getTreeCharacteristicsKey(traits)}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const rng = createTreeRng(
    type.split('').reduce((seed, letter) => seed * 31 + letter.charCodeAt(0), levels) >>> 0
  );
  const positions: number[] = [];
  const scales: number[] = [];
  const rotations: number[] = [];
  const colors: number[] = [];
  const opacities: number[] = [];
  const normals: number[] = [];
  const add = (
    point: Point,
    size: Point,
    normal: Point,
    opacity = 0.86,
    longAxis?: Point,
    tint?: Point
  ) => {
    const n = new Vector3(normal).normalize();
    const tangent = longAxis
      ? new Vector3(longAxis).normalize()
      : new Vector3(Math.abs(n.z) < 0.9 ? [0, 0, 1] : [1, 0, 0]).cross(n).normalize();
    const side = new Vector3(n).cross(tangent).normalize();
    const q = new Quaternion().fromMatrix3(new Matrix3([...tangent, ...side, ...n]));
    positions.push(...point);
    scales.push(...size);
    rotations.push(q[3], q[0], q[1], q[2]);
    const shade = 0.64 + rng() * 0.32;
    colors.push(
      shade * (tint?.[0] ?? 1),
      Math.min(1, shade * (0.97 + rng() * 0.08)) * (tint?.[1] ?? 1),
      shade * 0.93 * (tint?.[2] ?? 1),
      1
    );
    opacities.push(opacity);
    normals.push(...n);
  };
  if (type === 'palm') {
    for (const frond of getPalmFronds()) {
      const {spear} = frond;
      const evaluate = (t: number) => new Vector3(evaluatePalmFrond(frond, t));
      if (spear) {
        for (let j = 0; j < 7; j++) {
          const t = 0.2 + (j / 6) * 0.74;
          const point = evaluate(t);
          const tangent = evaluate(t + 0.001)
            .subtract(evaluate(t - 0.001))
            .normalize();
          const sideways = new Vector3(-tangent.y, tangent.x, 0).normalize();
          const fullness = Math.sin(((j + 0.5) / 7) * Math.PI);
          const normal = new Vector3(tangent).cross(sideways).normalize();
          add(
            Array.from(point) as Point,
            [0.042 + fullness * 0.028, 0.008 + fullness * 0.01, 0.002],
            Array.from(normal) as Point,
            0.82,
            Array.from(tangent) as Point,
            [0.9, 1.04, 0.86]
          );
        }
        continue;
      }

      const pairs = PALM_LEAFLET_COUNT;
      for (let j = 0; j < pairs; j++) {
        const t = getPalmFrondLeafletT(j);
        const fullness = Math.sin(((j + 0.5) / pairs) * Math.PI);
        for (const side of [-1, 1]) {
          // Stagger opposing leaflets along the rachis rather than lining them up as rungs.
          const leafT = Math.max(0.02, Math.min(0.98, t + side * 0.018 + (rng() - 0.5) * 0.05));
          const point = evaluate(leafT);
          const tangent = evaluate(leafT + 0.001)
            .subtract(evaluate(leafT - 0.001))
            .normalize();
          const sideways = new Vector3(-tangent.y, tangent.x, 0).normalize();
          const direction = new Vector3(sideways)
            .scale(side)
            .add(
              new Vector3(tangent).scale(0.1 + leafT * 0.22 + side * 0.04 + (rng() - 0.5) * 0.18)
            )
            .add([0, 0, -0.06 - leafT * 0.22 - rng() * 0.12])
            .normalize();
          const normal = new Vector3(direction).cross(tangent).normalize();
          const length = (0.1 + fullness * 0.17) * (0.82 + rng() * 0.36) * (side < 0 ? 0.92 : 1.08);
          for (const [progress, widthScale] of [
            [0.28, 1],
            [0.68, 0.62]
          ]) {
            const center = new Vector3(point)
              .add(new Vector3(sideways).scale(side * 0.012))
              .add(new Vector3(direction).scale(length * progress));
            add(
              Array.from(center) as Point,
              [length * 0.42 * widthScale, (0.005 + fullness * 0.01) * widthScale, 0.0025],
              Array.from(normal) as Point,
              progress < 0.5 ? 0.68 : 0.56,
              Array.from(direction) as Point,
              [0.91, 1.04, 0.88]
            );
          }
        }
      }
    }
  } else if (type === 'pine') {
    // Area-weighted placement keeps wide lower whorls as dense as the apex.
    for (let i = 0; i < 8192; i++) {
      const z = rng() * 1.04;
      const theta = rng() * Math.PI * 2;
      const outer = samplePineSurface(levels, z, theta);
      if (rng() * 0.75 > Math.hypot(outer[0], outer[1]) ** 2) {
        i--;
        continue;
      }
      const radial = Math.sqrt(rng()) * 0.94;
      const point: Point = [outer[0] * radial, outer[1] * radial, z];
      add(point, [0.02, 0.009, 0.003], [Math.cos(theta), Math.sin(theta), 0.5 + rng() * 0.5], 0.9);
    }
    const {tipStart, tipEnd} = createPineTiers(levels);
    for (let i = 0; i < 384; i++) {
      const t = rng();
      const radius = (1 - t) * 0.06;
      const theta = rng() * Math.PI * 2;
      add(
        [
          Math.cos(theta) * radius,
          Math.sin(theta) * radius,
          tipStart[2] + (tipEnd[2] - tipStart[2]) * t
        ],
        [0.013, 0.006, 0.002],
        [Math.cos(theta), Math.sin(theta), 0.6],
        0.9
      );
    }
  } else {
    const clusters = getTreeBotany(type, traits).clusters;
    // Allocate by leaf-bearing volume, so tiny terminal shoots do not steal density
    // from the large clusters surrounding primary and secondary branches.
    const weights = clusters.map(cluster =>
      cluster.radius.reduce((volume, value) => volume * value, 1)
    );
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let clusterIndex = 0,
      cumulativeWeight = weights[0];
    const leafCount = Math.round(12288 * traits.leafDensity);
    for (let i = 0; i < leafCount; i++) {
      const target = ((i + 0.5) / leafCount) * totalWeight;
      while (target > cumulativeWeight && clusterIndex < clusters.length - 1)
        cumulativeWeight += weights[++clusterIndex];
      const cluster = clusters[clusterIndex];
      const z = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const radial = Math.cbrt(rng()) * 0.94;
      const direction: Point = [
        Math.sqrt(1 - z * z) * Math.cos(theta),
        Math.sqrt(1 - z * z) * Math.sin(theta),
        z
      ];
      const point = cluster.center.map(
        (center, axis) => center + direction[axis] * radial * cluster.radius[axis]
      ) as Point;
      // Leaf-plane normals vary independently within an outward biased distribution.
      const normal = direction.map(
        (value, axis) =>
          value * 0.35 + cluster.shoot[axis] * 0.25 + (rng() - 0.5) * 0.8 + (axis === 2 ? 0.65 : 0)
      ) as Point;
      // Red mangrove has large opposite leathery elliptical leaves; banyan has
      // broad ovate leaves. Lengths are local one-sigma values, not botanical measurements.
      const largeLeaf = type === 'mangrove' || type === 'banyan';
      const size = (largeLeaf ? 0.011 + rng() * 0.008 : 0.007 + rng() * 0.005) * traits.leafSize;
      add(
        point,
        [size, size * (type === 'mangrove' || type === 'citrus' ? 0.38 : 0.55), size * 0.08],
        normal
      );
    }
  }
  const source: SplatSource = {
    positions: new Float32Array(positions),
    scales: new Float32Array(scales),
    rotations: new Float32Array(rotations),
    colors: new Float32Array(colors),
    opacities: new Float32Array(opacities),
    normals: new Float32Array(normals)
  };
  CACHE.set(key, source);
  return source;
}

const HIERARCHIES = new WeakMap<SplatSource, SplatHierarchy>();
/** Full leaf templates with progressively merged covariance moments for subpixel crowns. */
export function getTreeSplatHierarchy(
  type: TreeType,
  levels = 3,
  characteristics?: TreeCharacteristics
): SplatHierarchy {
  const source = getTreeSplatSource(type, levels, characteristics);
  let hierarchy = HIERARCHIES.get(source);
  if (!hierarchy) {
    const cellSizes =
      type === 'palm' ? [0.12, 0.5, 3.2] : [0.035, 0.075, 0.16, 0.32, 0.64, 1.28, 2.56];
    hierarchy = createSplatHierarchy(source, cellSizes);
    HIERARCHIES.set(source, hierarchy);
  }
  return hierarchy;
}

const ASSETS = new WeakMap<SplatSource, PreparedSplatData>();
/** Reusable prepared canopy asset including its source-local refinement hierarchy. */
export function getTreeSplatData(
  type: TreeType,
  levels: number,
  characteristics: TreeCharacteristics
): PreparedSplatData {
  const source = getTreeSplatSource(type, levels, characteristics);
  let asset = ASSETS.get(source);
  if (!asset) {
    asset = {
      type: 'prepared-splats',
      source,
      hierarchy: getTreeSplatHierarchy(type, levels, characteristics)
    };
    ASSETS.set(source, asset);
  }
  return asset;
}
