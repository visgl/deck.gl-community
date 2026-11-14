// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_CROP_RANK_LEVELS,
  type TreeGrowthModel
} from './tree-photoreal-layout';

/** Crop geometry; `CropConfig.radius` bounds every shape, and attached crops vary below it. */
export type CropKind = 'fruit' | 'lemon' | 'cone' | 'acorn' | 'catkin' | 'flower' | 'propagule';

/** What a vertex of a photoreal crop mesh belongs to. The shaders move and shade each differently. */
export const TREE_CROP_PART = {
  /** Fruit, nut, cone: the part that scales with `radius`. */
  BODY: 0,
  /** Sepals on top of a fruit. */
  CALYX: 1,
  /** From the top of the body to the twig. `z` is 0 at the body and 1 at the twig. */
  STEM: 2,
  /** `x` along the petal 0-1, `y` across it in radii, `z` which petal. */
  PETAL: 3,
  FILAMENT: 4,
  ANTHER: 5,
  PISTIL: 6,
  /** The green cup under a blossom. */
  RECEPTACLE: 7,
  /** From a blossom to the twig, as `STEM`. */
  STALK: 8,
  /** The soft dark patch under a crop on the ground, which a shadow map is far too coarse to give. */
  CONTACT: 9
} as const;

/** Floats per vertex of a crop mesh: position xyz, normal xyz, part, and `along` for the part. */
export const TREE_CROP_VERTEX_STRIDE = 8;

/**
 * Mesh levels: as much as a crop filling the screen can show; a mesh for a crop tens of pixels across; a
 * point shaded by the pixel, for one a few pixels across; and a point lit once, for smaller ones.
 */
export type TreeCropMeshLevel = 0 | 1 | 2 | 3;

/** Blossoms that share a twig attachment. Other crops hang alone. */
export const TREE_CROP_FLOWER_CLUSTER = 5;

/** Instanced geometry of one crop kind at one mesh level, in units of the crop's radius. */
export type TreeCropGeometry = {
  /** `TREE_CROP_VERTEX_STRIDE` floats per vertex. */
  vertices: Float32Array;
  /** The triangles a view draws, followed by those the shadow pass draws. */
  indices: Uint32Array;
  vertexCount: number;
  /** Indices a view draws, from the start. */
  indexCount: number;
  /** Of those, how many are the crop itself: the others wait for it to fall, or for the crop to have one. */
  bodyIndexCount: number;
  /** Indices of the shadow pass, which light sees at a map's texels, from `indexCount`. */
  shadowIndexCount: number;
  /** Height of the top of the body above its center, where the stem meets it. */
  top: number;
  /** Height of the center above the ground when the crop lies on its side. */
  restHeight: number;
  /** Length of the stem or stalk. */
  stem: number;
};

type CropVertex = [number, number, number];

/** A surface in a mesh, as `addSurface` laid it out. */
type CropSurface = {
  top: number;
  bottom: number;
  rings: number;
  sides: number;
  ringStart: (ring: number) => number;
};

class CropMeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  parts: number[] = [];
  alongs: number[] = [];
  indices: number[] = [];
  shadowIndices: number[] = [];
  /** Indices of what draws while nothing has fallen, when that is not all of them. */
  bodyIndexCount: number | null = null;

  get vertexCount(): number {
    return this.parts.length;
  }

  add(position: CropVertex, normal: CropVertex, part: number, along = 0): number {
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.parts.push(part);
    this.alongs.push(along);
    return this.parts.length - 1;
  }

  /**
   * A closed surface of revolution or something like it. `point(u, angle)` runs from the top pole at u 0
   * to the bottom pole at u 1. Normals come from its faces, smooth over every shared vertex.
   */
  addSurface(
    rings: number,
    sides: number,
    point: (u: number, angle: number) => CropVertex,
    part: number,
    along: (u: number, angle: number) => number = () => 0
  ): CropSurface {
    const first = this.vertexCount;
    const firstIndex = this.indices.length;
    const top = this.add(point(0, 0), [0, 0, 0], part, along(0, 0));
    const ringStart = (ring: number) => first + 1 + (ring - 1) * sides;
    for (let ring = 1; ring < rings; ring++) {
      for (let side = 0; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        this.add(point(ring / rings, angle), [0, 0, 0], part, along(ring / rings, angle));
      }
    }
    const bottom = this.add(point(1, 0), [0, 0, 0], part, along(1, 0));
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      this.indices.push(top, ringStart(1) + side, ringStart(1) + next);
      for (let ring = 1; ring + 1 < rings; ring++) {
        const a = ringStart(ring) + side;
        const b = ringStart(ring) + next;
        const c = ringStart(ring + 1) + side;
        const d = ringStart(ring + 1) + next;
        this.indices.push(a, c, d, a, d, b);
      }
      this.indices.push(ringStart(rings - 1) + side, bottom, ringStart(rings - 1) + next);
    }
    this.smoothNormals(first, firstIndex);
    return {top, bottom, rings, sides, ringStart};
  }

  /** The shadow pass's triangles of a surface: every few of its rings and sides. */
  addShadowSurface(surface: CropSurface, ringStep: number, sideStep: number): void {
    const {top, bottom, rings, sides, ringStart} = surface;
    const rows: number[] = [];
    for (let ring = ringStep; ring < rings; ring += ringStep) rows.push(ring);
    const columns: number[] = [];
    for (let side = 0; side < sides; side += sideStep) columns.push(side);
    columns.forEach((side, column) => {
      const next = columns[(column + 1) % columns.length];
      this.shadowIndices.push(top, ringStart(rows[0]) + side, ringStart(rows[0]) + next);
      for (let row = 0; row + 1 < rows.length; row++) {
        const a = ringStart(rows[row]) + side;
        const b = ringStart(rows[row]) + next;
        const c = ringStart(rows[row + 1]) + side;
        const d = ringStart(rows[row + 1]) + next;
        this.shadowIndices.push(a, c, d, a, d, b);
      }
      const last = ringStart(rows[rows.length - 1]);
      this.shadowIndices.push(last + side, bottom, last + next);
    });
  }

  /** A tapered tube along z, closed at the far end: rings of `[z, radius]`. */
  addTube(
    sides: number,
    rings: readonly (readonly [number, number])[],
    part: number,
    transform: (point: CropVertex) => CropVertex = point => point,
    along: (z: number) => number = z => z
  ): void {
    const first = this.vertexCount;
    const firstIndex = this.indices.length;
    for (const [z, radius] of rings) {
      for (let side = 0; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        this.add(
          transform([Math.cos(angle) * radius, Math.sin(angle) * radius, z]),
          [0, 0, 0],
          part,
          along(z)
        );
      }
    }
    for (let ring = 0; ring + 1 < rings.length; ring++) {
      for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        const a = first + ring * sides + side;
        const b = first + ring * sides + next;
        const c = first + (ring + 1) * sides + side;
        const d = first + (ring + 1) * sides + next;
        this.indices.push(a, b, d, a, d, c);
      }
    }
    const last = first + (rings.length - 1) * sides;
    const tipZ = rings[rings.length - 1][0];
    const tip = this.add(transform([0, 0, tipZ]), [0, 0, 0], part, along(tipZ));
    for (let side = 0; side < sides; side++)
      this.indices.push(last + side, last + ((side + 1) % sides), tip);
    this.smoothNormals(first, firstIndex);
  }

  /** Face normals, summed by area, for the vertices from `first` and the triangles from `firstIndex`. */
  smoothNormals(first: number, firstIndex: number): void {
    const {positions: p, normals: n, indices} = this;
    for (let i = firstIndex; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a];
      const vy = p[c + 1] - p[a + 1];
      const vz = p[c + 2] - p[a + 2];
      const x = uy * vz - uz * vy;
      const y = uz * vx - ux * vz;
      const z = ux * vy - uy * vx;
      for (const offset of [a, b, c]) {
        n[offset] += x;
        n[offset + 1] += y;
        n[offset + 2] += z;
      }
    }
    for (let vertex = first; vertex < this.vertexCount; vertex++) {
      const offset = vertex * 3;
      const length = Math.hypot(n[offset], n[offset + 1], n[offset + 2]);
      if (length > 1e-12) {
        n[offset] /= length;
        n[offset + 1] /= length;
        n[offset + 2] /= length;
      } else {
        n[offset + 2] = 1;
      }
    }
  }

  build(fields: Pick<TreeCropGeometry, 'top' | 'restHeight' | 'stem'>): TreeCropGeometry {
    const {vertexCount, indices, shadowIndices} = this;
    const vertices = new Float32Array(vertexCount * TREE_CROP_VERTEX_STRIDE);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const out = vertex * TREE_CROP_VERTEX_STRIDE;
      for (let axis = 0; axis < 3; axis++) {
        vertices[out + axis] = this.positions[vertex * 3 + axis];
        vertices[out + 3 + axis] = this.normals[vertex * 3 + axis];
      }
      vertices[out + 6] = this.parts[vertex];
      vertices[out + 7] = this.alongs[vertex];
    }
    return {
      ...fields,
      vertices,
      indices: Uint32Array.from([...indices, ...shadowIndices]),
      vertexCount,
      indexCount: indices.length,
      bodyIndexCount: this.bodyIndexCount ?? indices.length,
      shadowIndexCount: shadowIndices.length
    };
  }
}

/** A closed outline of revolution from the top pole, as radius and height. */
type CropProfile = (polar: number) => [number, number];

// A citrus fruit, a little flatter than a ball. Toward the stem its shoulders draw up into a slight neck, with a
// small seat for the button in the middle of it. At the blossom end, a shallow navel with a lip.
const FRUIT_PROFILE: CropProfile = polar => {
  const rho = Math.sin(polar) * (1 + 0.018 * Math.cos(polar));
  const z = Math.cos(polar) * 0.94;
  if (polar < Math.PI / 2) {
    const neck = 0.046 * Math.exp(-((rho / 0.115) ** 2));
    const seat = 0.024 * Math.exp(-((rho / 0.06) ** 2));
    // Just outside the neck the shoulders dip a little, which is what makes it a neck and not a cone.
    const dip = 0.014 * Math.exp(-(((rho - 0.25) / 0.13) ** 2));
    return [rho, z + neck - seat - dip];
  }
  const navel = 0.034 * Math.exp(-((rho / 0.052) ** 2));
  const lip = 0.007 * Math.exp(-(((rho - 0.1) / 0.04) ** 2));
  return [rho, z + navel - lip];
};

// Narrower and longer, with a nipple at the blossom end and a short neck at the stem.
const LEMON_PROFILE: CropProfile = polar => {
  const away = Math.PI - polar;
  const rho = 0.7 * Math.sin(polar) * (1 + 0.04 * Math.cos(polar));
  const z =
    Math.cos(polar) * 0.87 -
    0.13 * Math.exp(-((away / 0.28) ** 2)) +
    0.05 * Math.exp(-((polar / 0.25) ** 2));
  return [rho, z];
};

/** How far the rings of a revolved body move toward its poles, in radians at most. */
const PROFILE_POLE_GATHER = 0.32;

// Height of the outline at a radius, on its upper side.
function getProfileHeight(profile: CropProfile, rho: number): number {
  let low = 0;
  let high = Math.PI / 2;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (profile(middle)[0] < rho) low = middle;
    else high = middle;
  }
  return profile(low)[1];
}

function addRevolved(
  builder: CropMeshBuilder,
  profile: CropProfile,
  rings: number,
  sides: number
): CropSurface {
  return builder.addSurface(
    rings,
    sides,
    (u, angle) => {
      // Rings gather toward the poles, where a neck and a navel are all the detail there is.
      const [rho, z] = profile(u * Math.PI - PROFILE_POLE_GATHER * Math.sin(u * Math.PI * 2));
      return [Math.cos(angle) * rho, Math.sin(angle) * rho, z];
    },
    TREE_CROP_PART.BODY
  );
}

/** Sepals on the top of a fruit: a five-pointed star that follows the rind, with a raised center. */
function addCalyx(builder: CropMeshBuilder, profile: CropProfile, fine: boolean): void {
  const first = builder.vertexCount;
  const firstIndex = builder.indices.length;
  const steps = fine ? 20 : 10;
  const lift = 0.014;
  const center = builder.add(
    [0, 0, getProfileHeight(profile, 0.001) + lift * 2.2],
    [0, 0, 0],
    TREE_CROP_PART.CALYX,
    0
  );
  const star = (angle: number) => {
    const lobe = Math.max(0, Math.cos(angle * 5));
    return 0.1 + 0.095 * lobe ** 0.7;
  };
  const rings = fine ? [0.55, 1] : [1];
  rings.forEach(scale => {
    for (let step = 0; step < steps; step++) {
      const angle = (step / steps) * Math.PI * 2 + 0.3;
      const rho = star(angle) * scale;
      builder.add(
        [
          Math.cos(angle) * rho,
          Math.sin(angle) * rho,
          getProfileHeight(profile, rho) + lift * (scale < 1 ? 1.2 : 0.5)
        ],
        [0, 0, 0],
        TREE_CROP_PART.CALYX,
        scale
      );
    }
  });
  const ring = (index: number, step: number) =>
    first + 1 + index * steps + ((step + steps) % steps);
  for (let step = 0; step < steps; step++) {
    builder.indices.push(center, ring(0, step), ring(0, step + 1));
    if (fine) {
      builder.indices.push(
        ring(0, step),
        ring(1, step),
        ring(1, step + 1),
        ring(0, step),
        ring(1, step + 1),
        ring(0, step + 1)
      );
    }
  }
  builder.smoothNormals(first, firstIndex);
}

/** A stem, from the body at z 0 to the twig at z 1. The shaders bend it. */
function addStem(builder: CropMeshBuilder, fine: boolean, scale = 1): void {
  // A woody pedicel: flared where it takes the button, thin along its length, and thick at the node it
  // grows from, which is where a fruit lets go.
  const rings: [number, number][] = fine
    ? [
        [0, 0.092 * scale],
        [0.04, 0.066 * scale],
        [0.1, 0.05 * scale],
        [0.2, 0.044 * scale],
        [0.32, 0.042 * scale],
        [0.46, 0.042 * scale],
        [0.6, 0.044 * scale],
        [0.72, 0.047 * scale],
        [0.82, 0.052 * scale],
        [0.9, 0.062 * scale],
        [0.96, 0.072 * scale],
        [1, 0.08 * scale]
      ]
    : [
        [0, 0.08 * scale],
        [0.12, 0.05 * scale],
        [0.4, 0.044 * scale],
        [0.72, 0.048 * scale],
        [0.92, 0.062 * scale],
        [1, 0.076 * scale]
      ];
  builder.addTube(fine ? 8 : 4, rings, TREE_CROP_PART.STEM);
}

/** Petal outline: distance along it and half width, in radii. Citrus: long ovals, widest past the middle. */
const PETAL_STATIONS_FINE: readonly (readonly [number, number])[] = [
  [0, 0.05],
  [0.08, 0.1],
  [0.22, 0.17],
  [0.4, 0.225],
  [0.58, 0.24],
  [0.74, 0.215],
  [0.87, 0.16],
  [0.96, 0.08]
];
const PETAL_STATIONS_MID: readonly (readonly [number, number])[] = [
  [0.2, 0.15],
  [0.55, 0.24],
  [0.85, 0.17]
];
const FLOWER_PETALS = 5;

function addFinePetal(builder: CropMeshBuilder, petal: number): void {
  const first = builder.vertexCount;
  const columns = [-1, 0, 1];
  for (const [t, half] of PETAL_STATIONS_FINE) {
    for (const u of columns) builder.add([t, u * half, petal], [0, 0, 1], TREE_CROP_PART.PETAL, u);
  }
  const tip = builder.add([1, 0, petal], [0, 0, 1], TREE_CROP_PART.PETAL, 0);
  const at = (station: number, column: number) => first + station * 3 + column;
  for (let station = 0; station + 1 < PETAL_STATIONS_FINE.length; station++) {
    for (let column = 0; column < 2; column++) {
      builder.indices.push(
        at(station, column),
        at(station + 1, column),
        at(station + 1, column + 1),
        at(station, column),
        at(station + 1, column + 1),
        at(station, column + 1)
      );
    }
  }
  const last = PETAL_STATIONS_FINE.length - 1;
  builder.indices.push(at(last, 0), tip, at(last, 1), at(last, 1), tip, at(last, 2));
}

/** Eight corners and six triangles, the outline of a petal. */
function addMidPetal(builder: CropMeshBuilder, petal: number): void {
  const base = builder.add([0, 0, petal], [0, 0, 1], TREE_CROP_PART.PETAL, 0);
  let left = base;
  let right = base;
  PETAL_STATIONS_MID.forEach(([t, half], station) => {
    const nextLeft = builder.add([t, -half, petal], [0, 0, 1], TREE_CROP_PART.PETAL, -1);
    const nextRight = builder.add([t, half, petal], [0, 0, 1], TREE_CROP_PART.PETAL, 1);
    if (station === 0) {
      builder.indices.push(base, nextLeft, nextRight);
    } else {
      builder.indices.push(left, nextLeft, nextRight, left, nextRight, right);
    }
    left = nextLeft;
    right = nextRight;
  });
  const tip = builder.add([1, 0, petal], [0, 0, 1], TREE_CROP_PART.PETAL, 0);
  builder.indices.push(left, tip, right);
}

/** Yellow-tipped stamens around a pale pistil, in a green cup, and a stalk back to the twig. */
function addFlowerCenter(builder: CropMeshBuilder): void {
  const stamens = 10;
  for (let stamen = 0; stamen < stamens; stamen++) {
    const angle = (stamen / stamens) * Math.PI * 2 + (stamen % 2) * 0.18;
    const height = 0.38 + ((stamen * 7) % 5) * 0.022;
    const from: CropVertex = [Math.cos(angle) * 0.075, Math.sin(angle) * 0.075, 0.03];
    const to: CropVertex = [Math.cos(angle) * 0.135, Math.sin(angle) * 0.135, height];
    builder.addTube(
      3,
      [
        [0, 0.013],
        [1, 0.009]
      ],
      TREE_CROP_PART.FILAMENT,
      ([x, y, z]) => [
        from[0] + (to[0] - from[0]) * z + x,
        from[1] + (to[1] - from[1]) * z + y,
        from[2] + (to[2] - from[2]) * z
      ]
    );
    builder.addSurface(
      3,
      4,
      (u, side) => {
        const polar = u * Math.PI;
        const rho = Math.sin(polar) * 0.026;
        return [
          to[0] + Math.cos(side + angle) * rho,
          to[1] + Math.sin(side + angle) * rho,
          to[2] + 0.018 + Math.cos(polar) * 0.04
        ];
      },
      TREE_CROP_PART.ANTHER
    );
  }
  builder.addTube(
    6,
    [
      [0.03, 0.04],
      [0.3, 0.028],
      [0.46, 0.03]
    ],
    TREE_CROP_PART.PISTIL,
    point => point,
    z => z
  );
  builder.addSurface(
    4,
    6,
    (u, side) => {
      const polar = u * Math.PI;
      const rho = Math.sin(polar) * 0.058;
      return [Math.cos(side) * rho, Math.sin(side) * rho, 0.5 + Math.cos(polar) * 0.05];
    },
    TREE_CROP_PART.PISTIL,
    () => 1
  );
  // The cup: flat under the stamens, closed below.
  builder.addSurface(
    6,
    8,
    (u, side) => {
      const rim = Math.min(1, u / 0.4);
      const polar = Math.PI / 2 + (Math.max(0, u - 0.4) / 0.6) * (Math.PI / 2);
      const rho = rim * Math.sin(polar) * (0.13 + 0.01 * Math.cos(side * 5));
      return [
        Math.cos(side) * rho,
        Math.sin(side) * rho,
        0.03 * (1 - rim) + Math.cos(polar) * 0.12
      ];
    },
    TREE_CROP_PART.RECEPTACLE
  );
  builder.addTube(
    4,
    [
      [0, 0.038],
      [1, 0.03]
    ],
    TREE_CROP_PART.STALK
  );
}

function createFlowerGeometry(level: TreeCropMeshLevel): TreeCropGeometry {
  const builder = new CropMeshBuilder();
  if (level >= 2) {
    // A point for the blossom, and one for each petal that falls: the shaders hide those until then.
    for (let petal = 0; petal < FLOWER_PETALS; petal++) {
      builder.add([0, 0, 0], [0, 0, 1], TREE_CROP_PART.PETAL, petal);
      builder.indices.push(petal);
    }
    builder.bodyIndexCount = 1;
  } else {
    for (let petal = 0; petal < FLOWER_PETALS; petal++) {
      if (level === 0) addFinePetal(builder, petal);
      else addMidPetal(builder, petal);
    }
    if (level === 0) {
      // Light need not see the stamens. These are the only triangles the shadow pass draws twice over.
      builder.shadowIndices.push(...builder.indices);
      addFlowerCenter(builder);
    } else {
      // A tuft of stamens.
      const first = builder.vertexCount;
      const firstIndex = builder.indices.length;
      const tip = builder.add([0, 0, 0.42], [0, 0, 1], TREE_CROP_PART.ANTHER);
      for (let side = 0; side < 3; side++) {
        const angle = (side / 3) * Math.PI * 2;
        builder.add(
          [Math.cos(angle) * 0.16, Math.sin(angle) * 0.16, 0.08],
          [0, 0, 0],
          TREE_CROP_PART.ANTHER
        );
      }
      builder.indices.push(
        tip,
        first + 1,
        first + 2,
        tip,
        first + 2,
        first + 3,
        tip,
        first + 3,
        first + 1
      );
      builder.smoothNormals(first, firstIndex);
    }
  }
  return builder.build({top: 0, restHeight: 0, stem: 0.95});
}

/** The profile and proportions of a hanging crop. */
function createHangingGeometry(kind: CropKind, level: TreeCropMeshLevel): TreeCropGeometry {
  const builder = new CropMeshBuilder();
  const rich = level === 0;
  const detail = rich ? 1 : 0.55;
  const count = (value: number) => Math.max(3, Math.round(value * detail));
  const finish = (fields: Pick<TreeCropGeometry, 'top' | 'restHeight' | 'stem'>) => {
    if (level >= 2) {
      // A point for the crop, and one for what lies under it once it has fallen.
      builder.positions.length = 0;
      builder.normals.length = 0;
      builder.parts.length = 0;
      builder.alongs.length = 0;
      builder.indices.length = 0;
      builder.shadowIndices.length = 0;
      const along = fields.top > 0.9 ? 0.85 : 0.8;
      if (level === 3) {
        builder.add([0, 0, 0], [0, 0, 1], TREE_CROP_PART.BODY, along);
        builder.add([0, 0, 0], [0, 0, 1], TREE_CROP_PART.CONTACT, 0);
        builder.indices.push(0, 1);
        builder.bodyIndexCount = 1;
      } else {
        // A many-sided fan, not a quad with its corners discarded: a fragment that may discard is shaded
        // before the depth test, and most of a far crown's crops are behind its leaves.
        const sides = 12;
        builder.bodyIndexCount = sides * 3;
        for (const part of [TREE_CROP_PART.BODY, TREE_CROP_PART.CONTACT]) {
          const center = builder.add(
            [0, 0, 0],
            [0, 0, 1],
            part,
            part === TREE_CROP_PART.BODY ? along : 0
          );
          for (let side = 0; side < sides; side++) {
            const angle = (side / sides) * Math.PI * 2;
            builder.add([Math.cos(angle), Math.sin(angle), 0], [0, 0, 1], part, along);
            builder.indices.push(center, center + 1 + side, center + 1 + ((side + 1) % sides));
          }
        }
      }
    } else {
      builder.bodyIndexCount = builder.indices.length;
      const center = builder.add([0, 0, 0], [0, 0, 1], TREE_CROP_PART.CONTACT, 0);
      const sides = rich ? 20 : 12;
      for (let side = 0; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        builder.add([Math.cos(angle), Math.sin(angle), 0], [0, 0, 1], TREE_CROP_PART.CONTACT, 1);
        builder.indices.push(center, center + 1 + side, center + 1 + ((side + 1) % sides));
      }
    }
    return builder.build(fields);
  };
  /** The shadow pass sees a few of a body's rings and sides. */
  const addBodyShadow = (body: CropSurface) => {
    builder.addShadowSurface(body, Math.ceil(body.rings / 5), Math.ceil(body.sides / 6));
  };
  if (kind === 'fruit' || kind === 'lemon') {
    const profile = kind === 'lemon' ? LEMON_PROFILE : FRUIT_PROFILE;
    const top = profile(0)[1];
    const body = addRevolved(builder, profile, rich ? 44 : 14, rich ? 72 : 26);
    addCalyx(builder, profile, rich);
    addStem(builder, rich, kind === 'lemon' ? 0.9 : 1);
    addBodyShadow(body);
    return finish(
      kind === 'lemon' ? {top, restHeight: 0.7, stem: 0.4} : {top, restHeight: 0.97, stem: 0.44}
    );
  }
  if (kind === 'cone') {
    // Scales, in the two spirals of a cone.
    const ridges = (angle: number, z: number) =>
      Math.sin(angle * 7 + z * 17) * Math.sin(angle * 7 - z * 17);
    const body = builder.addSurface(
      count(36),
      rich ? 60 : 36,
      (u, angle) => {
        const polar = u * Math.PI;
        const z = Math.cos(polar) * 0.88;
        const rho =
          (0.5 + 0.18 * Math.cos(polar)) * Math.sin(polar) ** 0.55 * (1 + 0.1 * ridges(angle, z));
        return [Math.cos(angle) * rho, Math.sin(angle) * rho, z];
      },
      TREE_CROP_PART.BODY,
      (u, angle) => 0.8 + 0.18 * ridges(angle, Math.cos(u * Math.PI) * 0.88)
    );
    addStem(builder, rich, 1.5);
    addBodyShadow(body);
    return finish({top: 0.88, restHeight: 0.5, stem: 0.2});
  }
  if (kind === 'acorn') {
    // The cap sits over the top of the nut, with a lip.
    const lip = (z: number) => Math.min(1, Math.max(0, (z - 0.17) / 0.05));
    const body = builder.addSurface(
      count(30),
      count(28),
      (u, angle) => {
        const polar = u * Math.PI;
        const z = Math.cos(polar) * 0.85;
        const rho = 0.62 * Math.sin(polar) ** (z < 0 ? 0.72 : 0.9) * (1 + 0.1 * lip(z));
        return [Math.cos(angle) * rho, Math.sin(angle) * rho, z];
      },
      TREE_CROP_PART.BODY,
      u => 1 - 0.56 * lip(Math.cos(u * Math.PI) * 0.85)
    );
    addStem(builder, rich, 1.3);
    addBodyShadow(body);
    return finish({top: 0.85, restHeight: 0.62, stem: 0.26});
  }
  if (kind === 'catkin') {
    const flowers = (angle: number, z: number) => Math.sin(angle * 5 + z * 40);
    const body = builder.addSurface(
      count(30),
      count(12),
      (u, angle) => {
        const polar = u * Math.PI;
        const z = Math.cos(polar);
        const rho = 0.19 * Math.sin(polar) ** 0.35 * (1 + 0.16 * flowers(angle, z));
        return [Math.cos(angle) * rho, Math.sin(angle) * rho, z];
      },
      TREE_CROP_PART.BODY,
      (u, angle) => 0.82 + 0.18 * flowers(angle, Math.cos(u * Math.PI))
    );
    addStem(builder, rich, 0.7);
    addBodyShadow(body);
    return finish({top: 1, restHeight: 0.2, stem: 0.12});
  }
  // Propagule: a long green pencil, swollen toward its tip, with a collar at the top.
  const body = builder.addSurface(
    count(18),
    count(12),
    (u, angle) => {
      const polar = u * Math.PI;
      const z = Math.cos(polar);
      const collar = 1 + 0.55 * Math.max(0, Math.min(1, (z - 0.84) / 0.04));
      const rho = 0.09 * (1.1 - 0.25 * z) * Math.sin(polar) ** 0.3 * collar;
      return [Math.cos(angle) * rho, Math.sin(angle) * rho, z];
    },
    TREE_CROP_PART.BODY,
    u => (Math.cos(u * Math.PI) > 0.84 ? 0.5 : 0.95)
  );
  addStem(builder, rich, 0.6);
  addBodyShadow(body);
  return finish({top: 1, restHeight: 0.11, stem: 0.08});
}

const GEOMETRY_CACHE = new Map<string, TreeCropGeometry>();

/** Geometry of a photoreal crop, shared by every tree. */
export function getTreeCropGeometry(kind: CropKind, level: TreeCropMeshLevel): TreeCropGeometry {
  const key = `${kind}-${level}`;
  let geometry = GEOMETRY_CACHE.get(key);
  if (!geometry) {
    geometry = kind === 'flower' ? createFlowerGeometry(level) : createHangingGeometry(kind, level);
    GEOMETRY_CACHE.set(key, geometry);
  }
  return geometry;
}

/** What a crop kind costs per crop, so a view can be budgeted before its layers exist. */
export function getTreeCropVertexCount(kind: CropKind, level: TreeCropMeshLevel): number {
  return getTreeCropGeometry(kind, level).vertexCount;
}

/**
 * The anchors of a template, indexed for `count` and `growth`. A tree's crops are the first `count` anchors
 * of `order` that are born by its growth. A prefix of that order is an even sample of the crown's surface,
 * where crops hang in the light and can be seen, and only then of its inside.
 */
export type TreeCropTable = {
  anchorCount: number;
  /** Anchors from first to last. The template's own stable order, with the outer crown first. */
  order: Uint16Array;
  /** `TREE_CROP_RANK_LEVELS` entries per anchor: how many anchors before it are born at that level. */
  ranks: Float32Array;
  /** Anchors from the first born to the last. */
  byBirth: Uint16Array;
  /** Their births, ascending. */
  births: Float32Array;
};

/** Anchors take their turn by how far out they are, in tiers of `shell`: the skin of the crown first. */
const TREE_CROP_SHELL_TIERS: readonly number[] = [0.85, 0.5, 0];

/**
 * Fruit touch at most, and hang singly or in twos and threes. In metres on a tree of the template's own height,
 * of half that crown radius: how close two crops can hang, how far off the next of a group can be, and the share
 * of first crops that bring one along, and of those that bring two.
 */
const TREE_CROP_SPACING = 0.095;
const TREE_CROP_GROUP_REACH = 0.24;
const TREE_CROP_PAIR_SHARE = 0.34;
const TREE_CROP_TRIO_SHARE = 0.12;
/** Of a tree's height, where the top of its crown starts to bear less than its skin suggests, and over what span. */
const TREE_CROP_TOP_FROM = 0.5;
const TREE_CROP_TOP_SPAN = 0.3;
/** The share of anchors above that span that wait for the others of their tier. */
const TREE_CROP_TOP_WAITS = 0.62;

/**
 * The order crops take their anchors in. Tier by tier, each comes unless it would hang in one that has come
 * already, in which case it waits for the next tier. A share of them bring the nearest anchors within reach along
 * with them, which makes twos and threes on real twigs. It depends only on the template.
 */
function getTreeCropOrder(model: TreeGrowthModel): Uint16Array {
  const {cropAnchors, cropAnchorCount: anchorCount, referenceHeight} = model;
  const stride = TREE_CROP_ANCHOR_STRIDE;
  const crown = referenceHeight / 2;
  const positions = new Float32Array(anchorCount * 3);
  for (let anchor = 0; anchor < anchorCount; anchor++) {
    positions[anchor * 3] = cropAnchors[anchor * stride] * crown;
    positions[anchor * 3 + 1] = cropAnchors[anchor * stride + 1] * crown;
    positions[anchor * 3 + 2] = cropAnchors[anchor * stride + 2] * referenceHeight;
  }
  const distance = (a: number, b: number) =>
    Math.hypot(
      positions[a * 3] - positions[b * 3],
      positions[a * 3 + 1] - positions[b * 3 + 1],
      positions[a * 3 + 2] - positions[b * 3 + 2]
    );
  // Anchors by cell, for what lies within a group's reach, and those placed so far by cell.
  const cell = TREE_CROP_GROUP_REACH;
  const getKey = (anchor: number, dx = 0, dy = 0, dz = 0) =>
    `${Math.floor(positions[anchor * 3] / cell) + dx},${Math.floor(positions[anchor * 3 + 1] / cell) + dy},${Math.floor(positions[anchor * 3 + 2] / cell) + dz}`;
  const grid = new Map<string, number[]>();
  const placedGrid = new Map<string, number[]>();
  for (let anchor = 0; anchor < anchorCount; anchor++) {
    const key = getKey(anchor);
    const list = grid.get(key);
    if (list) list.push(anchor);
    else grid.set(key, [anchor]);
  }
  const forNearby = (
    source: Map<string, number[]>,
    anchor: number,
    visit: (other: number) => void
  ) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = source.get(getKey(anchor, dx, dy, dz));
          if (list) for (const other of list) visit(other);
        }
      }
    }
  };
  const placed = new Uint8Array(anchorCount);
  const order: number[] = [];
  const isClear = (anchor: number) => {
    let clear = true;
    forNearby(placedGrid, anchor, other => {
      if (distance(anchor, other) < TREE_CROP_SPACING) clear = false;
    });
    return clear;
  };
  const place = (anchor: number) => {
    placed[anchor] = 1;
    order.push(anchor);
    const key = getKey(anchor);
    const list = placedGrid.get(key);
    if (list) list.push(anchor);
    else placedGrid.set(key, [anchor]);
  };
  const getTier = (anchor: number) =>
    TREE_CROP_SHELL_TIERS.findIndex(shell => cropAnchors[anchor * stride + 7] >= shell);
  const tiers = TREE_CROP_SHELL_TIERS.map(() => [] as number[]);
  for (let anchor = 0; anchor < anchorCount; anchor++) tiers[getTier(anchor)].push(anchor);
  // The anchor's own seed says how many come with it, so a group is stable however large a count is.
  const take = (anchor: number, tier: number) => {
    place(anchor);
    const seed = cropAnchors[anchor * stride + 6];
    const company = seed < TREE_CROP_TRIO_SHARE ? 2 : seed < TREE_CROP_PAIR_SHARE ? 1 : 0;
    for (let member = 0; member < company; member++) {
      let nearest = -1;
      let nearestDistance = TREE_CROP_GROUP_REACH;
      const lastPlaced = order[order.length - 1];
      forNearby(grid, lastPlaced, other => {
        if (placed[other] || getTier(other) > tier) return;
        const apart = distance(lastPlaced, other);
        if (apart < nearestDistance && isClear(other)) {
          nearest = other;
          nearestDistance = apart;
        }
      });
      if (nearest < 0) break;
      place(nearest);
    }
  };
  // The skin of a crown is mostly its top, where a tree does not bear most. Some of those wait for the others.
  const waitsForLower = (anchor: number) => {
    const height = cropAnchors[anchor * stride + 2];
    const lowered = Math.max(0, Math.min(1, (height - TREE_CROP_TOP_FROM) / TREE_CROP_TOP_SPAN));
    return (cropAnchors[anchor * stride + 6] * 7.31) % 1 < TREE_CROP_TOP_WAITS * lowered;
  };
  let waiting: number[] = [];
  for (let tier = 0; tier < tiers.length; tier++) {
    const stillWaiting: number[] = [];
    const later: number[] = [];
    for (const anchor of [...tiers[tier], ...waiting]) {
      if (placed[anchor]) continue;
      if (!isClear(anchor)) stillWaiting.push(anchor);
      else if (waitsForLower(anchor)) later.push(anchor);
      else take(anchor, tier);
    }
    for (const anchor of later) {
      if (placed[anchor]) continue;
      if (isClear(anchor)) take(anchor, tier);
      else stillWaiting.push(anchor);
    }
    waiting = stillWaiting;
  }
  // What is still waiting would touch another crop, so it comes last, and the skin of the crown first of that.
  const shell = (anchor: number) => cropAnchors[anchor * stride + 7];
  order.push(...waiting.sort((a, b) => shell(b) - shell(a) || a - b));
  return Uint16Array.from(order);
}

const CROP_TABLES = new WeakMap<TreeGrowthModel, TreeCropTable>();

/** The rank table of a template, built once. */
export function getTreeCropTable(model: TreeGrowthModel): TreeCropTable {
  let table = CROP_TABLES.get(model);
  if (table) return table;
  const {cropAnchors, cropAnchorCount: anchorCount} = model;
  const stride = TREE_CROP_ANCHOR_STRIDE;
  const anchors = Array.from({length: anchorCount}, (_, anchor) => anchor);
  const order = getTreeCropOrder(model);
  const levels = TREE_CROP_RANK_LEVELS;
  const ranks = new Float32Array(anchorCount * levels);
  for (let level = 0; level < levels; level++) {
    const growth = level / (levels - 1);
    let rank = 0;
    for (let position = 0; position < anchorCount; position++) {
      const anchor = order[position];
      ranks[anchor * levels + level] = rank;
      if (cropAnchors[anchor * stride + 3] <= growth) rank++;
    }
  }
  const byBirth = anchors.sort(
    (a, b) => cropAnchors[a * stride + 3] - cropAnchors[b * stride + 3] || a - b
  );
  table = {
    anchorCount,
    order,
    ranks,
    byBirth: Uint16Array.from(byBirth),
    births: Float32Array.from(byBirth, anchor => cropAnchors[anchor * stride + 3])
  };
  CROP_TABLES.set(model, table);
  return table;
}

/** How many anchors are born by `growth`. */
export function getTreeCropBornCount(table: TreeCropTable, growth: number): number {
  const {births} = table;
  let low = 0;
  let high = births.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (births[middle] <= growth) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A prefix of the order long enough to hold the first `count` anchors born by `growth`. The rank a shader
 * computes between two levels is never below that of the lower one, so this is safe for it.
 */
export function getTreeCropReach(table: TreeCropTable, growth: number, count: number): number {
  const {ranks, order, anchorCount} = table;
  const levels = TREE_CROP_RANK_LEVELS;
  if (growth >= 1) return Math.min(anchorCount, Math.ceil(count));
  const level = Math.max(0, Math.floor(growth * (levels - 1)));
  // The first position with `count` anchors born before it.
  let low = 0;
  let high = anchorCount;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranks[order[middle] * levels + level] < count) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Crop instances one tree's slot needs: a prefix of the order, or the anchors born so far. */
export type TreeCropCapacity = {
  /** Instances held. */
  capacity: number;
  /** The anchors are the first born, for a young tree whose anchors are scattered down the order. */
  byBirth: boolean;
};

/** Below this, a change of capacity would only rewrite refs often. */
const TREE_CROP_MINIMUM_CAPACITY = 8;

/**
 * Whether a slot's instances must be rebuilt for this count and growth, and if so with what. Capacity is
 * `count` rounded up to a power of two on a grown tree. On a tree whose anchors are not all born it is the
 * smaller of how far the first `count` born anchors reach, and how many are born. A larger need replaces
 * it at once, and one a quarter of its size or less gives way to a smaller one, so a value going up and
 * down near a power of two rewrites nothing.
 */
export function updateTreeCropCapacity(
  capacity: TreeCropCapacity,
  table: TreeCropTable,
  growth: number,
  count: number,
  cluster: number
): boolean {
  const parents = Math.ceil(count / cluster);
  const reach = getTreeCropReach(table, growth, parents);
  const born = getTreeCropBornCount(table, growth);
  const need = Math.max(Math.min(reach, born) * cluster, Math.ceil(count > 0 ? 1 : 0));
  const covered = (capacity.byBirth ? born : reach) * cluster <= capacity.capacity;
  const limit = table.anchorCount * cluster;
  if (
    covered &&
    capacity.capacity > 0 &&
    capacity.capacity <= Math.max(need * 4, TREE_CROP_MINIMUM_CAPACITY)
  ) {
    return false;
  }
  const next =
    need > 0
      ? Math.min(limit, Math.max(TREE_CROP_MINIMUM_CAPACITY, 2 ** Math.ceil(Math.log2(need))))
      : 0;
  const byBirth = born < reach;
  if (next === capacity.capacity && byBirth === capacity.byBirth) return false;
  capacity.capacity = next;
  capacity.byBirth = byBirth;
  return true;
}

/** The instance refs for attached crops: `[tree row, crop index, dropped]`. Returns the next offset. */
export function writeTreeCropRefs(
  out: Float32Array,
  offset: number,
  row: number,
  capacity: TreeCropCapacity,
  table: TreeCropTable,
  cluster: number
): number {
  const anchors = capacity.byBirth ? table.byBirth : table.order;
  for (let crop = 0; crop < capacity.capacity; crop++) {
    out[offset++] = row;
    out[offset++] = anchors[Math.floor(crop / cluster)] * cluster + (crop % cluster);
    out[offset++] = 0;
  }
  return offset;
}
