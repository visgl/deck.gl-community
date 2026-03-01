// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import type {Color, DefaultProps, LayerProps, Position} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {
  createTrunkMesh,
  createPineCanopyMesh,
  createOakCanopyMesh,
  createPalmCanopyMesh,
  createBirchCanopyMesh,
  createCherryCanopyMesh,
  createCropMesh
} from './tree-geometry';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tree species / silhouette variant. */
export type TreeType = 'pine' | 'oak' | 'palm' | 'birch' | 'cherry';

/** Season that drives default canopy colour when no explicit colour is supplied. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * Crop configuration for a single tree.
 *
 * Pass this from `getCrop` to render small spherical crop points on the tree
 * and/or scattered on the ground around it. Works for fruit, nuts, or flowers
 * (flowering stage is expressed simply as a flower-coloured crop config).
 *
 * Positions are randomised deterministically from the tree's geographic
 * coordinates, so they are stable across re-renders.
 */
export type CropConfig = {
  /** Colour of each crop sphere [r, g, b, a]. */
  color: Color;
  /** Number of crop spheres placed in the outer canopy volume (live/in-tree crops). */
  count: number;
  /**
   * Number of crop spheres scattered on the ground within the canopy footprint
   * (dropped/fallen crops).
   * @default 0
   */
  droppedCount?: number;
  /** Radius of each individual crop sphere in metres. */
  radius: number;
};

// ---------------------------------------------------------------------------
// Default colours
// ---------------------------------------------------------------------------

/** Default trunk colours per tree type [r, g, b, a]. */
const DEFAULT_TRUNK_COLORS: Record<TreeType, Color> = {
  pine: [80, 50, 20, 255],
  oak: [91, 57, 23, 255],
  palm: [140, 100, 55, 255],
  birch: [220, 215, 205, 255], // white-grey birch bark
  cherry: [100, 60, 40, 255]
};

/** Default canopy colours per (tree type, season) [r, g, b, a]. */
const DEFAULT_CANOPY_COLORS: Record<TreeType, Record<Season, Color>> = {
  pine: {
    spring: [34, 100, 34, 255],
    summer: [0, 64, 0, 255],
    autumn: [0, 64, 0, 255], // evergreen — no colour change
    winter: [0, 55, 0, 255]
  },
  oak: {
    spring: [100, 180, 80, 255],
    summer: [34, 120, 15, 255],
    autumn: [180, 85, 20, 255],
    winter: [100, 80, 60, 160] // sparse, semi-transparent
  },
  palm: {
    spring: [50, 160, 50, 255],
    summer: [20, 145, 20, 255],
    autumn: [55, 150, 30, 255],
    winter: [40, 130, 30, 255]
  },
  birch: {
    spring: [150, 210, 110, 255],
    summer: [80, 160, 60, 255],
    autumn: [230, 185, 40, 255],
    winter: [180, 180, 170, 90] // near-bare
  },
  cherry: {
    spring: [255, 180, 205, 255], // pink blossom
    summer: [50, 140, 50, 255],
    autumn: [200, 60, 40, 255],
    winter: [120, 90, 80, 110] // bare
  }
};

// ---------------------------------------------------------------------------
// Pre-built unit-scale meshes (shared across all layer instances)
// ---------------------------------------------------------------------------

const TRUNK_MESH = createTrunkMesh();

const CANOPY_MESHES: Record<TreeType, ReturnType<typeof createTrunkMesh>> = {
  pine: createPineCanopyMesh(3),
  oak: createOakCanopyMesh(),
  palm: createPalmCanopyMesh(),
  birch: createBirchCanopyMesh(),
  cherry: createCherryCanopyMesh()
};

const CROP_MESH = createCropMesh();

const ALL_TREE_TYPES: TreeType[] = ['pine', 'oak', 'palm', 'birch', 'cherry'];

/**
 * Fraction of canopy height by which the canopy mesh is lowered into the trunk.
 * Hides the trunk-top disk that would otherwise peek above the canopy base.
 * 0.22 means the canopy base sits 22% of canopy-height below the trunk top.
 */
const CANOPY_TRUNK_OVERLAP = 0.22;

// ---------------------------------------------------------------------------
// Crop helpers
// ---------------------------------------------------------------------------

/** splitmix32 — fast, high-quality seeded PRNG returning values in [0, 1). */
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer seed derived from a geographic position. */
function positionSeed(lng: number, lat: number): number {
  return ((Math.round(lng * 10000) * 92821) ^ (Math.round(lat * 10000) * 65537)) >>> 0;
}

const DEG_PER_METER_LAT = 1 / 111320;

function lngDegreesPerMeter(latDeg: number): number {
  return 1 / (111320 * Math.cos((latDeg * Math.PI) / 180));
}

/** Internal flat record for a single rendered crop sphere. */
type CropPoint = {
  position: [number, number, number];
  color: Color;
  scale: number;
};

/**
 * Expand live crop positions so they straddle the canopy surface.
 *
 * The canopy mesh is a SphereGeometry(0.5, …) which, after SimpleMeshLayer
 * applies getScale = [r, r, H], has a true XY radius of 0.5 * r and a true
 * Z half-height of 0.5 * H.  Crops are placed at 85–110 % of those real
 * dimensions so most of each sphere sits just outside the canopy surface.
 *
 * Positions are seeded from the tree's geographic coordinates so they are
 * stable across re-renders.
 */
function expandLiveCropPoints(opts: {
  lng: number;
  lat: number;
  elevation: number;
  height: number;
  trunkFraction: number;
  canopyRadius: number;
  cropConfig: CropConfig;
  out: CropPoint[];
}): void {
  const {lng, lat, elevation, height, trunkFraction, canopyRadius, cropConfig, out} = opts;
  if (cropConfig.count <= 0) return;

  // Actual canopy sphere radii after SimpleMeshLayer scaling.
  // SphereGeometry has unit radius 0.5, so world radius = 0.5 * getScale component.
  const rxy = canopyRadius * 0.5;
  const canopyH = height * (1 - trunkFraction);
  const rz = canopyH * 0.5;
  // Canopy position is lowered by CANOPY_TRUNK_OVERLAP to hide the trunk-top disk
  const canopyCenterZ = elevation + height * trunkFraction - canopyH * CANOPY_TRUNK_OVERLAP + rz;

  const dLng = lngDegreesPerMeter(lat);
  const rng = createRng(positionSeed(lng, lat));

  for (let i = 0; i < cropConfig.count; i++) {
    const theta = rng() * Math.PI * 2;
    // Exclude top and bottom caps so crops never crown the canopy or hang below.
    // cos(phi) in [-0.80, 0.80] → phi from ~37° to ~143° (equatorial band).
    const cosPhi = -0.8 + rng() * 1.6;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    // 90–102 % of canopy radius: crops sit just at/inside the surface, tips barely poke out
    const radFrac = 0.9 + rng() * 0.12;

    const dx = rxy * radFrac * sinPhi * Math.cos(theta);
    const dy = rxy * radFrac * sinPhi * Math.sin(theta);
    const dz = rz * radFrac * cosPhi;

    out.push({
      position: [lng + dx * dLng, lat + dy * DEG_PER_METER_LAT, canopyCenterZ + dz],
      color: cropConfig.color,
      scale: cropConfig.radius
    });
  }
}

/**
 * Expand dropped crop positions uniformly across the ground disk within the
 * canopy footprint.  Uses a separate seed offset from live crops so that
 * changing `count` does not affect dropped positions.
 */
function expandDroppedCropPoints(opts: {
  lng: number;
  lat: number;
  elevation: number;
  canopyRadius: number;
  cropConfig: CropConfig;
  out: CropPoint[];
}): void {
  const {lng, lat, elevation, canopyRadius, cropConfig, out} = opts;
  const droppedCount = cropConfig.droppedCount ?? 0;
  if (droppedCount <= 0) return;

  // Actual canopy footprint radius (see note in expandLiveCropPoints)
  const footprintRadius = canopyRadius * 0.5;
  const dLng = lngDegreesPerMeter(lat);
  // XOR with a constant so the dropped sequence is independent of the live one
  const rng = createRng(positionSeed(lng, lat) ^ 0x1a2b3c4d);

  // Dropped crops are semi-transparent so they read as fallen/decaying
  const c = cropConfig.color as number[];
  const droppedColor: Color = [c[0], c[1], c[2], Math.round((c[3] ?? 255) * 0.45)] as Color;

  for (let i = 0; i < droppedCount; i++) {
    const theta = rng() * Math.PI * 2;
    // sqrt for uniform-area disk sampling
    const dist = Math.sqrt(rng()) * footprintRadius;

    const dx = dist * Math.cos(theta);
    const dy = dist * Math.sin(theta);

    out.push({
      position: [lng + dx * dLng, lat + dy * DEG_PER_METER_LAT, elevation + 0.05],
      color: droppedColor,
      scale: cropConfig.radius
    });
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type _TreeLayerProps<DataT> = {
  /** Source data. */
  data: DataT[];

  /** Longitude/latitude position of the tree base. */
  getPosition?: (d: DataT) => Position;

  /** Base elevation (metres above sea level). @default 0 */
  getElevation?: (d: DataT) => number;

  /**
   * Silhouette / species variant.
   * 'pine'   – layered conical tiers (evergreen)
   * 'oak'    – wide spherical canopy
   * 'palm'   – tall thin trunk with flat crown
   * 'birch'  – narrow oval canopy, pale bark
   * 'cherry' – round lush canopy, seasonal blossom
   * @default 'pine'
   */
  getTreeType?: (d: DataT) => TreeType;

  /**
   * Total tree height in metres.
   * @default 10
   */
  getHeight?: (d: DataT) => number;

  /**
   * Fraction of total height occupied by the trunk (0–1).
   * @default 0.35
   */
  getTrunkHeightFraction?: (d: DataT) => number;

  /**
   * Trunk base radius in metres.
   * @default 0.5
   */
  getTrunkRadius?: (d: DataT) => number;

  /**
   * Horizontal radius of the canopy in metres.
   * @default 3
   */
  getCanopyRadius?: (d: DataT) => number;

  /**
   * Explicit trunk colour [r, g, b, a].
   * When null the species default is used.
   * @default null
   */
  getTrunkColor?: (d: DataT) => Color | null;

  /**
   * Explicit canopy colour [r, g, b, a].
   * When null the species × season default is used.
   * @default null
   */
  getCanopyColor?: (d: DataT) => Color | null;

  /**
   * Season used to pick the default canopy colour when no explicit colour is provided.
   * @default 'summer'
   */
  getSeason?: (d: DataT) => Season;

  /**
   * Number of cone tiers for pine trees (1–5).
   * Higher values produce a denser layered silhouette.
   * @default 3
   */
  getBranchLevels?: (d: DataT) => number;

  /**
   * Optional crop configuration for this tree.
   *
   * Return a `CropConfig` to render small spherical crop points in the outer
   * canopy volume (live crops) and/or scattered on the ground around the trunk
   * (dropped crops).  Return `null` to show no crops for this tree.
   *
   * The same accessor can express fruit, nuts, or flowering stage — pass
   * flower-coloured points (e.g. `[255, 200, 220, 255]`) for a blossom effect.
   *
   * Crop positions are randomised deterministically from the tree's geographic
   * coordinates; they are stable across re-renders.
   *
   * @default null (no crops)
   */
  getCrop?: (d: DataT) => CropConfig | null;

  /**
   * Global size multiplier applied to all dimensions.
   * @default 1
   */
  sizeScale?: number;
};

export type TreeLayerProps<DataT = unknown> = _TreeLayerProps<DataT> & LayerProps;

const defaultProps: DefaultProps<TreeLayerProps<unknown>> = {
  getPosition: {type: 'accessor', value: (d: any) => d.position},
  getElevation: {type: 'accessor', value: (_d: any) => 0},
  getTreeType: {type: 'accessor', value: (_d: any) => 'pine' as TreeType},
  getHeight: {type: 'accessor', value: (_d: any) => 10},
  getTrunkHeightFraction: {type: 'accessor', value: (_d: any) => 0.35},
  getTrunkRadius: {type: 'accessor', value: (_d: any) => 0.5},
  getCanopyRadius: {type: 'accessor', value: (_d: any) => 3},
  getTrunkColor: {type: 'accessor', value: (_d: any) => null},
  getCanopyColor: {type: 'accessor', value: (_d: any) => null},
  getSeason: {type: 'accessor', value: (_d: any) => 'summer' as Season},
  getBranchLevels: {type: 'accessor', value: (_d: any) => 3},
  getCrop: {type: 'accessor', value: (_d: any) => null},
  sizeScale: {type: 'number', value: 1, min: 0}
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type TreeLayerState = {
  grouped: Record<TreeType, unknown[]>;
  pineMeshes: Record<number, ReturnType<typeof createPineCanopyMesh>>;
  liveCropPoints: CropPoint[];
  droppedCropPoints: CropPoint[];
};

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

/**
 * **TreeLayer** — A parametric, Three.js-powered deck.gl layer that renders
 * richly configurable 3D trees at geographic positions.
 *
 * Each tree is composed of two `SimpleMeshLayer` instances: one for the trunk
 * (a tapered cylinder) and one for the canopy (silhouette depends on `getTreeType`).
 * All geometry is generated procedurally using Three.js `BufferGeometry` primitives
 * and converted to the `@loaders.gl/schema` `MeshGeometry` format accepted by
 * `SimpleMeshLayer`.
 *
 * Parametric controls include:
 * - Species / silhouette (`getTreeType`)
 * - Total height (`getHeight`) and trunk-to-canopy proportion (`getTrunkHeightFraction`)
 * - Trunk and canopy radii (`getTrunkRadius`, `getCanopyRadius`)
 * - Explicit or season-driven colours (`getTrunkColor`, `getCanopyColor`, `getSeason`)
 * - Pine tier density (`getBranchLevels`)
 * - Crop / fruit / flower visualisation (`getCrop`)
 * - Global scale factor (`sizeScale`)
 */
export class TreeLayer<DataT = unknown, ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_TreeLayerProps<DataT>>
> {
  static layerName = 'TreeLayer';
  static defaultProps = defaultProps;

  declare state: TreeLayerState;

  initializeState() {
    this.state = {
      grouped: {pine: [], oak: [], palm: [], birch: [], cherry: []},
      pineMeshes: {},
      liveCropPoints: [],
      droppedCropPoints: []
    };
  }

  updateState({props, oldProps, changeFlags}) {
    if (changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.updateTriggersChanged) {
      const {
        data,
        getTreeType,
        getBranchLevels,
        getCrop,
        getPosition,
        getElevation,
        getHeight,
        getTrunkHeightFraction,
        getCanopyRadius,
        sizeScale
      } = props;

      const grouped: Record<TreeType, DataT[]> = {
        pine: [],
        oak: [],
        palm: [],
        birch: [],
        cherry: []
      };

      const pineMeshes: Record<number, ReturnType<typeof createPineCanopyMesh>> = {};
      const liveCropPoints: CropPoint[] = [];
      const droppedCropPoints: CropPoint[] = [];

      for (const d of data as DataT[]) {
        const type = getTreeType(d) as TreeType;
        if (grouped[type]) grouped[type].push(d);

        if (type === 'pine') {
          const levels = Math.max(1, Math.min(5, Math.round(getBranchLevels(d) as number)));
          pineMeshes[levels] ??= createPineCanopyMesh(levels);
        }

        const cropConfig = getCrop(d);
        if (cropConfig) {
          const pos = getPosition(d);
          const lng = pos[0];
          const lat = pos[1];
          const elev = getElevation(d) || 0;
          const h = getHeight(d) * sizeScale;
          const f = getTrunkHeightFraction(d);
          const r = getCanopyRadius(d) * sizeScale;

          // Scale crop radius in lock-step with all other dimensions
          const scaledCropConfig: CropConfig = {
            ...cropConfig,
            radius: cropConfig.radius * sizeScale
          };
          expandLiveCropPoints({
            lng,
            lat,
            elevation: elev,
            height: h,
            trunkFraction: f,
            canopyRadius: r,
            cropConfig: scaledCropConfig,
            out: liveCropPoints
          });
          expandDroppedCropPoints({
            lng,
            lat,
            elevation: elev,
            canopyRadius: r,
            cropConfig: scaledCropConfig,
            out: droppedCropPoints
          });
        }
      }

      this.setState({grouped, pineMeshes, liveCropPoints, droppedCropPoints});
    }
  }

  /**
   * Build a single canopy sub-layer.
   *
   * Takes explicit `mesh`, `data`, and `layerId` so that pine trees can be
   * split into one sub-layer per level count (each with its own mesh).
   */
  private _buildCanopyLayer(
    type: TreeType,
    mesh: ReturnType<typeof createTrunkMesh>,
    data: unknown[],
    layerId: string
  ): SimpleMeshLayer {
    const {
      getPosition,
      getElevation,
      getHeight,
      getTrunkHeightFraction,
      getCanopyRadius,
      getCanopyColor,
      getSeason,
      sizeScale
    } = this.props;

    return new SimpleMeshLayer(
      this.getSubLayerProps({
        id: layerId,
        data,
        mesh,
        getPosition: (d) => {
          const pos = getPosition(d);
          const elevation = getElevation(d) || 0;
          const h = getHeight(d) * sizeScale;
          const f = getTrunkHeightFraction(d);
          const canopyH = h * (1 - f);
          return [pos[0], pos[1], elevation + h * f - canopyH * CANOPY_TRUNK_OVERLAP];
        },
        getScale: (d) => {
          const pos = getPosition(d);
          const h = getHeight(d) * sizeScale;
          const f = getTrunkHeightFraction(d);
          const r = getCanopyRadius(d) * sizeScale;
          // Per-tree asymmetric XY scale from position hash — no two canopies
          // are the same oval, giving organic variety with zero extra draw calls.
          const seed = positionSeed(pos[0], pos[1]);
          const sx = 1 + ((seed & 0xffff) / 65535 - 0.5) * 0.3;
          const sy = 1 + (((seed >>> 16) & 0xffff) / 65535 - 0.5) * 0.3;
          return [r * sx, r * sy, h * (1 - f)];
        },
        getOrientation: (d) => {
          // Random bearing per tree: yaw (index 1) rotates around the vertical
          // Z axis in deck.gl's [pitch, yaw, roll] convention.
          // Pine tiers face different compass directions; bumpy canopies present
          // a unique silhouette from every viewing angle.
          const pos = getPosition(d);
          const seed = positionSeed(pos[0], pos[1]);
          const angle = (((seed ^ (seed >>> 13)) & 0xffff) / 65535) * 360;
          return [0, angle, 0];
        },
        getColor: (d) => {
          const explicit = getCanopyColor(d);
          if (explicit) return explicit;
          const season = getSeason(d) || 'summer';
          return DEFAULT_CANOPY_COLORS[type][season];
        },
        pickable: this.props.pickable,
        material: {ambient: 0.55, diffuse: 0.55, shininess: 0},
        updateTriggers: {
          getPosition: sizeScale,
          getScale: sizeScale,
          getOrientation: sizeScale
        }
      })
    );
  }

  renderLayers() {
    const {
      getPosition,
      getElevation,
      getTreeType,
      getHeight,
      getTrunkHeightFraction,
      getTrunkRadius,
      getTrunkColor,
      getBranchLevels,
      sizeScale
    } = this.props;

    const {grouped, pineMeshes, liveCropPoints, droppedCropPoints} = this.state;

    // -----------------------------------------------------------------------
    // 1. Trunk layer — one layer for ALL tree types, shared cylinder geometry
    // -----------------------------------------------------------------------
    const trunkLayer = new SimpleMeshLayer(
      this.getSubLayerProps({
        id: 'trunks',
        data: this.props.data,
        mesh: TRUNK_MESH,
        getPosition: (d) => {
          const pos = getPosition(d);
          return [pos[0], pos[1], getElevation(d) || 0];
        },
        getScale: (d) => {
          const h = getHeight(d) * sizeScale;
          const f = getTrunkHeightFraction(d);
          const r = getTrunkRadius(d) * sizeScale;
          return [r, r, h * f];
        },
        getColor: (d) => {
          const explicit = getTrunkColor(d);
          if (explicit) return explicit;
          const type = getTreeType(d) || 'pine';
          return DEFAULT_TRUNK_COLORS[type] ?? DEFAULT_TRUNK_COLORS.pine;
        },
        pickable: this.props.pickable,
        material: {ambient: 0.45, diffuse: 0.55, shininess: 4},
        updateTriggers: {getScale: sizeScale}
      })
    );

    // -----------------------------------------------------------------------
    // 2. Canopy layers
    //    Non-pine: one sub-layer per species.
    //    Pine: one sub-layer per branch-level count, each using its own mesh,
    //    so trees with 2/3/4 tiers never share a mismatched mesh.
    // -----------------------------------------------------------------------
    const nonPineCanopies = ALL_TREE_TYPES.filter((t) => t !== 'pine' && grouped[t].length > 0).map(
      (t) => this._buildCanopyLayer(t, CANOPY_MESHES[t], grouped[t], `canopy-${t}`)
    );

    const pineCanopies = Object.entries(pineMeshes).flatMap(([levelStr, mesh]) => {
      const levels = Number(levelStr);
      const pineData = grouped.pine.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d) => Math.max(1, Math.min(5, Math.round(getBranchLevels(d as any)))) === levels
      );
      return pineData.length > 0
        ? [this._buildCanopyLayer('pine', mesh, pineData, `canopy-pine-${levels}`)]
        : [];
    });

    const canopyLayers = [...nonPineCanopies, ...pineCanopies];

    // -----------------------------------------------------------------------
    // 3. Crop layers — live (in canopy) and dropped (on ground)
    // -----------------------------------------------------------------------
    const cropLayers = [];

    if (liveCropPoints.length > 0) {
      cropLayers.push(
        new SimpleMeshLayer(
          this.getSubLayerProps({
            id: 'live-crops',
            data: liveCropPoints,
            mesh: CROP_MESH,
            getPosition: (d: CropPoint) => d.position,
            getScale: (d: CropPoint) => [d.scale, d.scale, d.scale],
            getColor: (d: CropPoint) => d.color,
            pickable: false,
            material: {ambient: 0.5, diffuse: 0.8, shininess: 40}
          })
        )
      );
    }

    if (droppedCropPoints.length > 0) {
      cropLayers.push(
        new SimpleMeshLayer(
          this.getSubLayerProps({
            id: 'dropped-crops',
            data: droppedCropPoints,
            mesh: CROP_MESH,
            getPosition: (d: CropPoint) => d.position,
            getScale: (d: CropPoint) => [d.scale, d.scale, d.scale],
            getColor: (d: CropPoint) => d.color,
            pickable: false,
            material: {ambient: 0.6, diffuse: 0.5, shininess: 10}
          })
        )
      );
    }

    return [trunkLayer, ...canopyLayers, ...cropLayers];
  }
}
