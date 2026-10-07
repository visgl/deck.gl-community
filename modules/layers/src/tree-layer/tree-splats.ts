// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Quaternion, Matrix3, Vector3} from '@math.gl/core';
import {createSplatHierarchy, type SplatHierarchy} from '../splat-layer/splat-hierarchy';
import type {SplatSource} from '../splat-layer/splat-source';
import {createTreeRng, samplePineSurface, createPineTiers} from './tree-geometry';
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
  const add = (point: Point, size: Point, normal: Point, opacity = 0.86, longAxis?: Point) => {
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
    colors.push(shade, Math.min(1, shade * (0.97 + rng() * 0.08)), shade * 0.93, 1);
    opacities.push(opacity);
    normals.push(...n);
  };
  if (type === 'palm') {
    // Cubic fronds and pinnate leaflets use the native palm's botanical skeleton.
    for (let k = 0; k < 28; k++) {
      const spear = k >= 20;
      const index = spear ? k - 20 : k;
      const count = spear ? 8 : 20;
      const angle =
        ((index + (spear ? 0.5 : 0)) / count) * Math.PI * 2 +
        (spear ? 0 : Math.sin(index * 5.37) * 0.07);
      const tier = index % 4;
      const controls = spear
        ? [
            [0.025, 0.44],
            [0.12, 0.82],
            [0.38, 1.04],
            [0.62, 0.96]
          ]
        : [
            [0.035, 0.43 + tier * 0.012],
            [0.28, 0.72 - tier * 0.025],
            [0.68, 0.55 - tier * 0.045],
            [0.84 + ((index * 7) % 9) * 0.018, 0.25 - tier * 0.035]
          ];
      const evaluate = (t: number): Vector3 => {
        const u = 1 - t;
        const coefficients = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
        const radius = controls.reduce((sum, control, i) => sum + control[0] * coefficients[i], 0);
        const z = controls.reduce((sum, control, i) => sum + control[1] * coefficients[i], 0);
        return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      };
      const pairs = spear ? 8 : 11;
      for (let j = 0; j < pairs; j++) {
        const t = 0.2 + (j / (pairs - 1)) * 0.72;
        const point = evaluate(t);
        const tangent = evaluate(t + 0.001)
          .subtract(evaluate(t - 0.001))
          .normalize();
        const sideways = new Vector3(-tangent.y, tangent.x, 0).normalize();
        const fullness = Math.sin(((j + 0.75) / pairs) * Math.PI);
        for (const side of [-1, 1]) {
          const direction = new Vector3(sideways)
            .scale(side)
            .add(new Vector3(tangent).scale(0.18 + Math.sin(angle + j * 0.7) * 0.06))
            .add([0, 0, 0.12 - t * 0.2])
            .normalize();
          const normal = new Vector3(direction).cross(tangent).normalize();
          const length = 0.055 + fullness * 0.095;
          // Several elongated Gaussians keep sharp botanical tips and soft optical edges.
          for (let segment = 0; segment < 3; segment++) {
            const progress = (segment + 0.5) / 3;
            const center = new Vector3(point)
              .add(new Vector3(sideways).scale(side * 0.008))
              .add(new Vector3(direction).scale(length * progress));
            add(
              Array.from(center) as Point,
              [length / 7, ((0.007 + fullness * 0.008) * (1 - progress * 0.55)) / 2, 0.0018],
              Array.from(normal) as Point,
              0.94,
              Array.from(direction) as Point
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
    hierarchy = createSplatHierarchy(source, [0.035, 0.075, 0.16, 0.32, 0.64, 1.28, 2.56]);
    HIERARCHIES.set(source, hierarchy);
  }
  return hierarchy;
}
