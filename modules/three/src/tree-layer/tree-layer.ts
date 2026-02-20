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
  createCherryCanopyMesh
} from './tree-geometry';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tree species / silhouette variant. */
export type TreeType = 'pine' | 'oak' | 'palm' | 'birch' | 'cherry';

/** Season that drives default canopy colour when no explicit colour is supplied. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

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

const ALL_TREE_TYPES: TreeType[] = ['pine', 'oak', 'palm', 'birch', 'cherry'];

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
  sizeScale: {type: 'number', value: 1, min: 0}
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type TreeLayerState = {
  grouped: Record<TreeType, unknown[]>;
  pineMeshes: Record<number, ReturnType<typeof createPineCanopyMesh>>;
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
      pineMeshes: {}
    };
  }

  updateState({props, changeFlags}) {
    if (changeFlags.dataChanged || changeFlags.updateTriggersChanged) {
      const {data, getTreeType, getBranchLevels} = props;
      const grouped: Record<TreeType, DataT[]> = {
        pine: [],
        oak: [],
        palm: [],
        birch: [],
        cherry: []
      };

      // Build per-level pine mesh cache
      const pineMeshes: Record<number, ReturnType<typeof createPineCanopyMesh>> = {};

      for (const d of data as DataT[]) {
        const type = getTreeType(d) as TreeType;
        if (grouped[type]) grouped[type].push(d);
        if (type === 'pine') {
          const levels = Math.max(1, Math.min(5, Math.round(getBranchLevels(d) as number)));
          pineMeshes[levels] ??= createPineCanopyMesh(levels);
        }
      }

      this.setState({grouped, pineMeshes});
    }
  }

  /** Build a single canopy sub-layer for one tree type. */
  private _buildCanopyLayer(type: TreeType) {
    const {
      getPosition,
      getElevation,
      getHeight,
      getTrunkHeightFraction,
      getCanopyRadius,
      getCanopyColor,
      getSeason,
      sizeScale
    } = this.props; // eslint-disable-line max-len
    const {grouped, pineMeshes} = this.state;

    let mesh = CANOPY_MESHES[type];
    if (type === 'pine') {
      const firstLevel = Object.keys(pineMeshes)[0];
      if (firstLevel) mesh = pineMeshes[Number(firstLevel)];
    }

    return new SimpleMeshLayer(
      this.getSubLayerProps({
        id: `canopy-${type}`,
        data: grouped[type],
        mesh,
        getPosition: (d) => {
          const pos = getPosition(d);
          const elevation = getElevation(d) || 0;
          const h = getHeight(d) * sizeScale;
          const f = getTrunkHeightFraction(d);
          return [pos[0], pos[1], elevation + h * f];
        },
        getScale: (d) => {
          const h = getHeight(d) * sizeScale;
          const f = getTrunkHeightFraction(d);
          const r = getCanopyRadius(d) * sizeScale;
          return [r, r, h * (1 - f)];
        },
        getColor: (d) => {
          const explicit = getCanopyColor(d);
          if (explicit) return explicit;
          const season = getSeason(d) || 'summer';
          return DEFAULT_CANOPY_COLORS[type][season];
        },
        pickable: this.props.pickable,
        material: {ambient: 0.4, diffuse: 0.7, shininess: 12}
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
      sizeScale
    } = this.props;

    const {grouped} = this.state;

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
        material: {ambient: 0.35, diffuse: 0.6, shininess: 8}
      })
    );

    // -----------------------------------------------------------------------
    // 2. Canopy layers — one per tree type, only for trees of that type
    // -----------------------------------------------------------------------
    const canopyLayers = ALL_TREE_TYPES.filter((type) => grouped[type].length > 0).map((type) =>
      this._buildCanopyLayer(type)
    );

    return [trunkLayer, ...canopyLayers];
  }
}
