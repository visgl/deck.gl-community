// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, createIterable} from '@deck.gl/core';
import type {
  Color,
  Accessor,
  DefaultProps,
  CompositeLayerProps,
  Position,
  Layer,
  AccessorContext
} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {getTreeMesh, createTreeRng} from './tree-geometry';
import {TreeMeshLayer} from './tree-mesh-layer';
import {SplatLayer} from '../splat-layer/splat-layer';
import {getTreeWoodMesh} from './tree-wood';
import {sampleTreeFruit} from './tree-botany';
import {TreeWoodLayer} from './tree-wood-layer';
import {getTreeCropMesh, type CropKind} from './tree-crop';
import {
  resolveTreeCharacteristics,
  getTreeCharacteristicsKey,
  type TreeCharacteristics
} from './tree-characteristics';
export type {CropKind} from './tree-crop';
export type {TreeCharacteristics} from './tree-characteristics';
import {getTreeSplatSource, getTreeSplatHierarchy} from './tree-splats';

/** Procedural species silhouette. */
export type TreeType =
  | 'pine'
  | 'oak'
  | 'palm'
  | 'birch'
  | 'cherry'
  | 'banyan'
  | 'mangrove'
  | 'citrus';
/** Deciduous winter trees have branches; evergreens retain their crowns. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** Optional, explicitly supplied fruit, nuts, or flowering points. */
export type CropConfig = {
  /** Shape of the supplied crop. @default 'fruit' */
  kind?: CropKind;
  /** Explicit crop tint. */
  color: Color;
  /** Supplied attached crop count; rounded down and clamped at zero. */
  count: number;
  /** Supplied fallen crop count, independent of attached crops. @default 0 */
  droppedCount?: number;
  /** Enclosing sphere radius in metres, including elongated crops and petals. */
  radius: number;
};

/** Per-tree authored traits. Omitted dimensions use species proportions. */
export type TreeSpec = {
  /** Tree base, in the layer's coordinate system. */
  position?: Position;
  /** Species silhouette. @default 'pine' */
  species?: TreeType;
  /** Total height in metres; defaults depend on species. */
  height?: number;
  /** Nominal physical crown radius in metres, unlike the legacy canopy scale accessor. */
  crownRadius?: number;
  /** Physical bole radius in metres. */
  trunkRadius?: number;
  /** Root-to-first-branch fraction of height. */
  trunkHeightFraction?: number;
  /** Base elevation; otherwise the position's third component is used. */
  elevation?: number;
  /** Seasonal foliage state. @default 'summer' */
  season?: Season;
  /** Shared morphology preset for wood, leaves and attached crops. */
  characteristics?: TreeCharacteristics;
  /** Explicit crops; omitted/null means none. */
  crop?: CropConfig | null;
  /** Per-tree bend fraction; true is a gentle 0.025 breeze, false disables bending. */
  wind?: boolean | number;
  /** Explicit bark tint. */
  trunkColor?: Color | null;
  /** Explicit foliage tint. */
  canopyColor?: Color | null;
  /** Pine tier count, clamped to 1–5. */
  branchLevels?: number;
};

// Height, physical crown/height ratio, first-branch fraction, bole/height ratio.
const TREE_PROPORTIONS: Record<TreeType, [number, number, number, number]> = {
  pine: [12, 0.25, 0.18, 0.025],
  oak: [14, 0.32, 0.36, 0.032],
  palm: [12, 0.35, 0.72, 0.021],
  birch: [14, 0.22, 0.4, 0.018],
  cherry: [8, 0.3, 0.3, 0.027],
  banyan: [18, 0.48, 0.28, 0.035],
  mangrove: [8, 0.36, 0.27, 0.028],
  citrus: [4.8, 0.44, 0.2, 0.025]
};

const DEFAULT_TRUNK_COLORS: Record<TreeType, Color> = {
  pine: [80, 50, 20, 255],
  oak: [91, 57, 23, 255],
  palm: [140, 100, 55, 255],
  birch: [220, 215, 205, 255], // white-grey birch bark
  cherry: [100, 60, 40, 255],
  banyan: [145, 137, 117, 255],
  mangrove: [100, 82, 64, 255],
  citrus: [112, 90, 60, 255]
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
    winter: [100, 80, 60, 255] // bare branches
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
    winter: [180, 180, 170, 255] // near-bare
  },
  banyan: {
    spring: [72, 145, 58, 255],
    summer: [42, 116, 39, 255],
    autumn: [53, 122, 44, 255],
    winter: [43, 108, 37, 255]
  },
  mangrove: {
    spring: [67, 147, 61, 255],
    summer: [26, 106, 47, 255],
    autumn: [39, 119, 52, 255],
    winter: [29, 100, 43, 255]
  },
  citrus: {
    spring: [62, 143, 40, 255],
    summer: [33, 112, 29, 255],
    autumn: [38, 116, 30, 255],
    winter: [31, 105, 28, 255]
  },
  cherry: {
    spring: [255, 180, 205, 255], // pink blossom
    summer: [50, 140, 50, 255],
    autumn: [200, 60, 40, 255],
    winter: [120, 90, 80, 255] // bare
  }
};

type _TreeLayerProps<DataT> = {
  /** Source data. */
  data: DataT[];

  /** All authored traits in one accessor. Defaults to the source row. Explicit granular accessors take precedence. */
  getTree?: Accessor<DataT, TreeSpec>;

  /** Position of the tree base, in the layer's coordinate system. */
  getPosition?: Accessor<DataT, Position>;

  /** Base elevation (metres above sea level). @default 0 */
  getElevation?: Accessor<DataT, number>;

  /**
   * Silhouette / species variant.
   * 'pine'   – layered conical tiers (evergreen)
   * 'oak'    – wide lobed canopy
   * 'palm'   – ring-scarred palm trunk with arching pinnate fronds
   * 'birch'  – narrow oval canopy, pale bark
   * 'cherry' – round lush canopy, seasonal blossom
   * 'banyan' – spreading evergreen crown and descending aerial roots
   * 'mangrove' – dense evergreen crown, large elliptical leaves and stilt roots
   * 'citrus' – dense rounded evergreen crown and elliptical leaves
   * @default 'pine'
   */
  getTreeType?: Accessor<DataT, TreeType>;

  /**
   * Total tree height in metres.
   * @default 10
   */
  getHeight?: Accessor<DataT, number>;

  /**
   * Fraction of total height occupied by the trunk (0–1).
   * @default 0.35
   */
  getTrunkHeightFraction?: Accessor<DataT, number>;

  /**
   * Trunk base radius in metres.
   * @default 0.5
   */
  getTrunkRadius?: Accessor<DataT, number>;

  /**
   * Horizontal canopy scale in metres. Broadleaf envelopes retain the legacy approximate half-scale radius.
   * @default 3
   */
  getCanopyRadius?: Accessor<DataT, number>;

  /**
   * Explicit trunk colour [r, g, b, a].
   * When null the species default is used.
   * @default null
   */
  getTrunkColor?: Accessor<DataT, Color | null>;

  /**
   * Explicit canopy colour [r, g, b, a].
   * When null the species × season default is used.
   * @default null
   */
  getCanopyColor?: Accessor<DataT, Color | null>;

  /**
   * Season controls default foliage colour and deciduous foliage visibility; wood is unchanged.
   * @default 'summer'
   */
  getSeason?: Accessor<DataT, Season>;

  /**
   * Number of cone tiers for pine trees (1–5).
   * Higher values produce a denser layered silhouette.
   * @default 3
   */
  getBranchLevels?: Accessor<DataT, number>;

  /**
   * Optional crop configuration for this tree.
   *
   * Return a `CropConfig` to render shaped crops on leaf-bearing shoots within the
   * canopy (live crops) and/or scattered on the ground around the trunk
   * (dropped crops).  Return `null` to show no crops for this tree.
   *
   * The same accessor can express fruit, nuts, or flowering stage — pass
   * `kind: 'flower'` with a flower colour (e.g. `[255, 200, 220, 255]`) for blossom.
   *
   * Crop positions are randomised deterministically from the tree's geographic
   * coordinates; they are stable across re-renders.
   *
   * Attached crops too large to fit the foliage are omitted.
   * @default null (no crops)
   */
  getCrop?: Accessor<DataT, CropConfig | null>;

  /**
   * Global size multiplier applied to all dimensions.
   * @default 1
   */
  sizeScale?: number;
  /** Shared broadleaf branching and leaf morphology. Pine/palm retain their specialized skeletons. @default {} */
  characteristics?: TreeCharacteristics;
  /** Fraction of tree height used for optional GPU wind deformation. Zero stops continuous redraw. @default 0 */
  windStrength?: number;
  /** Wind clock in seconds, or null to use deck.gl's timeline. Set a number for repeatable comparisons. @default null */
  windTime?: number | null;
  /** Shared per-frame canopy Gaussian budget, apportioned across species. Finest templates remain available. @default 250000 */
  maxCanopySplats?: number;
  /** Independent shadow-map Gaussian budget. @default 125000 */
  maxShadowSplats?: number;
  /** Pixel cap for the shared Gaussian accumulation pass, independent of opaque wood and picking. @default Infinity */
  maxCanopyPixels?: number;
  /** Refine actual crowns around screen center while retaining every visible tree. @default 0 */
  foveationStrength?: number;
  /** Optical coverage used by streaming transitions; does not rebuild owner geometry. @default 1 */
  getCoverageWeight?: Accessor<DataT, number>;
  /** Cast shadows when the host LightingEffect enables them. WebGL only until deck.gl supports WebGPU shadows. @default true */
  shadowEnabled?: boolean;
};

export type TreeLayerProps<DataT = unknown> = _TreeLayerProps<DataT> & CompositeLayerProps;

const defaultProps: DefaultProps<TreeLayerProps<unknown>> = {
  getTree: {type: 'accessor', value: (d: any) => d},
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
  sizeScale: {type: 'number', value: 1, min: 0},
  characteristics: {type: 'object', value: {}},
  windStrength: {type: 'number', value: 0, min: 0, max: 0.2},
  windTime: null,
  maxCanopySplats: 250000,
  maxShadowSplats: 125000,
  maxCanopyPixels: Infinity,
  getCoverageWeight: {type: 'accessor', value: 1},
  foveationStrength: {type: 'number', value: 0, min: 0, max: 1},
  shadowEnabled: true
};

type TreeRow<DataT> = {
  object: DataT;
  position: Position;
  type: TreeType;
  winter: boolean;
  season: Season;
  levels: number;
  trunkColor?: Color | null;
  canopyColor?: Color | null;
  windStrength?: number;
  characteristics: TreeCharacteristics;
  height: number;
  trunkHeight: number;
  trunkRadius: number;
  scale: [number, number, number];
  orientation: [number, number, number];
  translation: [number, number, number];
  wind: [number, number, number];
};
type CropRow = {
  windStrength?: number;
  kind: CropKind;
  position: Position;
  translation: [number, number, number];
  radius: number;
  color: Color;
  wind: [number, number, number];
};
type TreeState<DataT> = {
  authoredWindStrength: number;
  hasAuthoredWind: boolean;
  hasDefaultWind: boolean;
  groups: Map<string, TreeRow<DataT>[]>;
  woodGroups: Map<string, TreeRow<DataT>[]>;
  trunks: TreeRow<DataT>[];
  palms: TreeRow<DataT>[];
  liveCrops: CropRow[];
  droppedCrops: CropRow[];
};

const GEOMETRY_PROPS = [
  'getTree',
  'getPosition',
  'getElevation',
  'getTreeType',
  'getHeight',
  'getTrunkHeightFraction',
  'getTrunkRadius',
  'getCanopyRadius',
  'getSeason',
  'getBranchLevels',
  'getCrop',
  'sizeScale',
  'characteristics'
] as const;

const TREE_MESH_ACCESSORS = Object.entries({
  ...SimpleMeshLayer.defaultProps,
  ...TreeMeshLayer.defaultProps,
  ...SplatLayer.defaultProps
})
  .filter(
    ([, definition]) =>
      definition &&
      typeof definition === 'object' &&
      'type' in definition &&
      definition.type === 'accessor'
  )
  .map(([name]) => name);

function getTreeAccessorValue<DataT, Value>(
  accessor: Accessor<DataT, Value>,
  object: DataT,
  info: AccessorContext<DataT>
): Value {
  return typeof accessor === 'function'
    ? (accessor as (object: DataT, info: AccessorContext<DataT>) => Value)(object, info)
    : accessor;
}

function isDefaultTreeAccessor(props, key: string): boolean {
  const definition = defaultProps[key];
  const value =
    definition && typeof definition === 'object' && 'value' in definition
      ? definition.value
      : definition;
  return props[key] === value;
}

function getFiniteDimension(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/** Layered, instanced trees built with vis.gl geometry, seasonal crowns and optional GPU wind. */
export class TreeLayer<DataT = unknown, ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_TreeLayerProps<DataT>>
> {
  static layerName = 'TreeLayer';
  static defaultProps = defaultProps;
  declare state: TreeState<DataT>;

  constructor(...props: (Partial<TreeLayerProps<DataT>> & Partial<NoInfer<ExtraPropsT>>)[]) {
    super(
      ...(props as Partial<
        ExtraPropsT & Required<_TreeLayerProps<DataT>> & Required<CompositeLayerProps>
      >[])
    );
  }

  initializeState() {
    this.state = {
      authoredWindStrength: 0,
      hasAuthoredWind: false,
      hasDefaultWind: true,
      groups: new Map(),
      woodGroups: new Map(),
      trunks: [],
      palms: [],
      liveCrops: [],
      droppedCrops: []
    };
  }

  updateState({props, oldProps, changeFlags}) {
    const triggers = changeFlags.updateTriggersChanged;
    const changed =
      changeFlags.dataChanged ||
      GEOMETRY_PROPS.some(
        key =>
          (typeof props[key] !== 'function' && props[key] !== oldProps[key]) ||
          triggers === true ||
          triggers?.all ||
          triggers?.[key]
      );
    if (!changed) return;
    const defaultCharacteristics = resolveTreeCharacteristics(props.characteristics);
    const defaultCharacteristicsKey = getTreeCharacteristicsKey(defaultCharacteristics);
    let authoredWindStrength = 0,
      hasAuthoredWind = false,
      hasDefaultWind = false;
    const groups = new Map<string, TreeRow<DataT>[]>();
    const trunks: TreeRow<DataT>[] = [];
    const palms: TreeRow<DataT>[] = [];
    const liveCrops: CropRow[] = [];
    const droppedCrops: CropRow[] = [];
    const {iterable, objectInfo} = createIterable(props.data);
    for (const object of iterable as Iterable<DataT>) {
      objectInfo.index++;
      const resolved = getTreeAccessorValue(props.getTree, object, objectInfo);
      const tree: TreeSpec = resolved && typeof resolved === 'object' ? resolved : {};
      const value = <Value>(key: string, authored: Value | undefined): Value =>
        authored !== undefined && isDefaultTreeAccessor(props, key)
          ? authored
          : getTreeAccessorValue(props[key] as Accessor<DataT, Value>, object, objectInfo);
      const type = value<TreeType>('getTreeType', tree.species);
      if (
        !['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove', 'citrus'].includes(type)
      )
        continue;
      const position = value<Position>('getPosition', tree.position);
      if (
        !position ||
        position.length < 2 ||
        !Number.isFinite(position[0]) ||
        !Number.isFinite(position[1])
      )
        continue;
      const seed =
        ((Math.round(position[0] * 10000) * 92821) ^ (Math.round(position[1] * 10000) * 65537)) >>>
        0;
      const proportions = TREE_PROPORTIONS[type];
      const authored = tree.species !== undefined;
      const characteristics = tree.characteristics
        ? resolveTreeCharacteristics({...props.characteristics, ...tree.characteristics})
        : defaultCharacteristics;
      const morphologyKey = tree.characteristics
        ? getTreeCharacteristicsKey(characteristics)
        : defaultCharacteristicsKey;
      const sizeScale = getFiniteDimension(props.sizeScale, 1);
      const height =
        getFiniteDimension(
          value<number>('getHeight', tree.height ?? (authored ? proportions[0] : undefined)),
          10
        ) * sizeScale;
      const fraction = Math.min(
        1,
        getFiniteDimension(
          value<number>(
            'getTrunkHeightFraction',
            tree.trunkHeightFraction ?? (authored ? proportions[2] : undefined)
          ),
          0.35
        )
      );
      const canopyHeight = height * (1 - fraction);
      const radius =
        getFiniteDimension(
          value<number>(
            'getCanopyRadius',
            tree.crownRadius !== undefined || authored
              ? (tree.crownRadius ?? (height / (sizeScale || 1)) * proportions[1]) *
                  (type === 'pine' || type === 'palm' ? 1 : 2)
              : undefined
          ),
          3
        ) * sizeScale;
      const requestedSeason = value<Season>('getSeason', tree.season);
      const season: Season = ['spring', 'summer', 'autumn', 'winter'].includes(requestedSeason)
        ? requestedSeason
        : 'summer';
      const winter =
        season === 'winter' && (type === 'oak' || type === 'birch' || type === 'cherry');
      const levels =
        type === 'pine'
          ? Math.max(
              1,
              Math.min(
                5,
                Math.round(
                  getFiniteDimension(value<number>('getBranchLevels', tree.branchLevels), 3)
                )
              )
            )
          : 3;
      const elevation = value<number>('getElevation', tree.elevation ?? position[2]);
      const windStrength =
        tree.wind === undefined
          ? undefined
          : Math.min(
              0.2,
              getFiniteDimension(
                typeof tree.wind === 'boolean' ? (tree.wind ? 0.025 : 0) : tree.wind,
                0
              )
            );
      if (windStrength === undefined) hasDefaultWind = true;
      if (windStrength !== undefined) {
        hasAuthoredWind = true;
        authoredWindStrength = Math.max(authoredWindStrength, windStrength);
      }
      const row = this.getSubLayerRow<TreeRow<DataT>>(
        {
          object,
          position: [position[0], position[1], Number.isFinite(elevation) ? elevation : 0],
          type,
          winter,
          season,
          levels,
          trunkColor: tree.trunkColor,
          canopyColor: tree.canopyColor,
          windStrength,
          characteristics,
          height,
          trunkHeight: height * fraction + (type === 'palm' ? canopyHeight * 0.24 : 0),
          trunkRadius:
            getFiniteDimension(
              value<number>(
                'getTrunkRadius',
                tree.trunkRadius ??
                  (authored ? (height / (sizeScale || 1)) * proportions[3] : undefined)
              ),
              0.5
            ) * sizeScale,
          scale: [
            radius * (1 + ((seed & 0xffff) / 65535 - 0.5) * 0.6),
            radius * (1 + (((seed >>> 16) & 0xffff) / 65535 - 0.5) * 0.6),
            canopyHeight
          ],
          orientation: [0, (((seed ^ (seed >>> 13)) & 0xffff) / 65535) * 360, 0],
          translation: [0, 0, height * fraction - canopyHeight * 0.22],
          wind: [height, (seed / 4294967296) * Math.PI * 2, 1]
        },
        object,
        objectInfo.index
      );
      const key = `${type}-${winter ? 'winter' : 'foliage'}-${levels}${morphologyKey === defaultCharacteristicsKey ? '' : `-${morphologyKey}`}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
      (type === 'palm' ? palms : trunks).push(row);
      const crop = value<CropConfig | null>('getCrop', tree.crop);
      if (crop && Number.isFinite(crop.radius) && crop.radius > 0) {
        const cropRadius = crop.radius * sizeScale;
        const rng = createTreeRng(seed);
        // SimpleMeshLayer uses yaw about Z and pitch about Y (roll is zero).
        const transform = new Matrix4()
          .rotateZ((row.orientation[1] * Math.PI) / 180)
          .rotateY((row.orientation[0] * Math.PI) / 180)
          .scale(row.scale);
        const count = Number.isFinite(crop.count) ? Math.max(0, Math.floor(crop.count)) : 0;
        for (let i = 0; i < count; i++) {
          const point = sampleTreeFruit(type, levels, rng, row.scale, cropRadius, characteristics);
          if (!point) continue;
          const offset = transform.transformAsVector(point) as [number, number, number];
          offset[2] += row.translation[2];
          liveCrops.push(
            this.getSubLayerRow(
              {
                position: row.position,
                translation: offset,
                kind: crop.kind ?? 'fruit',
                radius: cropRadius,
                color: crop.color,
                windStrength,
                wind: row.wind
              },
              object,
              objectInfo.index
            )
          );
        }
        const groundRng = createTreeRng(seed ^ 0x1a2b3c4d);
        const droppedCount = Number.isFinite(crop.droppedCount)
          ? Math.max(0, Math.floor(crop.droppedCount!))
          : 0;
        for (let i = 0; i < droppedCount; i++) {
          const theta = groundRng() * Math.PI * 2;
          const r = Math.sqrt(groundRng()) * radius * 0.5;
          droppedCrops.push(
            this.getSubLayerRow(
              {
                position: row.position,
                translation: [Math.cos(theta) * r, Math.sin(theta) * r, cropRadius],
                kind: crop.kind ?? 'fruit',
                radius: cropRadius,
                color: crop.color,
                wind: [height, row.wind[1], 0]
              },
              object,
              objectInfo.index
            )
          );
        }
      }
    }
    const woodGroups = new Map(
      [...groups].map(([key, rows]) => [
        key,
        rows.filter(row => row.scale.every(value => value > 0))
      ])
    );
    this.setState({
      authoredWindStrength,
      hasAuthoredWind,
      hasDefaultWind,
      groups,
      woodGroups,
      trunks,
      palms,
      liveCrops,
      droppedCrops
    });
  }

  private getTreeSubLayerProps(sublayerProps, legacyId?: string) {
    const {id} = sublayerProps;
    const legacyOverrides = legacyId ? this.props._subLayerProps?.[legacyId] : undefined;
    const exactOverrides = this.props._subLayerProps?.[id];
    const overrides = {...legacyOverrides, ...exactOverrides};
    const parameters = {
      ...this.props.parameters,
      ...sublayerProps.parameters,
      ...legacyOverrides?.parameters,
      ...exactOverrides?.parameters
    };
    const updateTriggers = {
      all: this.props.updateTriggers?.all,
      ...sublayerProps.updateTriggers,
      ...legacyOverrides?.updateTriggers,
      ...exactOverrides?.updateTriggers
    };
    const props = this.getSubLayerProps({
      ...sublayerProps,
      ...legacyOverrides,
      id,
      type: sublayerProps.type ?? TreeMeshLayer,
      parameters,
      updateTriggers
    });
    // deck.gl initializes child prop metadata lazily. Explicit wrapping also
    // covers the first trunk and legacy aliases, before that metadata exists.
    for (const name of TREE_MESH_ACCESSORS) {
      if (name in overrides) props[name] = this.getSubLayerAccessor(overrides[name]);
    }
    return {...props, parameters, updateTriggers};
  }

  renderLayers() {
    const {windTime, shadowEnabled, getTrunkColor, getCanopyColor, getSeason} = this.props;
    const windStrength = Math.max(
      this.state.hasDefaultWind ? getFiniteDimension(this.props.windStrength, 0) : 0,
      this.state.authoredWindStrength
    );
    const windTrigger = this.state.hasAuthoredWind ? [this.props.windStrength, windStrength] : null;
    const treeWind = (row: TreeRow<DataT> | CropRow): [number, number, number] =>
      this.state.hasAuthoredWind && windStrength > 0
        ? [
            row.wind[0],
            row.wind[1],
            (row.wind[2] * (row.windStrength ?? this.props.windStrength)) / windStrength
          ]
        : row.wind;
    const shared = {
      windStrength,
      windTime,
      shadowEnabled,
      foveationStrength: this.props.foveationStrength,
      getCoverageWeight: this.getSubLayerAccessor(this.props.getCoverageWeight),
      pickable: this.props.pickable
    };
    const layers: Layer[] = [];
    const foliage: Layer[] = [];
    const barkAccessor = this.getSubLayerAccessor(getTrunkColor) as Accessor<
      TreeRow<DataT>,
      Color | null
    >;
    const foliageAccessor = this.getSubLayerAccessor(getCanopyColor) as Accessor<
      TreeRow<DataT>,
      Color | null
    >;
    const trunkColor = (row: TreeRow<DataT>, info: AccessorContext<TreeRow<DataT>>) =>
      (isDefaultTreeAccessor(this.props, 'getTrunkColor')
        ? row.trunkColor
        : getTreeAccessorValue(barkAccessor, row, info)) ?? DEFAULT_TRUNK_COLORS[row.type];
    // Prepared rows remain identical on animation, lighting and color-only updates.
    const trunks = (data: TreeRow<DataT>[], id: string, palm: boolean) => {
      if (!data.length) return;
      layers.push(
        new TreeMeshLayer(
          this.getTreeSubLayerProps({
            id,
            data,
            ...shared,
            mesh: getTreeMesh('trunk', palm ? 'palm' : 'oak'),
            getPosition: (row: TreeRow<DataT>) => row.position,
            getScale: (row: TreeRow<DataT>) => [row.trunkRadius, row.trunkRadius, row.trunkHeight],
            getOrientation: (row: TreeRow<DataT>) =>
              row.winter ? [0, row.orientation[1], 0] : [0, 0, 0],
            getColor: trunkColor,
            getWind: treeWind,
            material: {ambient: 0.4, diffuse: 0.7, shininess: 4},
            updateTriggers: {
              getColor: [getTrunkColor, this.props.updateTriggers?.getTrunkColor],
              getWind: windTrigger,
              getDeformation: windTrigger,
              getCoverageWeight: this.props.updateTriggers?.getCoverageWeight
            }
          })
        )
      );
    };

    trunks(
      this.state.trunks.filter(row => row.scale.some(value => value <= 0)),
      'trunks',
      false
    );
    trunks(
      this.state.palms.filter(row => row.scale.some(value => value <= 0)),
      'trunks-palm',
      true
    );
    const foliageOwners = Array.from(this.state.groups.values()).reduce(
      (sum, rows) => sum + (rows[0]?.winter ? 0 : rows.length),
      0
    );
    for (const [key, data] of this.state.groups) {
      const {type, winter, levels, characteristics} = data[0];
      const wood = this.state.woodGroups.get(key)!;
      if (wood.length)
        layers.push(
          new TreeWoodLayer(
            this.getTreeSubLayerProps(
              {
                id: `wood-${key}`,
                data: wood,
                ...shared,
                mesh: getTreeWoodMesh(type, levels, false, characteristics),
                templateMesh: getTreeWoodMesh(type, levels, false, characteristics),
                getPosition: (row: TreeRow<DataT>) => row.position,
                getScale: (row: TreeRow<DataT>) => row.scale,
                getTranslation: (row: TreeRow<DataT>) => row.translation,
                getOrientation: (row: TreeRow<DataT>) => row.orientation,
                getCoverageWeight: this.getSubLayerAccessor(this.props.getCoverageWeight),
                getStemRadius: (row: TreeRow<DataT>) => row.trunkRadius,
                getRootLength: (row: TreeRow<DataT>) => row.height - row.scale[2],
                getWind: treeWind,
                getColor: trunkColor,
                material: {ambient: 0.5, diffuse: 0.75, shininess: 2},
                updateTriggers: {
                  getWind: windTrigger,
                  getDeformation: windTrigger,
                  getCoverageWeight: this.props.updateTriggers?.getCoverageWeight,
                  getColor: [getTrunkColor, this.props.updateTriggers?.getTrunkColor]
                }
              },
              'trunks'
            )
          )
        );
      if (winter) continue;
      const CanopyLayer = SplatLayer;
      foliage.push(
        new CanopyLayer(
          this.getTreeSubLayerProps(
            {
              type: CanopyLayer,
              id: `canopy-${key}`,
              data,
              ...shared,
              source: getTreeSplatSource(type, levels, characteristics),
              hierarchy: getTreeSplatHierarchy(type, levels, characteristics),
              pixelError: type === 'palm' ? 0.65 : 2.5,
              maxRenderPixels: this.props.maxCanopyPixels,
              foveationStrength: this.props.foveationStrength,
              getCoverageWeight: this.getSubLayerAccessor(this.props.getCoverageWeight),
              maxSplats: Math.floor(
                (this.props.maxCanopySplats * data.length) / Math.max(1, foliageOwners)
              ),
              maxShadowSplats: Math.floor(
                (this.props.maxShadowSplats * data.length) / Math.max(1, foliageOwners)
              ),
              deformationStrength: windStrength,
              deformationTime: windTime,
              getDeformation: treeWind,
              doubleSided: type === 'palm',
              parameters:
                type === 'palm'
                  ? {...this.props.parameters, cullMode: 'none'}
                  : this.props.parameters,
              getPosition: (row: TreeRow<DataT>) => row.position,
              getTranslation: (row: TreeRow<DataT>) => row.translation,
              getScale: (row: TreeRow<DataT>) => row.scale,
              getOrientation: (row: TreeRow<DataT>) => row.orientation,
              getWind: treeWind,
              getColor: (row: TreeRow<DataT>, info: AccessorContext<TreeRow<DataT>>) =>
                (isDefaultTreeAccessor(this.props, 'getCanopyColor')
                  ? row.canopyColor
                  : getTreeAccessorValue(foliageAccessor, row, info)) ??
                DEFAULT_CANOPY_COLORS[type][row.season],
              material: {ambient: 0.62, diffuse: 0.82, shininess: 2, specularColor: [0, 0, 0]},
              updateTriggers: {
                getWind: windTrigger,
                getDeformation: windTrigger,
                getCoverageWeight: this.props.updateTriggers?.getCoverageWeight,
                getColor: [
                  getCanopyColor,
                  getTrunkColor,
                  getSeason,
                  this.props.updateTriggers?.getCanopyColor,
                  this.props.updateTriggers?.getTrunkColor,
                  this.props.updateTriggers?.getSeason
                ]
              }
            },
            `canopy-${type}`
          )
        )
      );
    }
    for (const [id, data] of [
      ['live-crops', this.state.liveCrops],
      ['dropped-crops', this.state.droppedCrops]
    ] as const) {
      if (!data.length) continue;
      const byKind = new Map<CropKind, CropRow[]>();
      for (const row of data) {
        const group = byKind.get(row.kind) ?? [];
        group.push(row);
        byKind.set(row.kind, group);
      }
      for (const [kind, rows] of byKind)
        layers.push(
          new TreeMeshLayer(
            this.getTreeSubLayerProps(
              {
                id: kind === 'fruit' ? id : `${id}-${kind}`,
                data: rows,
                ...shared,
                mesh: getTreeCropMesh(kind),
                getPosition: (row: CropRow) => row.position,
                getTranslation: (row: CropRow) => row.translation,
                getScale: (row: CropRow) => [row.radius, row.radius, row.radius],
                getColor: (row: CropRow) => row.color,
                getWind: treeWind,
                material: {ambient: 0.4, diffuse: 0.7, shininess: 24},
                updateTriggers: {
                  getWind: windTrigger,
                  getDeformation: windTrigger,
                  getCoverageWeight: this.props.updateTriggers?.getCoverageWeight
                }
              },
              id
            )
          )
        );
    }
    return [...layers, ...foliage];
  }
}
