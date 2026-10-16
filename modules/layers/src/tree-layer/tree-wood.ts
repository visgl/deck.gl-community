// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Vector3} from '@math.gl/core';
import {samplePineSurface, createPineTiers, type TreeMesh} from './tree-geometry';
import {evaluatePalmFrond, getPalmFronds} from './tree-palm';
import type {TreeType} from './tree-layer';
import {
  getTreeCharacteristicsKey,
  TreeTemplateCache,
  type TreeCharacteristics
} from './tree-characteristics';
import {getTreeBotany, getTreeFrames, type TreeBranch} from './tree-botany';

type Point = [number, number, number];
type Socket = {
  ring: number;
  sector: number;
  end: Point;
  radius: number;
  forks?: boolean;
  path?: Point[];
  children?: TreeBranch[];
  radii?: number[];
  rooted?: boolean;
};
const CACHE = new TreeTemplateCache<TreeMesh>(32);

/** Watertight branching tubes. Child roots reuse the actual boundary of a hole in the parent tube. */
export function getTreeWoodMesh(
  type: TreeType,
  levels = 3,
  aggregate = false,
  characteristics?: TreeCharacteristics,
  physicalMorph = false,
  trunkOnly = false
): TreeMesh {
  const key = `${type}-${type === 'pine' ? levels : 0}-${aggregate}-${physicalMorph}-${trunkOnly}-${getTreeCharacteristicsKey(characteristics)}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    textureCoordinates: number[] = [],
    indices: number[] = [];
  const segments = aggregate && (type !== 'mangrove' || trunkOnly) ? 8 : type === 'palm' ? 72 : 24;
  const pineTip = createPineTiers(levels).tipEnd[2];
  const height = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.1, 0.22];
  const palmBaseRingOffset = type === 'palm' && !aggregate ? 14 : 0;
  if (palmBaseRingOffset) {
    for (let ring = 1; ring <= palmBaseRingOffset; ring++)
      height.push(-1 + (1.22 * ring) / (palmBaseRingOffset + 1));
    height.sort((a, b) => a - b);
  }
  const broadleaf = type !== 'pine' && type !== 'palm';
  const botany = broadleaf ? getTreeBotany(type, characteristics) : null;
  const leaderTop = type === 'palm' ? 0.54 : pineTip - 0.025;
  for (let ring = 0; ring < 26; ring++) height.push(0.24 + (ring * (leaderTop - 0.24)) / 25);
  if (aggregate && !broadleaf)
    height.splice(0, height.length, -1, 0.22, 0.42, height[height.length - 1]);
  const trunkIndices =
    trunkOnly && botany
      ? Array.from({length: 5}, (_, index) => Math.round((index * (botany.stem.length - 1)) / 4))
      : null;
  const root: Point[] = botany
    ? trunkIndices
      ? trunkIndices.map(index => botany.stem[index])
      : botany.stem
    : height.map(z => [
        z > 0.22 ? Math.pow((z - 0.22) / 0.75, 2) * (type === 'palm' ? 0.02 : 0.012) : 0,
        0,
        z
      ]);
  const radius =
    trunkIndices && botany?.radii
      ? trunkIndices.map(index => botany.radii[index])
      : (botany?.radii ??
        height.map(z =>
          type === 'palm'
            ? (() => {
                const progress = Math.max(0, Math.min(1, (z + 1) / (leaderTop + 1)));
                const scar = aggregate
                  ? 0
                  : Math.pow((1 + Math.cos(progress * Math.PI * 44)) / 2, 10) * 0.008;
                return 0.074 - progress * 0.018 + scar;
              })()
            : 0.06 * (1 - (Math.max(0, z - 0.22) / 0.85) * 0.84)
        ));
  const sockets: Socket[] = [];
  if (!trunkOnly && !aggregate && type === 'palm') {
    for (const frond of getPalmFronds()) {
      const path = Array.from({length: 17}, (_, segment) =>
        evaluatePalmFrond(frond, (segment + 1) / 17)
      );
      // Parent rings start on -Y; convert the authored frond azimuth into that frame.
      const sector =
        (Math.round(((frond.angle + Math.PI / 2) / (Math.PI * 2)) * segments) + segments) %
        segments;
      sockets.push({
        ring: palmBaseRingOffset + 24 + (frond.spear ? 4 : 0) + frond.tier,
        sector,
        end: path[path.length - 1],
        radius: 0.0055,
        path
      });
    }
  } else if (!trunkOnly && !aggregate && type === 'pine') {
    for (let tier = 0; tier < levels; tier++)
      for (let branch = 0; branch < 4; branch++) {
        const angle = (branch * Math.PI) / 2 + tier * 0.57;
        const z = height[8 + tier * 5] - 0.025;
        const extent = Math.hypot(...samplePineSurface(levels, z + 0.1, angle).slice(0, 2)) * 0.75;
        sockets.push({
          ring: 8 + tier * 5,
          sector: Math.round(((angle + Math.PI / 2) / (Math.PI * 2)) * segments) % segments,
          end: [Math.cos(angle) * extent, Math.sin(angle) * extent, z + 0.1],
          radius: 0.022,
          forks: true
        });
      }
  } else if (!trunkOnly && botany) {
    const adaptBranch = (branch: TreeBranch): Socket => {
      // Aerial and stilt roots are structural wood, including in the coarse shell.
      // Keep their parent path so each root retains its authored attachment ring.
      const simplify = aggregate && !branch.rooted && !branch.children.some(child => child.rooted);
      return {
        ...branch,
        end: branch.path[branch.path.length - 1],
        path: simplify
          ? [
              branch.path[0],
              branch.path[Math.floor(branch.path.length / 2)],
              branch.path[branch.path.length - 1]
            ]
          : branch.path,
        radii: simplify
          ? [branch.radius, branch.radius * 0.5, branch.radii?.at(-1) ?? branch.radius * 0.13]
          : branch.radii,
        children: aggregate ? branch.children.filter(child => child.rooted) : branch.children
      };
    };
    sockets.push(
      ...botany.branches.map(branch => {
        const socket = adaptBranch(branch);
        if (aggregate && segments === 8) socket.sector = Math.round(socket.sector / 3) % segments;
        return socket;
      })
    );
  }
  const addVertex = (point: Vector3, trunk: boolean, shade: number, center: Point) => {
    const index = positions.length / 3;
    positions.push(...point);
    normals.push(0, 0, 0);
    // Physical wood uses this otherwise cosmetic vertex channel for its centerline.
    // This keeps the WebGPU layout within sixteen attributes. Legacy meshes retain bark colors.
    colors.push(...(physicalMorph ? center : [shade, shade, shade]));
    // UV.x enables the root collar morph, UV.y enables the trunk length morph.
    textureCoordinates.push(1, trunk ? 1 : 0);
    return index;
  };
  const tube = (
    path: Point[],
    radii: number[],
    count: number,
    children: Socket[],
    trunk: boolean,
    boundary?: number[]
  ) => {
    const rings: number[][] = [];
    const frames = getTreeFrames(path);
    for (let ring = 0; ring < path.length; ring++) {
      const {side, up} = frames[ring];
      rings.push(
        Array.from({length: count}, (_, sector) => {
          const angle = (sector / count) * Math.PI * 2;
          const point = new Vector3(path[ring])
            .add(new Vector3(side).scale(Math.cos(angle) * radii[ring]))
            .add(new Vector3(up).scale(Math.sin(angle) * radii[ring]));
          const scar =
            type === 'palm' && trunk
              ? Math.pow(
                  (1 + Math.cos(((path[ring][2] + 1) / (leaderTop + 1)) * Math.PI * 32)) / 2,
                  4
                ) * 0.3
              : 0;
          return addVertex(
            point,
            trunk,
            0.78 + Math.sin(angle * 9 + ring * 0.2) * 0.08 + (ring / path.length) * 0.09 - scar,
            path[ring]
          );
        })
      );
    }
    const holes = new Set(
      children.flatMap(socket => [
        `${socket.ring},${socket.sector}`,
        `${socket.ring},${(socket.sector + 1) % count}`
      ])
    );
    for (let ring = 0; ring < rings.length - 1; ring++)
      for (let sector = 0; sector < count; sector++) {
        if (holes.has(`${ring},${sector}`)) continue;
        const next = (sector + 1) % count;
        const [a, b, c, d] = [
          rings[ring][sector],
          rings[ring][next],
          rings[ring + 1][sector],
          rings[ring + 1][next]
        ];
        indices.push(a, b, c, b, d, c);
      }
    if (boundary) {
      // Six socket vertices transition to a twelve-sided child tube; no overlapping caps.
      for (let vertex = 0; vertex < boundary.length; vertex++) {
        const next = (vertex + 1) % boundary.length;
        indices.push(
          boundary[vertex],
          rings[0][vertex * 2 + 1],
          rings[0][vertex * 2],
          boundary[vertex],
          boundary[next],
          rings[0][vertex * 2 + 1],
          boundary[next],
          rings[0][(vertex * 2 + 2) % count],
          rings[0][vertex * 2 + 1]
        );
      }
    } else {
      const center = addVertex(new Vector3(path[0]), trunk, 0.8, path[0]);
      for (let sector = 0; sector < count; sector++)
        indices.push(center, rings[0][(sector + 1) % count], rings[0][sector]);
    }
    const cap = addVertex(new Vector3(path[path.length - 1]), trunk, 0.88, path[path.length - 1]);
    for (let sector = 0; sector < count; sector++)
      indices.push(
        cap,
        rings[rings.length - 1][sector],
        rings[rings.length - 1][(sector + 1) % count]
      );
    for (const socket of children) {
      const ring = socket.ring,
        a = socket.sector,
        b = (a + 1) % count,
        c = (a + 2) % count;
      const perimeter = [
        rings[ring][a],
        rings[ring][b],
        rings[ring][c],
        rings[ring + 1][c],
        rings[ring + 1][b],
        rings[ring + 1][a]
      ];
      const start = new Vector3();
      for (const vertex of perimeter) start.add(positions.slice(vertex * 3, vertex * 3 + 3));
      start.scale(1 / perimeter.length);
      const end = new Vector3(socket.end);
      const direction = new Vector3(end).subtract(start).normalize();
      const childPath =
        socket.path ??
        Array.from({length: aggregate ? 3 : 9}, (_, index) => {
          const t = 0.045 + (index / (aggregate ? 2 : 8)) * 0.955;
          const point = new Vector3(start).lerp(end, t);
          point.z += Math.sin(t * Math.PI) * 0.045;
          return Array.from(point) as Point;
        });
      const childRadius =
        socket.radii ??
        childPath.map((_, index) => socket.radius * (1 - (index / (childPath.length - 1)) * 0.87));
      const forks: Socket[] = socket.children
        ? socket.children.map(branch => ({...branch, end: branch.path[branch.path.length - 1]}))
        : socket.forks
          ? [1, -1].map((side, index) => ({
              ring: 4 + index * 2,
              sector: side === 1 ? 0 : 6,
              radius: socket.radius * 0.4,
              end: [
                end.x + side * 0.085,
                end.y + side * 0.05,
                Math.min(type === 'pine' ? pineTip - 0.08 : 0.95, end.z + 0.12)
              ],
              forks: false
            }))
          : [];
      // Match the child frame's first vertex to the socket perimeter to avoid twisted junctions.
      const childSide = new Vector3(Math.abs(direction.z) > 0.95 ? [1, 0, 0] : [0, 0, 1])
        .cross(direction)
        .normalize();
      let first = 0,
        best = -Infinity;
      for (let i = 0; i < perimeter.length; i++) {
        const alignment = new Vector3(positions.slice(perimeter[i] * 3, perimeter[i] * 3 + 3))
          .subtract(start)
          .dot(childSide);
        if (alignment > best) {
          best = alignment;
          first = i;
        }
      }
      const ordered = [...perimeter.slice(first), ...perimeter.slice(0, first)];
      tube(childPath, childRadius, 12, forks, socket.rooted ?? false, ordered);
    }
  };
  tube(root, radius, segments, sockets, true);
  if (type === 'pine') {
    // Keep the woody shoot inside the same whorl envelope as the needle source.
    const skeleton = createPineTiers(levels);
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      const z = positions[vertex + 2];
      if (z <= 0.22) continue;
      const angle = Math.atan2(positions[vertex + 1], positions[vertex]);
      const crown = samplePineSurface(levels, z, angle);
      const tipRadius =
        z >= skeleton.tipStart[2]
          ? Math.max(0, (skeleton.tipEnd[2] - z) / (skeleton.tipEnd[2] - skeleton.tipStart[2])) *
            0.045
          : 0;
      const limit = Math.max(Math.hypot(crown[0], crown[1]) * 0.85, tipRadius, 0.002);
      const radius = Math.hypot(positions[vertex], positions[vertex + 1]);
      if (radius > limit) {
        positions[vertex] *= limit / radius;
        positions[vertex + 1] *= limit / radius;
      }
    }
  }
  for (let face = 0; face < indices.length; face += 3) {
    const [a, b, c] = indices.slice(face, face + 3);
    const normal = new Vector3(positions.slice(b * 3, b * 3 + 3))
      .subtract(positions.slice(a * 3, a * 3 + 3))
      .cross(
        new Vector3(positions.slice(c * 3, c * 3 + 3)).subtract(positions.slice(a * 3, a * 3 + 3))
      );
    for (const vertex of [a, b, c])
      for (let axis = 0; axis < 3; axis++) normals[vertex * 3 + axis] += normal[axis];
  }
  for (let vertex = 0; vertex < normals.length; vertex += 3) {
    const length = Math.hypot(...normals.slice(vertex, vertex + 3));
    if (length > 0) for (let axis = 0; axis < 3; axis++) normals[vertex + axis] /= length;
  }
  const mesh: TreeMesh = {
    attributes: {
      POSITION: {value: new Float32Array(positions), size: 3},
      NORMAL: {value: new Float32Array(normals), size: 3},
      COLOR_0: {value: new Float32Array(colors), size: 3},
      TEXCOORD_0: {value: new Float32Array(textureCoordinates), size: 2}
    },
    indices: {value: new Uint32Array(indices), size: 1},
    topology: 'triangle-list',
    mode: 4
  };
  CACHE.set(key, mesh);
  return mesh;
}
