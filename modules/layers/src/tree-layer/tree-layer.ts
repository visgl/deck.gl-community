// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {_deepEqual, CompositeLayer, createIterable, COORDINATE_SYSTEM} from '@deck.gl/core';
import type {
  Color,
  Accessor,
  DefaultProps,
  CompositeLayerProps,
  GetPickingInfoParams,
  Position,
  Layer,
  AccessorContext,
  PickingInfo,
  UpdateParameters,
  Viewport
} from '@deck.gl/core';
import type {Texture} from '@luma.gl/core';
import type {PhongMaterialProps} from '@luma.gl/shadertools';
import {
  getTreeCropTable,
  getTreeCropVertexCount,
  updateTreeCropCapacity,
  writeTreeCropRefs,
  type CropKind,
  type TreeCropCapacity
} from './tree-crop';
import {
  resolveTreeCharacteristics,
  getTreeCharacteristicsKey,
  type TreeCharacteristics
} from './tree-characteristics';
export type {CropKind} from './tree-crop';
export type {TreeCharacteristics} from './tree-characteristics';
import {
  getSplatHighlightRow,
  updateSplatSourceHighlight
} from '../splat-layer/splat-source-highlight';
import {
  createSplatFrustum,
  getSplatBoundedPixelsPerMeter,
  getSplatCommonUnits,
  getSplatPixelsPerMeter,
  getSplatProjectionKey,
  getSplatQueryViews,
  intersectsSplatFrustum
} from '../splat-layer/splat-culling';
import {
  classifySplatHorizon,
  getSplatHorizon,
  getSplatTangentFrame,
  offsetSplatCommonPosition
} from '../splat-layer/splat-globe';
import {getSplatChangedRanges, SplatRowSlots} from '../splat-layer/splat-row-diff';
import {getTreeGrowthModel, isTreeGrowthSpecies, TREE_ROOT_PLATE_RADII} from './tree-growth-model';
import {createPineGrowthModel} from './tree-pine';
import {createPalmGrowthModel} from './tree-palm-growth-model';
import {
  getTreeCrownFraction,
  getTreeHeightFraction,
  getTreeRingRadius,
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_STATE_TEXEL,
  TREE_STATE_TEXELS_PER_ROW,
  TREE_STATE_TEXTURE_WIDTH,
  type TreeGrowthModel
} from './tree-photoreal-layout';
import {
  getTreeCropCluster,
  getTreeCropLevelMesh,
  getTreeCropLevelThin,
  getTreeCropMeshPixels,
  TREE_CROP_LEVEL_COUNT,
  TreePhotorealCropLayer,
  type TreeCropData
} from './tree-photoreal-crop-layer';
import {TreePhotorealLeafLayer, type TreeLeafData} from './tree-photoreal-leaf-layer';
import {
  getTreeLeafClusters,
  getTreeLeafClusterSphere,
  intersectsTreeLeafClipBounds,
  selectTreeLeafClusters,
  type TreeLeafSelection
} from './tree-leaf-clusters';
import type {TreeFog} from './tree-photoreal-primitive-layer';
import {
  TREE_CROP_BLOOM_FROM,
  TREE_LEAF_SHADOW_FULL_PIXELS,
  TREE_LEAF_BLADE_MARGIN_MACRO,
  TREE_LEAF_BLADE_MARGIN_MOST,
  TREE_LEAF_SHADOW_MOST,
  TREE_LEAF_SHADOW_SHARE,
  TREE_LEAF_STABLE_SHADOW_SHARE,
  TREE_WOOD_HIDDEN_FROM,
  TREE_WOOD_HIDDEN_TO,
  TREE_WOOD_LOD_SHIFT
} from './tree-photoreal-shaders';
import {getTreeStemModel} from './tree-stem-model';
import {TreeShellLayer} from './tree-shell-layer';
import {TreePhotorealWoodLayer} from './tree-photoreal-wood-layer';
import {
  TreeStateStore,
  type TreeStateCropUpdate,
  type TreeStateUpdate,
  type TreeTransitions
} from './tree-state-store';
export type {
  TreeInterpolationSettings,
  TreeSpringSettings,
  TreeTransitionCallback,
  TreeTransitionEnter,
  TreeTransitionKey,
  TreeTransitions,
  TreeTransitionSettings
} from './tree-state-store';

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
/**
 * Optional, explicitly supplied fruit, nuts, or flowering points. Every field but `kind` tweens under the
 * `getCrop` transition. A change of `kind` swaps the shape at once, unless the old kind has a slot of its
 * own to leave by.
 */
export type CropConfig = {
  /** Shape of the supplied crop. @default 'fruit' */
  kind?: CropKind;
  /** Explicit crop tint. */
  color: Color;
  /**
   * Supplied attached crop count; clamped at zero. These are the first `count`
   * anchors on wood that exists, so a larger count only adds crops, and fractions of the last few swell
   * from nothing as it rises. Otherwise it is rounded down.
   */
  count: number;
  /** Supplied fallen crop count, independent of attached crops. @default 0 */
  droppedCount?: number;
  /**
   * Maximum enclosing sphere radius in metres; attached crops vary deterministically from 84% to
   * this bound.
   */
  radius: number;
  /** Tint at `ripeness` 0. Defaults to a green derived from `color`. */
  unripeColor?: Color;
  /** Blend from `unripeColor` to `color`, varied fruit by fruit. @default 1 */
  ripeness?: number;
  /** Fraction of attached crops that have fallen and rest on the ground. @default 0 */
  fallen?: number;
};

/** Whole-tree tilt: degrees from upright (90 lies flat), and the compass bearing it tips toward. */
export type TreeLean = [degrees: number, bearing: number];

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
  /** Explicit crops, up to two such as blossom and fruit; omitted/null means none. */
  crop?: CropConfig | readonly CropConfig[] | null;
  /**
   * Biological time, 0-1. Shoots extend, fork and thicken; leaves and crops exist only on wood that
   * exists. 0 draws nothing. @default 1
   */
  growth?: number;
  /** Foliage from dry brown (0) to its tint (1), leaf by leaf. @default 1 */
  health?: number;
  /**
   * Fraction of leaves on the tree, 0-1. Falling values shed real leaves on the wind; rising values
   * grow new ones in place. @default 1
   */
  foliage?: number;
  /** Fresh lime new growth at shoot tips, 0-1. @default 0 */
  flush?: number;
  /** Tilt about the root plate. Roots and a soil plate come out of the ground. @default [0, 0] */
  lean?: TreeLean;
  /** Limbs snap progressively, thin ones first, and fall under world gravity, 0-1. @default 0 */
  damage?: number;
  /** The wreck settles flat onto the ground, greys, rots and disappears at 1. @default 0 */
  decay?: number;
  /**
   * Per-tree bend, as a fraction of height, up to 1 for a hurricane; true is a gentle 0.025 breeze,
   * false disables bending. Defaults to `windStrength`.
   */
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
  palm: [188, 150, 94, 255],
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

  /** Biological time per tree; see `TreeSpec.growth`. @default 1 */
  getGrowth?: Accessor<DataT, number>;
  /** Foliage health per tree; see `TreeSpec.health`. @default 1 */
  getHealth?: Accessor<DataT, number>;
  /** Fraction of leaves per tree; see `TreeSpec.foliage`. @default 1 */
  getFoliage?: Accessor<DataT, number>;
  /** New growth per tree; see `TreeSpec.flush`. @default 0 */
  getFlush?: Accessor<DataT, number>;
  /** Tilt per tree as `[degrees, bearing]`; see `TreeSpec.lean`. @default [0, 0] */
  getLean?: Accessor<DataT, TreeLean>;
  /** Broken limbs per tree; see `TreeSpec.damage`. @default 0 */
  getDamage?: Accessor<DataT, number>;
  /** Rot per tree; see `TreeSpec.decay`. @default 0 */
  getDecay?: Accessor<DataT, number>;

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
   * Crop positions and sizes are randomised deterministically from the tree's geographic
   * coordinates; they are stable across re-renders.
   *
   * Attached crops too large to fit the foliage are omitted.
   * Up to two configs may be returned in an array, such as blossom and fruit. All their fields but `kind`
   * tween under this accessor's transition.
   *
   * @default null (no crops)
   */
  getCrop?: Accessor<DataT, CropConfig | readonly CropConfig[] | null>;

  /**
   * Global size multiplier applied to all dimensions.
   * @default 1
   */
  sizeScale?: number;
  /** Shared broadleaf branching and leaf morphology. Pine/palm retain their specialized skeletons. @default {} */
  characteristics?: TreeCharacteristics;
  /** @internal Disable conservative near-leaf compaction for render and performance comparisons. */
  _leafCulling?: boolean;
  /** @internal Keep the leaf and wood caster geometry independent of the color LOD. */
  _stableLeafShadows?: boolean;
  /** @internal Draw crops independently of a field's canopy renderer, without preparing leaves or wood. */
  _cropOnly?: boolean;
  /**
   * Standard deck.gl transition settings keyed by accessor name, such as `getGrowth: 2000` or
   * `getLean: {type: 'spring'}`. `getTree` is the default for every `TreeSpec` field. Follows the deck.gl timeline. @default null
   */
  transitions?: TreeTransitions | null;
  /** Bark and root material. A default suited to bark when null. @default null */
  woodMaterial?: PhongMaterialProps | null;
  /** Leaf material. A default suited to leaves when null. @default null */
  foliageMaterial?: PhongMaterialProps | null;
  /** Crop material. Defaults that depend on the kind of crop when null. @default null */
  cropMaterial?: PhongMaterialProps | null;
  /**
   * Added to the photoreal level of detail, in levels. Each level halves the length a far leaf keeps on
   * screen and allows four times the vertices, so a negative value costs a lot and buys a lot: at -2 a far
   * tree has sixteen times its leaves, at a quarter of their length, for a render with time to spare.
   * @default 0
   */
  lodBias?: number;
  /**
   * Rain on the trees, from 0 to 1. Bark darkens and turns glossy, and leaves
   * darken a little and gain a stronger sheen, down to litter on the soil. @default 0
   */
  wetness?: number;
  /**
   * Hoar frost on the trees, from 0 to 1, leaves a pale rime on the upper surfaces of
   * leaves and twigs that are open to the sky. @default 0
   */
  frost?: number;
  /**
   * Exponential fog by distance from the camera, in linear light at the end of
   * every fragment, so a far grove has atmospheric depth. `color` is sRGB, each 0-255, the color a surface
   * lost in fog shows exactly. `density` is per metre: 0.01 takes about 63 percent of a surface's light at
   * 100 m. @default null
   */
  fog?: TreeFog | null;
  /**
   * Fraction of tree height used for optional GPU wind deformation, from 0 to 1: `0.025` is a gentle
   * breeze, and 1 a hurricane. A tree's own bend levels off at 0.3 of its height
   * and the rest goes into its crown, limbs and leaves. Zero stops continuous redraw. @default 0
   */
  windStrength?: number;
  /**
   * Compass bearing, degrees clockwise from +y, that the wind blows toward. Trees
   * bend that way, with gusts that travel across the grove. `null` keeps the sway of no particular
   * direction. @default null
   */
  windDirection?: number | null;
  /** Wind clock in seconds, or null to use deck.gl's timeline. Set a number for repeatable comparisons. @default null */
  windTime?: number | null;
  /**
   * The clock, in seconds, that gust fronts and their chop run on, or null to run them on `windTime`. Sway,
   * flutter, falls and everything else stay on `windTime`. A host that wants a gust to reach a place at a given
   * moment, such as a beat of a story, runs this clock faster or slower through it, solving with
   * `getTreeWindGust`, which reads the same gusts on the CPU. @default null
   */
  windGustTime?: number | null;
  /** Optical coverage used by streaming transitions; does not rebuild owner geometry. @default 1 */
  getCoverageWeight?: Accessor<DataT, number>;
  /**
   * Cast shadows from a `LightingEffect` light with `_shadow: true` (WebGL2): wood, crops and foliage
   * draw into deck.gl's shadow map. Trees receive shadows either way.
   * @default true
   */
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
  getGrowth: {type: 'accessor', value: (_d: any) => 1},
  getHealth: {type: 'accessor', value: (_d: any) => 1},
  getFoliage: {type: 'accessor', value: (_d: any) => 1},
  getFlush: {type: 'accessor', value: (_d: any) => 0},
  getLean: {type: 'accessor', value: (_d: any) => [0, 0] as TreeLean},
  getDamage: {type: 'accessor', value: (_d: any) => 0},
  getDecay: {type: 'accessor', value: (_d: any) => 0},
  _leafCulling: true,
  _stableLeafShadows: true,
  _cropOnly: false,
  transitions: null,
  woodMaterial: {type: 'object', value: null, compare: 2, optional: true},
  foliageMaterial: {type: 'object', value: null, compare: 2, optional: true},
  cropMaterial: {type: 'object', value: null, compare: 2, optional: true},
  lodBias: {type: 'number', value: 0},
  wetness: {type: 'number', value: 0, min: 0, max: 1},
  frost: {type: 'number', value: 0, min: 0, max: 1},
  fog: {type: 'object', value: null, compare: 2, optional: true},
  windDirection: null,
  sizeScale: {type: 'number', value: 1, min: 0},
  characteristics: {type: 'object', value: {}},
  windStrength: {type: 'number', value: 0, min: 0, max: 1},
  windTime: null,
  windGustTime: null,
  getCoverageWeight: {type: 'accessor', value: 1},
  shadowEnabled: true
};

const DEFAULT_WOOD_MATERIAL: PhongMaterialProps = {
  ambient: 0.92,
  diffuse: 1,
  shininess: 14,
  specularColor: [36, 36, 34]
};
/**
 * How the passes of leaves in the air draw: the depth of their share of each pixel, and then over what is behind them,
 * by how much of a pixel a leaf covers, with no depth.
 */
const AIR_PARAMETERS = {
  depth: {
    depthWriteEnabled: true,
    blend: true,
    blendColorOperation: 'add',
    blendColorSrcFactor: 'zero',
    blendColorDstFactor: 'one',
    blendAlphaOperation: 'add',
    blendAlphaSrcFactor: 'zero',
    blendAlphaDstFactor: 'one'
  },
  blend: {
    depthWriteEnabled: false,
    blend: true,
    blendColorOperation: 'add',
    blendColorSrcFactor: 'src-alpha',
    blendColorDstFactor: 'one-minus-src-alpha',
    blendAlphaOperation: 'add',
    blendAlphaSrcFactor: 'one',
    blendAlphaDstFactor: 'one-minus-src-alpha'
  }
} as const;

const DEFAULT_FOLIAGE_MATERIAL: PhongMaterialProps = {
  ambient: 0.9,
  diffuse: 1,
  shininess: 64,
  specularColor: [110, 118, 104]
};

/**
 * Length, in pixels, that a leaf keeps on screen across the levels of detail, where the budget allows: as a
 * tree gets smaller the count of leaves falls and each grows, in steps of four and two.
 */
const LOD_LEAF_PIXELS = 7;
/**
 * Leaf vertices one frame should draw. A view asking for more makes every far leaf longer alike until it fits,
 * so a grove of any size stays interactive, and a view with few trees spends all it can on them. Depends only
 * on the view, so a frame looks the same however it was reached. `lodBias` applies on top.
 */
const LOD_VERTEX_BUDGET = 20e6;
const LOD_COARSE_CORNERS = 6;
/** How much longer than natural, at most, a leaf is drawn on a tree short of full detail for its size on screen. */
const LOD_LEAF_STRETCH = 1.3;
/**
 * The corners of the finer blades, how many far leaf vertices one costs as much as, and about what share of a
 * tree's leaves take each, for each time its nearest leaves are as long on screen as that blade asks.
 */
const LOD_FINE_CORNERS = 23;
const LOD_MACRO_CORNERS = 170;
const LOD_NEAR_CORNER_COST = 2;
const LOD_FINE_SHARE = 0.15;
const LOD_MACRO_SHARE = 0.1;
/**
 * The fine blade for a leaf at least this long on screen, and the macro blade from where the fine blade's
 * polygons would start to show, neither below their floors at any `lodBias`.
 */
const LOD_FINE_PIXELS = 32;
const LOD_FINE_FLOOR_PIXELS = 10;
const LOD_MACRO_PIXELS = 90;
const LOD_MACRO_FLOOR_PIXELS = 28;
/** Leaves are on a list from this fraction of the size they take a blade at, as a margin for the list's age. */
const LOD_BLADE_MARGIN = 0.8;
/** A list holds until the camera has gone this much of the way its margin allows. */
const LOD_BLADE_MOVE = 0.6;
/** The longest leaf of a template, as a multiple of its mean. */
const LOD_LONGEST_LEAF = 1.8;
/** The levels below this much crown go on thinning inside LOD 3. */
const LOD_MAX = 4;
const FIRST_SHELL_LEVEL = 4;
const CANOPY_LEVEL_COUNT = 8;
// Crown diameter in CSS pixels. Fine leaf blades still use their own per-leaf size.
const SHELL_DIAMETERS = [64, 28, 12, 5] as const;
/** Past this reach of the wind, in metres, a leaf may come so much nearer the camera than its tree's bound says. */
const LOD_WIND_NEAR_METRES = 0.3;
/** A larger change than this, in `leafDetail`, is worth a state upload. */
const LOD_DETAIL_EPSILON = 0.003;
/** Trees this many heights beyond the frustum stay for the shadows they cast into the view. */
const SHADOW_CULL_MARGIN_HEIGHTS = 3;
const LOD_FLOATS_PER_ROW = TREE_STATE_TEXELS_PER_ROW * 4;
const METRES_PER_DEGREE = 111320;
/** A crop's radius on screen, in pixels, at which its points are shaded by the pixel, then thinned. */
const CROP_DOT_PIXELS: readonly number[] = [7, 0.7, 0.35, 0.18];
/** A blossom's points are never shaded by the pixel, and a little way off a cluster is one point. */
const CROP_DOT_PIXELS_FLOWER: readonly number[] = [Infinity, 1.6, 0.7, 0.35];
/** The level of detail of the first point, and so of `CROP_DOT_PIXELS[0]`. */
const CROP_FIRST_DOT_LEVEL = 2;
/** Of the radius a tree is culled by, how far out its crown's surface is. */
const CROP_SURFACE_FRACTION = 0.72;
/** Nearer than this a crop is as large on screen as it gets. */
const CROP_NEAREST_METRES = 0.05;
/** How far past a boundary, as a fraction of it, a crop level holds on, so it does not flicker. */
const CROP_LEVEL_HOLD = 0.1;
/** Points one frame should draw. As with leaves, a view asking for more thins them all alike. */
const CROP_POINT_BUDGET = 4e5;
/** A tree can draw a mesh for a crop this fraction of the size it takes one at. A margin for a list out of date. */
const CROP_NEAR_MARGIN = 0.92;
/** How far a crop can be from its twig on the tree, or lie from it on the ground, in metres. */
const CROP_NEAR_REACH = 0.3;
const CROP_NEAR_REACH_FALLEN = 1.3;
const CROP_NEAR_REACH_PETAL = 3.2;
const CROP_NEAR_BEYOND_CROWN = 3;
/**
 * The lists are worked out again after a change in size by this fraction, and after the camera has moved by
 * this much of the way the margin above allows.
 */
const CROP_NEAR_SIZE_HOLD = 0.04;
const CROP_NEAR_MOVE = 0.6;
/** Added to the slot, in the code of an instance. */
const CROP_CODE_DROPPED = 2;
const CROP_CODE_OFF_TWIG = 4;

const DEFAULT_CROP_MATERIAL: PhongMaterialProps = {
  ambient: 0.9,
  diffuse: 1,
  shininess: 14,
  specularColor: [46, 44, 40]
};
const CROP_MATERIALS: Partial<Record<CropKind, PhongMaterialProps>> = {
  fruit: {ambient: 0.92, diffuse: 1, shininess: 170, specularColor: [255, 250, 242]},
  lemon: {ambient: 0.92, diffuse: 1, shininess: 150, specularColor: [255, 250, 242]},
  flower: {ambient: 0.95, diffuse: 1, shininess: 42, specularColor: [190, 190, 180]}
};
const NO_CROP_ROWS: never[] = [];
type TreeSource<DataT> = {
  object: DataT;
  index: number;
  /** Its row in the state store and the state texture. */
  stateRow: number;
  type: TreeType;
  position: [number, number, number];
  seed: number;
  characteristics: TreeCharacteristics;
  morphologyKey: string;
  height: number;
  fraction: number;
  fractionAuthored: boolean;
  radius: number;
  trunkRadius: number;
  season: Season;
  winter: boolean;
  levels: number;
  windStrength?: number;
  trunkColor?: Color | null;
  canopyColor?: Color | null;
  crops: CropConfig[];
  /** The state row's crop slot of each of `crops`: a kind keeps the slot it has. */
  cropSlots: number[];
  sizeScale: number;
  growth: number;
  health: number;
  foliage: number;
  flush: number;
  leanDegrees: number;
  leanBearing: number;
  damage: number;
  decay: number;
};

function getTreeTemplateKey(source: TreeSource<unknown>): string {
  const {type, morphologyKey, levels} = source;
  return type === 'pine' ? `${type}-${levels}-${morphologyKey}` : `${type}-${morphologyKey}`;
}

const PALM_TEMPLATES = new Map<number, TreeGrowthModel>();

function getTreeTemplate(source: TreeSource<unknown>): TreeGrowthModel {
  const {type, levels, characteristics} = source;
  if (isTreeGrowthSpecies(type)) return getTreeGrowthModel(type, characteristics);
  if (type === 'pine') return createPineGrowthModel(levels, characteristics);
  const seed = characteristics.seed ?? 1;
  let template = PALM_TEMPLATES.get(seed);
  if (!template) {
    template = createPalmGrowthModel(seed);
    if (PALM_TEMPLATES.size >= 16) PALM_TEMPLATES.delete(PALM_TEMPLATES.keys().next().value!);
    PALM_TEMPLATES.set(seed, template);
  }
  return template;
}

/** A tree on the photoreal path. A row keeps its identity while only its numbers change. */
type PhotorealRow<DataT> = {
  object: DataT;
  stateRow: number;
  groupKey: string;
  cropKinds: string;
  /** Anchor the projection below was computed for, and the projection's key. */
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  projectionKey: string;
  common: number[];
  units: number[];
  frame: number[] | null;
  /** Level of detail before the budget, leaf length in pixels, and `-1` when not even near the view. */
  level: number;
  shellLevel: number;
  visible: boolean;
  /** Geometry bounds are independent of the camera and stay cached while only it moves. */
  bounds: {
    center: number[];
    radius: number;
    cullRadius: number;
    margin: number;
    wind: number;
    reach: number;
  } | null;
  leafPixels: number;
  /** Pixels per metre on screen of a crop on the crown's surface, the nearest it could be to the camera. */
  pixelsPerMeter: number;
  /** And of a crop in the middle of the crown, which decides how many far crops are worth drawing. */
  middlePixelsPerMeter: number;
  /** Pixels per metre of a crop a metre from the camera, or 0 in an orthographic view. */
  focalPixels: number;
  /** The camera in this tree's own metres, or null with no single camera to measure crops from. */
  camera: [number, number, number] | null;
  /** What its two crop slots hold in their buckets. */
  crops: [PhotorealCropSlot, PhotorealCropSlot];
  /** Leaves near enough to the camera for the fine and macro blades, and where the camera was for those lists. */
  fineLeaves: number[];
  macroLeaves: number[];
  bladesFrom: [number, number, number] | null;
  /** Screen thresholds and tree shape the lists were built from. */
  bladesShape: number[];
  /** Conservative camera-visible clusters, plus the original prefix needed by the shadow pass. */
  leafSelection: TreeLeafSelection | null;
  /** Transformed common-space cluster spheres, reused for camera-only changes. */
  leafBounds: {key: string; spheres: Float64Array} | null;
  useListedLeaves: boolean;
};

/** One crop slot of a tree on the photoreal path, as its instances stand. */
type PhotorealCropSlot = {
  kind: CropKind | null;
  /** Level of detail, or -1 when nothing of it is drawn. */
  level: number;
  /** Instances for attached crops. A tree's rows are rebuilt only when this changes. */
  attached: TreeCropCapacity;
  /** Instances for crops supplied as dropped. */
  dropped: number;
  /**
   * The crops close enough to the camera for each mesh level, as `[crop index, slot code]` pairs. All crops of
   * a tree have a point, in the bucket of `level`. Only those that can be large on screen have a mesh.
   */
  near: [number[], number[]];
  /** The camera, in this tree's metres, that `near` was worked out for. */
  nearFrom: [number, number, number] | null;
  /** The size on screen it allowed for, in metres times its focal scale, and whether crops had fallen. */
  nearScale: number;
  nearFallen: boolean;
};

/** All the crop instances of one kind and level of detail, of one template. */
type PhotorealCropBucket<DataT> = {
  kind: CropKind;
  level: number;
  data: TreeCropData<DataT>;
  /** Its members changed since `data` was built. */
  dirty: boolean;
  /** Some of its crops have fallen, or were supplied that way. */
  shedding: boolean;
};

/** All trees of one template. Buckets are the rows of each level of detail. */
type PhotorealGroup<DataT> = {
  key: string;
  model: TreeGrowthModel;
  species: TreeType;
  /** Mean leaf length of the template, in metres at `referenceHeight`. */
  meanLeaf: number;
  /** The shortest leaf limits how far the camera can move before a list misses a blade. */
  shortestLeaf: number;
  /** Mature template reach in crown radii and heights, and maximum blade length in metres. */
  envelope: {crown: number; height: number; blade: number};
  rows: PhotorealRow<DataT>[];
  /** Rows of each level of detail, for leaves and for wood, which can be coarser inside a full crown. */
  slots: SplatRowSlots<PhotorealRow<DataT>>[];
  buckets: PhotorealRow<DataT>[][];
  woodSlots: SplatRowSlots<PhotorealRow<DataT>>[];
  woodBuckets: PhotorealRow<DataT>[][];
  shadowSlots: SplatRowSlots<PhotorealRow<DataT>>;
  shadowBucket: PhotorealRow<DataT>[];
  stemSlots: SplatRowSlots<PhotorealRow<DataT>>;
  stemBucket: PhotorealRow<DataT>[];
  /** Rows of LOD 0 that are losing leaves, whose leaves in the air a pass of their own draws, and if it ever had any. */
  airSlots: SplatRowSlots<PhotorealRow<DataT>>;
  airBucket: PhotorealRow<DataT>[];
  airUsed: boolean;
  /** The leaves that draw the finer blades, of all rows, and whether that has changed since this data. */
  fineData: TreeLeafData<DataT>;
  macroData: TreeLeafData<DataT>;
  coarseData: TreeLeafData<DataT>;
  /** Full-tree LOD 0 rows that cannot use the conservative upright-leaf bounds. */
  coarseSlots: SplatRowSlots<PhotorealRow<DataT>>;
  coarseBucket: PhotorealRow<DataT>[];
  coarseShadowCount: number;
  coarseShadowInstances: number;
  bladesDirty: boolean;
  /** Of the leaves at LOD 0, the largest share that any tree casts. */
  shadowShare: number;
  /** A level that has held trees keeps its sub-layer, so moving between levels never builds a model. */
  used: boolean[];
  woodUsed: boolean[];
  fineUsed: boolean;
  macroUsed: boolean;
  /** Crop buckets that have held crops, by kind and level. They keep their sub-layers, as levels do. */
  crops: Map<string, PhotorealCropBucket<DataT>>;
};

type PhotorealState<DataT> = {
  rows: (PhotorealRow<DataT> | undefined)[];
  groups: Map<string, PhotorealGroup<DataT>>;
  windOrigin: [number, number];
  windUnits: [number, number];
  /** What crops' size on screen counts for, from `lodBias` and the budget. */
  cropPixelScale: number;
  /** The `leafBlades` uniform of this view: on-screen sizes of the finer blades, and pixels at a metre. */
  leafBlades: [number, number, number, number];
  /** The length a far leaf keeps on screen in this view, in pixels, from `lodBias` and the budget. */
  leafTarget: number;
};

type TreeState<DataT> = {
  authoredWindStrength: number;
  hasAuthoredWind: boolean;
  hasDefaultWind: boolean;
  /** `windDirection` as a vector, whose identity sub-layers see as a prop of theirs. */
  windBearing: number | null | undefined;
  windVector: [number, number] | null;
  store: TreeStateStore | null;
  /** The kind in each crop slot, two per state row. A kind stays while its crops animate out. */
  cropKinds: (CropKind | null)[];
  /** Latest values read from tree accessors. */
  sources: TreeSource<DataT>[];
  /** Source data changes even when the derived instance arrays keep their identities. */
  sourceDataRevision: number;
  /** RGBA32F copy of `store.data`, read by the photoreal layers. */
  stateTexture: Texture | null;
  /** Tweens are running or loss rates are draining: update again next frame. */
  ticking: boolean;
  photoreal: PhotorealState<DataT> | null;
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
  'getGrowth',
  'getHealth',
  'getFoliage',
  'getFlush',
  'getLean',
  'getDamage',
  'getDecay',
  'sizeScale',
  'characteristics'
] as const;

/** Accessors that only update state values. */
const STORE_ONLY_PROPS = ['getTrunkColor', 'getCanopyColor', 'getCoverageWeight'] as const;

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

// Sub-layer data derived from state keeps its identity until the state rows change: a new array
// makes deck.gl rewrite every attribute of that sub-layer, e.g. whenever any TreeLayer prop changes.
function getFiniteValue(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function getUnitValue(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, getFiniteValue(value, fallback)));
}

/** The green a crop is before it ripens, when none was given: darker, and toward leaf green. */
function getUnripeColor(color: ArrayLike<number>): Color {
  return [
    (color[0] * 0.35 + 86 * 0.65) | 0,
    (color[1] * 0.3 + 128 * 0.7) | 0,
    (color[2] * 0.3 + 44 * 0.7) | 0
  ];
}

function getWindVector(bearing: number | null | undefined): [number, number] | null {
  if (typeof bearing !== 'number' || !Number.isFinite(bearing)) return null;
  const radians = (bearing * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

/** Metres per unit of layer position, about a place. */
function getWindUnits(props, origin: ArrayLike<number>, viewport?: Viewport): [number, number] {
  const {coordinateSystem} = props;
  const lngLat =
    coordinateSystem === COORDINATE_SYSTEM.LNGLAT ||
    coordinateSystem === COORDINATE_SYSTEM.LNGLAT_OFFSETS ||
    (coordinateSystem === COORDINATE_SYSTEM.DEFAULT && viewport?.isGeospatial);
  return lngLat
    ? [METRES_PER_DEGREE * Math.cos((origin[1] * Math.PI) / 180), METRES_PER_DEGREE]
    : [1, 1];
}

/** Stable across a canopy's changes of pose, and one function so it is not a change of prop. */
function getCropConfigs(crop: CropConfig | readonly CropConfig[] | null | undefined): CropConfig[] {
  if (!crop) return [];
  const list = (Array.isArray(crop) ? crop : [crop]) as CropConfig[];
  // A radius of 0 draws nothing, but it is still that crop: it keeps its slot for a radius on the way up.
  return list.slice(0, 2).filter(config => config && Number.isFinite(config.radius));
}

/**
 * The level of detail of the points of a crop `radius` metres across. Whether it is shaded by the pixel
 * follows its size at the nearest of the crown, as a near one must not look flat. How many are drawn follows
 * its size at the middle.
 */
function getCropDotLevel(
  kind: CropKind,
  radius: number,
  row: PhotorealRow<unknown>,
  pixelScale: number,
  previous: number
): number {
  const thresholds = kind === 'flower' ? CROP_DOT_PIXELS_FLOWER : CROP_DOT_PIXELS;
  const nearest = radius * row.pixelsPerMeter * pixelScale;
  const pixels =
    nearest >= thresholds[0]
      ? nearest
      : Math.min(nearest, radius * row.middlePixelsPerMeter * pixelScale);
  let step = 0;
  while (step < thresholds.length && pixels < thresholds[step]) step++;
  const level = CROP_FIRST_DOT_LEVEL + step;
  // Near a boundary it stays where it was.
  if (previous === level + 1 && pixels < thresholds[step] * (1 + CROP_LEVEL_HOLD)) return previous;
  if (previous === level - 1 && pixels >= thresholds[step - 1] * (1 - CROP_LEVEL_HOLD)) {
    return previous;
  }
  return Math.min(level, TREE_CROP_LEVEL_COUNT - 1);
}

/**
 * The length on screen that a tree's leaves are drawn at, given their natural length there. Under budget pressure
 * (0 for none) far leaves grow to a common length, and those a little too large for that grow by as much as leaves
 * of a tree differ anyway, which can't be seen and takes a third of what they cost. Those long enough to take a
 * finer blade stay as they are.
 */
function getTreeLeafLength(
  natural: number,
  wanted: number,
  finePixels: number,
  pressure: number
): number {
  const stretch = Math.min(LOD_LEAF_STRETCH, 2 ** (pressure * 0.5));
  const room = Math.max(Math.min((finePixels - natural) / (finePixels * 0.3), 1), 0);
  return Math.max(wanted * 2 ** pressure, natural * (1 + (stretch - 1) * room));
}

/**
 * How much pressure it takes for all of a view's leaves to fit in a budget of vertices, given the size each tree's
 * leaves have at their own size on screen and how many it has, in pairs. A tree's count falls with the square of
 * how much longer its leaves are than that, to a limit.
 */
function getTreeLeafPressure(
  sized: readonly number[],
  wanted: number,
  finePixels: number,
  budget: number
): number {
  const cost = (pressure: number): number => {
    let vertices = 0;
    for (let i = 0; i < sized.length; i += 2) {
      const ratio = sized[i] / getTreeLeafLength(sized[i], wanted, finePixels, pressure);
      vertices += sized[i + 1] * LOD_COARSE_CORNERS * Math.max(ratio * ratio, 4 ** -LOD_MAX);
    }
    return vertices;
  };
  if (cost(0) <= budget) return 0;
  let low = 0;
  let high = 8;
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) * 0.5;
    if (cost(middle) > budget) low = middle;
    else high = middle;
  }
  return high;
}

/** Pixels on screen of something a metre long, a metre from the camera on its axis, or 0 in an orthographic view. */
function getLeafFocalPixels(view: Viewport): number {
  const matrix = view.viewProjectionMatrix as number[];
  const reach = Math.hypot(matrix[3], matrix[7], matrix[11]);
  if (!(reach > 1e-9) || view.projectionMatrix[11] === 0) return 0;
  return (Math.hypot(matrix[1], matrix[5], matrix[9]) * view.height * 0.5) / reach;
}

/** The camera in a tree's own metres: east, north and up from its base, before its yaw. */
/** The fractional part of a value. */
function getFraction(value: number): number {
  return value - Math.floor(value);
}

/** The camera in a tree's own metres, turned back by its lean about the point on the ground it tips over. */
function getTreeCameraBeforeLean(
  camera: readonly [number, number, number],
  data: Float32Array,
  base: number
): readonly [number, number, number] {
  const {POSE, MISC, LIFE} = TREE_STATE_TEXEL;
  const lean = data[base + POSE * 4];
  if (!(lean > 0)) return camera;
  const direction = data[base + POSE * 4 + 1];
  const directionX = Math.cos(direction);
  const directionY = Math.sin(direction);
  const plate =
    TREE_ROOT_PLATE_RADII * data[base + MISC * 4] * getTreeRingRadius(1, 0, data[base + LIFE * 4]);
  const x = camera[0] - directionX * plate;
  const y = camera[1] - directionY * plate;
  const z = camera[2];
  const axisX = -directionY;
  const axisY = directionX;
  const cosine = Math.cos(lean);
  const sine = Math.sin(lean);
  const along = (axisX * x + axisY * y) * (1 - cosine);
  return [
    directionX * plate + x * cosine - axisY * z * sine + axisX * along,
    directionY * plate + y * cosine + axisX * z * sine + axisY * along,
    z * cosine - (axisX * y - axisY * x) * sine
  ];
}

function getCropCamera(row: PhotorealRow<unknown>, view: Viewport): [number, number, number] {
  const {cameraPosition: camera} = view;
  const {common, units, frame} = row;
  const x = camera[0] - common[0];
  const y = camera[1] - common[1];
  const z = camera[2] - common[2];
  return frame
    ? [
        (x * frame[0] + y * frame[1] + z * frame[2]) / units[0],
        (x * frame[3] + y * frame[4] + z * frame[5]) / units[1],
        (x * frame[6] + y * frame[7] + z * frame[8]) / units[2]
      ]
    : [x / units[0], y / units[1], z / units[2]];
}

/**
 * What the shaders know of a slot from an instance: which slot it is, and whether this crop takes the next
 * twig along, as the second of two that would otherwise hang in the same place. A blossom has room for a
 * fruit at its twig, as they do in a real tree.
 */
function getCropCode(row: PhotorealRow<unknown>, slot: number): number {
  const [first, second] = row.crops;
  const overlaps =
    slot === 1 &&
    first.kind &&
    second.kind &&
    (first.kind === 'flower') === (second.kind === 'flower');
  return slot + (overlaps ? CROP_CODE_OFF_TWIG : 0);
}

function createPhotorealCropSlot(): PhotorealCropSlot {
  return {
    kind: null,
    level: -1,
    attached: {capacity: 0, byBirth: false},
    dropped: 0,
    near: [[], []],
    nearFrom: null,
    nearScale: 0,
    nearFallen: false
  };
}

function isSameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether a sub-layer's picking colors encode a tree's state row, not one of its own rows. */
function isStateRowPicked(layer: unknown): boolean {
  return (
    layer instanceof TreePhotorealCropLayer ||
    (layer instanceof TreePhotorealLeafLayer &&
      (layer.props as {lod: number; blade?: string}).blade !== undefined)
  );
}

/** Binary attribute data for the leaves of the macro blade: `[tree row, leaf index]` for each. */
function createLeafData<DataT>(
  value: Float32Array,
  rows: readonly (PhotorealRow<DataT> | undefined)[]
): TreeLeafData<DataT> {
  const length = value.length / 2;
  return {
    length,
    attributes: {instanceLeafRef: {value, size: 2}},
    *[Symbol.iterator]() {
      for (let instance = 0; instance < length; instance++) {
        yield rows[value[instance * 2]] as unknown as DataT;
      }
    }
  };
}

/**
 * Binary attribute data for crop instances. deck.gl uploads the array as it is. An accessor of an extension
 * reads rows by iterating, so it gets the tree each crop belongs to.
 */
function createCropData<DataT>(
  value: Float32Array,
  rows: readonly (PhotorealRow<DataT> | undefined)[]
): TreeCropData<DataT> {
  const length = value.length / 3;
  return {
    length,
    attributes: {instanceCropRef: {value, size: 3}},
    *[Symbol.iterator]() {
      for (let instance = 0; instance < length; instance++) {
        yield rows[value[instance * 3]] as unknown as DataT;
      }
    }
  };
}

/**
 * Instanced botanical trees with growth, seasons, wind and projected levels of detail.
 * Supports translation-only model matrices in Cartesian and metre-offset coordinates.
 */
export class TreeLayer<DataT = unknown, ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_TreeLayerProps<DataT>>
> {
  static layerName = 'TreeLayer';
  static defaultProps = defaultProps;
  declare state: TreeState<DataT>;

  /** Reused, one shape, for all `setRow` calls of the accessor path. */
  private rowUpdate: TreeStateUpdate = {};
  private rowOptions = {now: 0, clock: 0, isNew: false};
  /** Reused for the per-camera `leafDetail` writes, which change nothing else. */
  private detailUpdate: TreeStateUpdate = {leafDetail: 1};

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
      windBearing: null,
      windVector: null,
      store: null,
      cropKinds: [],
      sources: [],
      sourceDataRevision: 0,
      stateTexture: null,
      ticking: false,
      photoreal: null
    };
  }

  shouldUpdateState({changeFlags}: UpdateParameters<this>): boolean {
    return changeFlags.somethingChanged || this.state.ticking;
  }

  /**
   * Running tweens update the layer on every frame, as a uniform transition does. LayerManager clears
   * `setNeedsUpdate` at the end of its update, in which `updateState` runs, and asks only this.
   */
  hasUniformTransition(): boolean {
    return this.state?.ticking || super.hasUniformTransition();
  }

  updateState({props, oldProps, changeFlags}) {
    const dataChanged = Boolean(changeFlags.dataChanged);
    if (dataChanged) this.state.sourceDataRevision++;
    const triggers = changeFlags.updateTriggersChanged;
    const placementChanged =
      props.coordinateSystem !== oldProps.coordinateSystem ||
      !_deepEqual(props.coordinateOrigin, oldProps.coordinateOrigin, 1) ||
      !_deepEqual(props.modelMatrix, oldProps.modelMatrix, 1);
    const accessorChanged = (key: string) =>
      (typeof props[key] !== 'function' && props[key] !== oldProps[key]) ||
      triggers === true ||
      triggers?.all ||
      triggers?.[key];
    this.updateWithStore(
      props,
      dataChanged ||
        GEOMETRY_PROPS.some(accessorChanged) ||
        STORE_ONLY_PROPS.some(accessorChanged) ||
        !this.state.store ||
        (this.state.hasAuthoredWind && props.windStrength !== oldProps.windStrength),
      Boolean(changeFlags.viewportChanged) ||
        props.lodBias !== oldProps.lodBias ||
        props._leafCulling !== oldProps._leafCulling ||
        props._stableLeafShadows !== oldProps._stableLeafShadows ||
        props._cropOnly !== oldProps._cropOnly ||
        props.windStrength !== oldProps.windStrength ||
        props.shadowEnabled !== oldProps.shadowEnabled,
      placementChanged
    );
  }

  finalizeState(context: Parameters<CompositeLayer['finalizeState']>[0]): void {
    this.releaseStore();
    super.finalizeState(context);
  }

  private releaseStore(): void {
    this.state?.stateTexture?.destroy();
    if (this.state) {
      this.state.stateTexture = null;
      this.state.store = null;
      this.state.photoreal = null;
      this.state.ticking = false;
    }
  }

  /** Runs the accessors of every row once. */
  private readTreeSources(props): TreeSource<DataT>[] {
    const defaultCharacteristics = resolveTreeCharacteristics(props.characteristics);
    const defaultCharacteristicsKey = getTreeCharacteristicsKey(defaultCharacteristics);
    const sources: TreeSource<DataT>[] = [];
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
      const authored = tree.species !== undefined || !isDefaultTreeAccessor(props, 'getTreeType');
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
      const fractionAuthored =
        tree.trunkHeightFraction !== undefined ||
        !isDefaultTreeAccessor(props, 'getTrunkHeightFraction');
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
      // Broadleaf accessors historically use twice the physical crown radius.
      const canopyScale = type === 'pine' || type === 'palm' ? 1 : 2;
      const radius =
        (getFiniteDimension(
          value<number>(
            'getCanopyRadius',
            tree.crownRadius !== undefined || authored
              ? (tree.crownRadius ?? (height / (sizeScale || 1)) * proportions[1]) * canopyScale
              : undefined
          ),
          3
        ) *
          sizeScale) /
        canopyScale;
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
              1,
              getFiniteDimension(
                typeof tree.wind === 'boolean' ? (tree.wind ? 0.025 : 0) : tree.wind,
                0
              )
            );
      const lean = value<TreeLean>('getLean', tree.lean);
      const crops = getCropConfigs(
        value<CropConfig | readonly CropConfig[] | null>('getCrop', tree.crop)
      );
      sources.push({
        object,
        index: objectInfo.index,
        stateRow: sources.length,
        type,
        position: [position[0], position[1], Number.isFinite(elevation) ? elevation : 0],
        seed,
        characteristics,
        morphologyKey,
        height,
        fraction,
        fractionAuthored,
        radius,
        trunkRadius:
          getFiniteDimension(
            value<number>(
              'getTrunkRadius',
              tree.trunkRadius ??
                (authored ? (height / (sizeScale || 1)) * proportions[3] : undefined)
            ),
            0.5
          ) * sizeScale,
        season,
        winter,
        levels,
        windStrength,
        trunkColor: tree.trunkColor,
        canopyColor: tree.canopyColor,
        crops,
        cropSlots: crops.map((_, slot) => slot),
        sizeScale,
        growth: getUnitValue(value<number>('getGrowth', tree.growth), 1),
        health: getUnitValue(value<number>('getHealth', tree.health), 1),
        foliage: getUnitValue(value<number>('getFoliage', tree.foliage), 1),
        flush: getUnitValue(value<number>('getFlush', tree.flush), 0),
        leanDegrees: Math.max(0, Math.min(90, getFiniteValue(lean?.[0], 0))),
        leanBearing: getFiniteValue(lean?.[1], 0),
        damage: getUnitValue(value<number>('getDamage', tree.damage), 0),
        decay: getUnitValue(value<number>('getDecay', tree.decay), 0)
      });
    }
    return sources;
  }

  private updateWithStore(
    props,
    accessorsChanged: boolean,
    viewChanged: boolean,
    placementChanged: boolean
  ): void {
    const timeline = this.context?.timeline;
    const now = timeline ? timeline.getTime() : 0;
    const clock = typeof props.windTime === 'number' ? props.windTime : now / 1000;
    let store = this.state.store;
    const firstRead = !store;
    if (!store) store = this.state.store = new TreeStateStore();
    store.setTransitions(props.transitions);

    let regrouped = false;
    let sources = this.state.sources;
    if (accessorsChanged || firstRead) {
      const previous = sources;
      sources = this.readTreeSources(props);
      // A tree tweening to another place is the same tree, and looks as it did where it started.
      const {getPosition, getTree} = props.transitions ?? {};
      if (getPosition === undefined ? getTree : getPosition) {
        for (const source of sources) source.seed = previous[source.stateRow]?.seed ?? source.seed;
      }
      this.state.sources = sources;
      this.writeStateRows(props, sources, store, now, clock);
      regrouped = this.groupPhotorealRows(props, sources);
    }

    const {photoreal} = this.state;
    const {changed, active} = store.tick(now, clock);
    if (
      photoreal &&
      (viewChanged || placementChanged || accessorsChanged || regrouped || firstRead || changed)
    ) {
      this.updatePhotorealDetail(props, photoreal, store, now, clock, placementChanged);
    }
    this.uploadStateTexture(store);
    // A tween's last tick can still change a bucket, and nothing says to render it once it stops.
    if (changed && photoreal) this.setNeedsUpdate();
    this.state.ticking = active;
  }

  /** Accessor values as targets of the state rows. */
  private writeStateRows(
    props,
    sources: TreeSource<DataT>[],
    store: TreeStateStore,
    now: number,
    clock: number
  ): void {
    const previousCount = store.rowCount;
    store.resize(sources.length);
    const getCoverageWeight = props.getCoverageWeight;
    let maxWind = 0,
      defaultWind = false;
    for (const source of sources) {
      if (source.windStrength === undefined) defaultWind = true;
      else maxWind = Math.max(maxWind, source.windStrength);
    }
    this.state.authoredWindStrength = maxWind;
    this.state.hasAuthoredWind = sources.some(source => source.windStrength !== undefined);
    this.state.hasDefaultWind = defaultWind;
    const models = new Map<string, TreeGrowthModel>();
    const layerWind = getFiniteDimension(props.windStrength, 0);
    const windStrength = Math.max(defaultWind ? layerWind : 0, maxWind);
    const update = this.rowUpdate;
    const options = this.rowOptions;
    options.now = now;
    options.clock = clock;
    const objectInfo = {
      index: -1,
      data: props.data,
      target: []
    } as unknown as AccessorContext<DataT>;
    for (const source of sources) {
      const {type, seed} = source;
      const yawDegrees = (((seed ^ (seed >>> 13)) & 0xffff) / 65535) * 360;
      objectInfo.index = source.index;
      const key = getTreeTemplateKey(source);
      let model = this.state.photoreal?.groups.get(key)?.model ?? models.get(key);
      if (!model) {
        model = getTreeTemplate(source);
        models.set(key, model);
      }
      update.position = source.position;
      update.yaw = (yawDegrees * Math.PI) / 180;
      update.windPhase = (seed / 4294967296) * Math.PI * 2;
      const crown = source.radius;
      update.crownX = crown * (1 + ((seed & 0xffff) / 65535 - 0.5) * 0.2);
      update.crownY = crown * (1 + (((seed >>> 16) & 0xffff) / 65535 - 0.5) * 0.2);
      update.trunkHeight = source.fractionAuthored
        ? source.height * source.fraction
        : model.forkZ * source.height;
      update.leafScale = source.height / model.referenceHeight;
      update.height = source.height;
      update.growth = source.growth;
      update.health = source.health;
      // A bare season has no leaves, however healthy the tree.
      update.foliage = source.winter ? 0 : source.foliage;
      update.flush = source.flush;
      update.leanDegrees = source.leanDegrees;
      update.leanBearing = source.leanBearing;
      update.damage = source.damage;
      update.decay = source.decay;
      update.canopyColor =
        (isDefaultTreeAccessor(props, 'getCanopyColor')
          ? source.canopyColor
          : getTreeAccessorValue(props.getCanopyColor, source.object, objectInfo)) ??
        DEFAULT_CANOPY_COLORS[type][source.season];
      update.trunkColor =
        (isDefaultTreeAccessor(props, 'getTrunkColor')
          ? source.trunkColor
          : getTreeAccessorValue(props.getTrunkColor, source.object, objectInfo)) ??
        DEFAULT_TRUNK_COLORS[type];
      update.trunkRadius = source.trunkRadius;
      update.windFlex = windStrength > 0 ? (source.windStrength ?? layerWind) / windStrength : 1;
      update.coverage = getUnitValue(
        getTreeAccessorValue(getCoverageWeight, source.object, objectInfo) as number,
        1
      );
      update.seed = seed / 4294967296;
      options.isNew = source.stateRow >= previousCount;
      this.assignCropSlots(source, store, options.isNew);
      if (source.crops.length) {
        const slots: (TreeStateCropUpdate | null)[] = [null, null];
        source.crops.forEach((crop, index) => {
          slots[source.cropSlots[index]] = {
            count: crop.count,
            radius: crop.radius * source.sizeScale,
            ripeness: crop.ripeness ?? 1,
            fallen: crop.fallen ?? 0,
            color: crop.color,
            unripeColor: crop.unripeColor ?? getUnripeColor(crop.color),
            dropped: crop.droppedCount ?? 0
          };
        });
        update.crops = slots;
      } else {
        update.crops = null;
      }
      store.setRow(source.stateRow, update, options);
    }
  }

  /**
   * Gives each of a tree's crops its slot. A kind stays in the slot it has, so fruit keeps its anchors when
   * blossom comes or goes. A slot whose kind no longer appears keeps it until its crops have gone.
   */
  private assignCropSlots(source: TreeSource<DataT>, store: TreeStateStore, isNew: boolean): void {
    const kinds = this.state.cropKinds;
    const first = source.stateRow * 2;
    if (kinds.length < first + 2) kinds.length = first + 2;
    if (isNew) {
      kinds[first] = null;
      kinds[first + 1] = null;
    }
    const {crops, cropSlots} = source;
    let taken = 0;
    for (let index = 0; index < crops.length; index++) cropSlots[index] = -1;
    // Those whose kind has a slot already.
    for (let index = 0; index < crops.length; index++) {
      const kind = crops[index].kind ?? 'fruit';
      for (let slot = 0; slot < 2; slot++) {
        if (!(taken & (1 << slot)) && kinds[first + slot] === kind) {
          cropSlots[index] = slot;
          taken |= 1 << slot;
          break;
        }
      }
    }
    const base = source.stateRow * LOD_FLOATS_PER_ROW;
    const isEmpty = (slot: number) => {
      const count = store.data[base + (TREE_STATE_TEXEL.CROP0 + slot * 3) * 4];
      const dropped = store.data[base + TREE_STATE_TEXEL.CROP_DROPPED * 4 + slot];
      return !kinds[first + slot] || (count <= 0 && dropped <= 0);
    };
    // The rest take a free slot, an empty one first, or else one that other crops are leaving.
    for (let index = 0; index < crops.length; index++) {
      if (cropSlots[index] >= 0) continue;
      let slot = !(taken & 1) && isEmpty(0) ? 0 : !(taken & 2) && isEmpty(1) ? 1 : -1;
      if (slot < 0) slot = taken & 1 ? 1 : 0;
      cropSlots[index] = slot;
      taken |= 1 << slot;
    }
    for (let slot = 0; slot < 2; slot++) {
      if (!(taken & (1 << slot)) && isEmpty(slot)) kinds[first + slot] = null;
    }
    for (let index = 0; index < crops.length; index++) {
      kinds[first + cropSlots[index]] = crops[index].kind ?? 'fruit';
    }
  }

  /** Keeps every row and sub-layer data array unless a tree changed template or crop kinds. */
  private groupPhotorealRows(props, sources: TreeSource<DataT>[]): boolean {
    const previous = this.state.photoreal;
    const photoreal: PhotorealState<DataT> = previous ?? {
      rows: [],
      groups: new Map(),
      windOrigin: [0, 0],
      windUnits: [1, 1],
      cropPixelScale: 1,
      leafBlades: [0, 0, 0, 0],
      leafTarget: LOD_LEAF_PIXELS
    };
    this.state.photoreal = photoreal;
    let regroup = !previous || photoreal.rows.length !== sources.length;
    const rows = photoreal.rows;
    if (rows.length !== sources.length) rows.length = sources.length;
    for (const source of sources) {
      const {object, stateRow} = source;
      const groupKey = getTreeTemplateKey(source);
      const cropKinds = `${this.state.cropKinds[stateRow * 2] ?? ''},${this.state.cropKinds[stateRow * 2 + 1] ?? ''}`;
      let row = rows[stateRow];
      if (!row) {
        row = this.getSubLayerRow<PhotorealRow<DataT>>(
          {
            object,
            stateRow,
            groupKey,
            cropKinds,
            anchorX: Number.NaN,
            anchorY: Number.NaN,
            anchorZ: Number.NaN,
            projectionKey: '',
            common: [],
            units: [],
            frame: null,
            shellLevel: -1,
            visible: false,
            bounds: null,
            level: -1,
            leafPixels: 0,
            pixelsPerMeter: 0,
            middlePixelsPerMeter: 0,
            focalPixels: 0,
            camera: null,
            crops: [createPhotorealCropSlot(), createPhotorealCropSlot()],
            fineLeaves: [],
            macroLeaves: [],
            bladesFrom: null,
            bladesShape: [],
            leafSelection: null,
            leafBounds: null,
            useListedLeaves: false
          },
          object,
          source.index
        );
        rows[stateRow] = row;
        regroup = true;
      } else {
        const templateChanged = row.groupKey !== groupKey;
        if (templateChanged) {
          // Crop residency and near anchors belong to the template's crop table.
          row.crops = [createPhotorealCropSlot(), createPhotorealCropSlot()];
        }
        if (templateChanged || row.cropKinds !== cropKinds) {
          row.leafSelection = null;
          row.leafBounds = null;
          row.bladesFrom = null;
          row.fineLeaves = [];
          row.macroLeaves = [];
          row.groupKey = groupKey;
          row.cropKinds = cropKinds;
          row.bounds = null;
          regroup = true;
        }
        row.object = object;
        const owner = (row as unknown as {__source: {object: DataT; index: number}}).__source;
        owner.object = object;
        owner.index = source.index;
      }
    }
    if (!regroup) return false;

    const groups = new Map<string, PhotorealGroup<DataT>>();
    for (const source of sources) {
      const row = rows[source.stateRow];
      if (!row) continue;
      let group = groups.get(row.groupKey);
      if (!group) {
        const known = photoreal.groups.get(row.groupKey);
        group = known ?? this.createPhotorealGroup(row.groupKey, source);
        group.rows = [];
        groups.set(row.groupKey, group);
      }
      group.rows.push(row);
    }
    for (const [key, group] of photoreal.groups) {
      if (!groups.has(key)) group.rows = [];
    }
    photoreal.groups = groups;
    // A tree that came or went takes its crops and near leaves with it.
    for (const group of groups.values()) {
      for (const bucket of group.crops.values()) bucket.dirty = true;
      group.bladesDirty = true;
    }

    // Gust phases are measured from one tree, in metres, so f32 keeps them smooth anywhere on Earth.
    const first = sources.find(source => rows[source.stateRow]);
    if (first) {
      const origin = first.position;
      photoreal.windOrigin = [origin[0], origin[1]];
      photoreal.windUnits = getWindUnits(props, origin, this.context?.viewport);
    }
    return true;
  }

  private createPhotorealGroup(key: string, source: TreeSource<DataT>): PhotorealGroup<DataT> {
    const species = source.type;
    const model = getTreeTemplate(source);
    // Spatial indexing belongs to initial loading, before the first camera enters the crown.
    getTreeLeafClusters(model);
    let total = 0;
    let shortestLeaf = Infinity;
    const envelope = {crown: 1, height: 1, blade: 0};
    const sampled = Math.min(model.leafCount, 512);
    for (let leaf = 0; leaf < model.leafCount; leaf++) {
      const offset = leaf * TREE_LEAF_STRIDE;
      const length = model.leaves[offset + 3];
      envelope.crown = Math.max(
        envelope.crown,
        Math.hypot(model.leaves[offset], model.leaves[offset + 1])
      );
      envelope.height = Math.max(envelope.height, model.leaves[offset + 2]);
      envelope.blade = Math.max(envelope.blade, length);
      if (leaf < sampled) total += length;
      shortestLeaf = Math.min(shortestLeaf, length);
    }
    return {
      key,
      model,
      species,
      meanLeaf: sampled ? total / sampled : 0.1,
      shortestLeaf: sampled ? shortestLeaf : 0,
      envelope,
      rows: [],
      slots: Array.from(
        {length: CANOPY_LEVEL_COUNT},
        () => new SplatRowSlots<PhotorealRow<DataT>>()
      ),
      buckets: Array.from({length: CANOPY_LEVEL_COUNT}, () => []),
      woodSlots: [0, 1, 2, 3].map(() => new SplatRowSlots<PhotorealRow<DataT>>()),
      woodBuckets: [[], [], [], []],
      shadowSlots: new SplatRowSlots<PhotorealRow<DataT>>(),
      shadowBucket: [],
      stemSlots: new SplatRowSlots<PhotorealRow<DataT>>(),
      stemBucket: [],
      airSlots: new SplatRowSlots<PhotorealRow<DataT>>(),
      airBucket: [],
      airUsed: true,
      fineData: createLeafData<DataT>(new Float32Array(0), []),
      macroData: createLeafData<DataT>(new Float32Array(0), []),
      coarseData: createLeafData<DataT>(new Float32Array(0), []),
      coarseSlots: new SplatRowSlots<PhotorealRow<DataT>>(),
      coarseBucket: [],
      coarseShadowCount: 0,
      coarseShadowInstances: 0,
      bladesDirty: false,
      shadowShare: TREE_LEAF_SHADOW_SHARE,
      // Compile every leaf and wood variant while the template first loads. Waiting for a camera to
      // enter each level otherwise puts a synchronous program link on that hand-off frame. Empty
      // variants retain their model without issuing a draw, so a later dive only changes their rows.
      used: [true, true, true, true, true, true, true, true],
      woodUsed: [true, true, true, true],
      fineUsed: true,
      macroUsed: true,
      crops: new Map()
    };
  }

  /**
   * Levels of detail from each tree's on-screen size. `leafDetail` is continuous, and a bucket ends
   * where the next begins, with the same leaves at the same size, so a change of bucket never pops.
   * Trees outside the view stay while they might cast a shadow into it, at the coarsest level.
   */
  private updatePhotorealDetail(
    props,
    photoreal: PhotorealState<DataT>,
    store: TreeStateStore,
    now: number,
    clock: number,
    placementChanged: boolean
  ): void {
    const viewport = this.context?.viewport;
    if (!viewport) return;
    const views = getSplatQueryViews(viewport, this.context.deck?.getViewports() ?? [viewport]);
    const projectionKey = getSplatProjectionKey(viewport);
    const ownerUnits = views.map(
      view => view === viewport || getSplatProjectionKey(view) === projectionKey
    );
    const frusta = views.map(view =>
      createSplatFrustum({
        matrix: view.viewProjectionMatrix as number[],
        center: [0, 0, 0, 0],
        width: view.width,
        height: view.height
      })
    );
    const horizons = views.map(view => getSplatHorizon(view));
    const data = store.data;
    const shapeChanged = store.isDirty;
    const lodBias = getFiniteValue(props.lodBias, 0);
    const update = this.detailUpdate;
    const options = this.rowOptions;
    options.now = now;
    options.clock = clock;
    options.isNew = false;
    const {SIZE, LIFE, POSE, MISC, DETAIL, ANCHOR_LOW} = TREE_STATE_TEXEL;
    const center = [0, 0, 0];

    // A view with no one camera to measure leaves from has only the coarse blade.
    const biasScale = 2 ** lodBias;
    const focal = views.length === 1 ? getLeafFocalPixels(views[0] as Viewport) : 0;
    const layerWind = getFiniteDimension(props.windStrength, 0);
    const finePixels = focal > 0 ? Math.max(LOD_FINE_PIXELS * biasScale, LOD_FINE_FLOOR_PIXELS) : 0;
    const macroPixels =
      focal > 0 ? Math.max(LOD_MACRO_PIXELS * biasScale, LOD_MACRO_FLOOR_PIXELS) : 0;

    // First the size of every tree on screen, and what it would all cost.
    const sized: number[] = [];
    let nearVertices = 0;
    let cropVertices = 0;
    for (const group of photoreal.groups.values()) {
      const {leafCount} = group.model;
      for (const row of group.rows) {
        const base = row.stateRow * LOD_FLOATS_PER_ROW;
        const x = data[base] + data[base + ANCHOR_LOW * 4];
        const y = data[base + 1] + data[base + ANCHOR_LOW * 4 + 1];
        const z = data[base + 2] + data[base + ANCHOR_LOW * 4 + 2];
        const projectionChanged =
          placementChanged ||
          row.anchorX !== x ||
          row.anchorY !== y ||
          row.anchorZ !== z ||
          row.projectionKey !== projectionKey;
        if (projectionChanged) {
          row.anchorX = x;
          row.anchorY = y;
          row.anchorZ = z;
          row.projectionKey = projectionKey;
          row.common = this.projectPosition([x, y, z], {viewport, autoOffset: false}) as number[];
          row.units = getSplatCommonUnits(row.common, viewport) as number[];
          row.frame = getSplatTangentFrame(row.common, viewport);
        }
        const crownX = data[base + SIZE * 4];
        const crownY = data[base + SIZE * 4 + 1];
        const height = data[base + SIZE * 4 + 2];
        const growth = data[base + LIFE * 4];
        const lean = data[base + POSE * 4];
        const damage = data[base + POSE * 4 + 2];
        const windFlex = data[base + MISC * 4 + 1];
        const leafScale = data[base + MISC * 4 + 3];
        const foliage = data[base + LIFE * 4 + 2];
        const unit = Math.max(row.units[0], row.units[1], row.units[2]);
        if (!row.bounds || shapeChanged || projectionChanged || row.bounds.wind !== layerWind) {
          const heightFraction = getTreeHeightFraction(growth);
          const trunkHeight = data[base + SIZE * 4 + 3];
          const {forkZ} = group.model;
          // Early wood grows in template space. A higher fork stretches its young stem before the
          // tree reaches full height, so include the same piecewise height mapping as the shader.
          let liveHeight = height * heightFraction;
          if (heightFraction < 1 && trunkHeight > height * forkZ) {
            liveHeight =
              heightFraction < forkZ
                ? (heightFraction / forkZ) * trunkHeight
                : trunkHeight + ((heightFraction - forkZ) / (1 - forkZ)) * (height - trunkHeight);
          }
          const crown = Math.max(crownX, crownY) * getTreeCrownFraction(growth);
          // Upright trees are tight around the crown; others need room for what they threw on the ground.
          const upright = lean === 0 && damage === 0 && foliage === 1;
          const lift = upright ? liveHeight * 0.5 : 0;
          const windReach = layerWind * windFlex * liveHeight;
          const metres =
            (upright ? Math.hypot(crown, liveHeight * 0.5) * 1.1 : (liveHeight + crown) * 1.25) +
            windReach;
          center[2] = lift;
          const radius = metres * unit;
          const {envelope} = group;
          const blade = envelope.blade * leafScale;
          const cullRadius = Math.max(
            radius,
            (Math.hypot(crown * envelope.crown, liveHeight * envelope.height - lift) +
              blade +
              windReach * 2) *
              unit
          );
          row.bounds = {
            center: offsetSplatCommonPosition(row.common, center, row.units, row.frame),
            radius,
            cullRadius,
            margin: cullRadius + liveHeight * SHADOW_CULL_MARGIN_HEIGHTS * unit,
            wind: layerWind,
            reach: windReach
          };
        }
        const {center: middle, radius, cullRadius, margin, reach: windReach} = row.bounds;
        const hasCrops = Boolean(
          this.state.cropKinds[row.stateRow * 2] || this.state.cropKinds[row.stateRow * 2 + 1]
        );
        const crownScale = (Math.max(crownX, crownY) * 2) / biasScale;
        let visible = false;
        let near = false;
        let pixelsPerMeter = 0;
        let cropPixelsPerMeter = 0;
        let nearestPixelsPerMeter = 0;
        let middlePixelsPerMeter = 0;
        let focalPixels = 0;
        // How far the camera is inside the bound, where the bound says only how large it is, 0 to 1: all of the way
        // from its surface in, and none from a third of a radius out.
        let inside = 0;
        for (let i = 0; i < views.length; i++) {
          const horizon = horizons[i];
          if (horizon && classifySplatHorizon(middle, cullRadius, horizon) < 0) continue;
          if (!intersectsSplatFrustum(middle, cullRadius, frusta[i])) {
            if (
              !near &&
              props.shadowEnabled !== false &&
              intersectsSplatFrustum(middle, margin, frusta[i])
            )
              near = true;
            continue;
          }
          near = true;
          visible = true;
          const view = views[i] as Viewport;
          const units = ownerUnits[i] ? row.units : getSplatCommonUnits(middle, view);
          const projectedPixels = getSplatPixelsPerMeter(middle, view, units);
          // The crown can straddle the eye plane while its center is behind it. Keep that
          // tree visible and cap the size estimate before it reaches the LOD arithmetic.
          const middlePixels = Number.isFinite(projectedPixels)
            ? projectedPixels
            : (2 * Math.max(view.width, view.height) * unit) / Math.max(radius, 1e-6);
          middlePixelsPerMeter = Math.max(middlePixelsPerMeter, middlePixels);
          const mayDrawLeaves =
            !props._cropOnly && middlePixels * crownScale >= SHELL_DIAMETERS[0] * 0.75;
          if (!hasCrops && !mayDrawLeaves) continue;
          if (mayDrawLeaves) {
            pixelsPerMeter = Math.max(
              pixelsPerMeter,
              getSplatBoundedPixelsPerMeter(middle, radius, view, units)
            );
          }
          const camera = view.cameraPosition;
          const distance = Math.hypot(
            camera[0] - middle[0],
            camera[1] - middle[1],
            camera[2] - middle[2]
          );
          const outside = Math.min(Math.max((distance / Math.max(radius, 1e-12) - 1) / 0.3, 0), 1);
          inside = Math.max(inside, 1 - outside * outside * (3 - 2 * outside));
          const surface = Math.max(
            distance - radius * CROP_SURFACE_FRACTION,
            unit * CROP_NEAREST_METRES
          );
          // Pixels per metre go as one over distance, except in an orthographic view.
          const perspective = view.projectionMatrix[11] !== 0;
          cropPixelsPerMeter = Math.max(
            cropPixelsPerMeter,
            perspective ? (middlePixels * distance) / surface : middlePixels
          );
          // That has no answer for a tree behind the camera, which the wind may bring in front of it.
          nearestPixelsPerMeter = Math.max(
            nearestPixelsPerMeter,
            focal > 0
              ? (focal * unit) / surface
              : Number.isFinite(cropPixelsPerMeter)
                ? cropPixelsPerMeter
                : 0
          );
          if (perspective) focalPixels = Math.max(focalPixels, (middlePixels * distance) / unit);
        }
        row.pixelsPerMeter = cropPixelsPerMeter;
        row.middlePixelsPerMeter = middlePixelsPerMeter;
        row.focalPixels = focalPixels;
        row.visible = visible;
        row.camera =
          visible && (hasCrops || pixelsPerMeter > 0) && views.length === 1
            ? getCropCamera(row as PhotorealRow<unknown>, views[0])
            : null;
        if (!near) {
          row.level = -1;
          row.leafPixels = 0;
          continue;
        }
        if (visible && hasCrops) cropVertices += this.getRowCropVertices(row, data, lodBias);
        if (props._cropOnly) {
          // Crop eligibility needs visibility, but no leaf-size estimate or canopy budget.
          row.level = LOD_MAX;
          row.leafPixels = visible ? 1 : 0;
          continue;
        }
        let leafPixels = 0;
        const diameter = middlePixelsPerMeter * crownScale;
        const scale = 0.9 + 0.2 * (data[base + DETAIL * 4 + 1] + 0.5);
        // Hysteresis avoids rebucketing on a stationary camera at a threshold.
        const shellLevel = SHELL_DIAMETERS.reduce(
          (level, threshold, index) =>
            level + Number(diameter * scale < threshold * (row.shellLevel >= index ? 1.08 : 0.92)),
          -1
        );
        row.shellLevel =
          !visible || inside > 0 || diameter > SHELL_DIAMETERS[0] * 2 ? -1 : shellLevel;
        if (visible && row.shellLevel < 0) {
          leafPixels = Math.max(
            group.meanLeaf * leafScale * Math.max(pixelsPerMeter, middlePixelsPerMeter),
            1e-3
          );
          // A tree at LOD 0 with few leaves alive costs little, wherever its prefix ends.
          sized.push(leafPixels, leafCount);
          // Near blades come first, as they are the leaves that can be seen. An estimate from the size of the
          // tree, so that a frame still depends only on its view, not on the lists it was reached with.
          if (finePixels > 0 && leafPixels > finePixels) {
            const fine = Math.min((leafPixels / finePixels - 1) * LOD_FINE_SHARE, 1);
            const macro = Math.min(Math.max(leafPixels / macroPixels - 1, 0) * LOD_MACRO_SHARE, 1);
            nearVertices +=
              leafCount *
              (fine * LOD_FINE_CORNERS + macro * LOD_MACRO_CORNERS) *
              LOD_NEAR_CORNER_COST;
          }
          // A camera inside a tree's bound, as under its skirt, or inside the larger bound a strong wind gives it,
          // learns only how large the bound is, when a leaf may be right up against the camera. That asks for this
          // tree's full detail, and the finer blades for the leaves that are near, whatever it costs. Its share of
          // the budget stays what its bound says, so the rest of the view does not change for it.
          const windNear = Math.min(windReach / LOD_WIND_NEAR_METRES, 1);
          const near = Math.max(inside, windNear * windNear);
          leafPixels = Math.max(
            leafPixels,
            group.meanLeaf * leafScale * nearestPixelsPerMeter * near
          );
        }
        row.level = LOD_MAX;
        row.leafPixels = leafPixels;
      }
    }

    // Then far leaves grow alike until the view fits the budget, and what is near keeps its size.
    const budget = LOD_VERTEX_BUDGET / (biasScale * biasScale);
    const wanted = LOD_LEAF_PIXELS * biasScale;
    const stretchFrom = LOD_FINE_PIXELS * biasScale;
    const pressure = getTreeLeafPressure(
      sized,
      wanted,
      stretchFrom,
      Math.max(budget - nearVertices, budget * 0.25)
    );
    photoreal.leafTarget = wanted * 2 ** pressure;
    const {leafBlades} = photoreal;
    if (leafBlades[0] !== finePixels || leafBlades[1] !== macroPixels || leafBlades[2] !== focal) {
      photoreal.leafBlades = [finePixels, macroPixels, focal, 0];
    }
    // Half the pixels on screen means a quarter of the crops, in the levels that thin them.
    const cropPixelScale =
      2 ** -lodBias *
      (cropVertices > CROP_POINT_BUDGET ? Math.sqrt(CROP_POINT_BUDGET / cropVertices) : 1);
    photoreal.cropPixelScale = cropPixelScale;

    for (const group of photoreal.groups.values()) {
      if (props._cropOnly) {
        for (const bucket of group.crops.values()) bucket.shedding = false;
        for (const row of group.rows) this.updateRowCrops(group, row, data, cropPixelScale);
        this.rebuildCropBuckets(group, photoreal);
        continue;
      }
      const next: PhotorealRow<DataT>[][] = Array.from({length: CANOPY_LEVEL_COUNT}, () => []);
      const keys: number[][] = Array.from({length: CANOPY_LEVEL_COUNT}, () => []);
      const nextWood: PhotorealRow<DataT>[][] = [[], [], [], []];
      const woodKeys: number[][] = [[], [], [], []];
      const nextAir: PhotorealRow<DataT>[] = [];
      const airKeys: number[] = [];
      const coarse: PhotorealRow<DataT>[] = [];
      const coarseKeys: number[] = [];
      const stems: PhotorealRow<DataT>[] = [];
      const stemKeys: number[] = [];
      const shadowRows: PhotorealRow<DataT>[] = [];
      const shadowKeys: number[] = [];
      const stableShadows = props._stableLeafShadows;
      let shadowShare = stableShadows ? TREE_LEAF_STABLE_SHADOW_SHARE : TREE_LEAF_SHADOW_SHARE;
      for (const bucket of group.crops.values()) bucket.shedding = false;
      for (const row of group.rows) {
        if (row.cropKinds !== ',' || row.crops[0].kind || row.crops[1].kind) {
          this.updateRowCrops(group, row, data, cropPixelScale);
        }
        if (row.level < 0) {
          if (row.leafSelection) {
            row.leafSelection = null;
            group.bladesDirty = true;
          }
          this.clearNearLeaves(group, row);
          continue;
        }
        const base = row.stateRow * LOD_FLOATS_PER_ROW;
        if (stableShadows && props.shadowEnabled !== false) {
          shadowRows.push(row);
          shadowKeys.push(row.stateRow);
        }
        const level =
          row.leafPixels > 0
            ? Math.max(
                0,
                Math.min(
                  LOD_MAX,
                  Math.log2(
                    getTreeLeafLength(row.leafPixels, wanted, stretchFrom, pressure) /
                      row.leafPixels
                  )
                )
              )
            : LOD_MAX;
        const lod = Math.min(3, Math.floor(level));
        const detail = 4 ** (lod - level);
        if (row.leafPixels > 0 || row.shellLevel >= 0) {
          const canopyLod = row.shellLevel < 0 ? lod : FIRST_SHELL_LEVEL + row.shellLevel;
          next[canopyLod].push(row);
          keys[canopyLod].push(row.stateRow);
        }
        if (level === 0 || row.leafSelection) {
          this.updateLeafSelection(
            group,
            row,
            data,
            level,
            views.length === 1 ? views[0] : null,
            props
          );
        }
        // Leaves are in the air only while a tree is losing them.
        if ((lod === 0 || row.shellLevel === 0) && data[base + DETAIL * 4 + 2] > 0) {
          nextAir.push(row);
          airKeys.push(row.stateRow);
        }
        if (lod === 0 && !stableShadows) {
          // Bound the adaptive caster prefix while it blends toward full detail.
          const size = row.leafPixels / TREE_LEAF_SHADOW_FULL_PIXELS;
          shadowShare = Math.max(shadowShare, Math.min(size * size, TREE_LEAF_SHADOW_MOST));
        }
        if (level === 0) {
          this.updateNearLeaves(group, row, data, finePixels, macroPixels, focal, props);
        } else {
          this.clearNearLeaves(group, row);
        }
        // Foliage hides the finest wood, and the thinner it is the sooner it goes.
        const foliage = data[base + LIFE * 4 + 2];
        const hidden = Math.max(
          0,
          Math.min(
            1,
            (foliage - TREE_WOOD_HIDDEN_FROM) / (TREE_WOOD_HIDDEN_TO - TREE_WOOD_HIDDEN_FROM)
          )
        );
        const woodLod = Math.min(
          3,
          Math.floor(level + TREE_WOOD_LOD_SHIFT * hidden * hidden * (3 - 2 * hidden))
        );
        const stemPixels = data[base + MISC * 4] * row.middlePixelsPerMeter;
        // Dense shells hide small branches. Bare and thin crowns still need their coarse wood.
        const stemOnly =
          (row.shellLevel >= 1 || (row.shellLevel === 0 && stemPixels <= 1.6)) &&
          foliage * data[base + TREE_STATE_TEXEL.CANOPY * 4 + 3] >= 0.75;
        if (stemOnly) {
          stems.push(row);
          stemKeys.push(row.stateRow);
        } else if (row.leafPixels > 0 || row.shellLevel >= 0) {
          nextWood[woodLod].push(row);
          woodKeys[woodLod].push(row.stateRow);
        }
        if (
          row.shellLevel < 0 &&
          row.visible &&
          Math.abs(data[base + DETAIL * 4] - detail) > LOD_DETAIL_EPSILON
        ) {
          update.leafDetail = detail;
          store.setRow(row.stateRow, update, options);
        }
      }
      const shadowCount =
        props.shadowEnabled !== false && !stableShadows
          ? Math.min(
              group.model.leafCount,
              Math.max(Math.ceil(group.model.leafCount * shadowShare), 200)
            )
          : 0;
      if (group.coarseShadowCount !== shadowCount) {
        group.coarseShadowCount = shadowCount;
        group.bladesDirty = true;
      }
      for (const row of next[0]) {
        // Leaf-by-leaf instancing pays off only when it removes a substantial part of the original
        // submission, including its shadow prefix. Otherwise retain the original per-tree draw.
        const listed = Boolean(
          row.leafSelection &&
            row.leafSelection.visibleLeaves.length + shadowCount < group.model.leafCount * 0.8
        );
        if (row.useListedLeaves !== listed) group.bladesDirty = true;
        row.useListedLeaves = listed;
        if (!listed) {
          coarse.push(row);
          coarseKeys.push(row.stateRow);
        }
      }
      for (const row of group.rows) {
        if (row.level < 0 && row.useListedLeaves) {
          row.useListedLeaves = false;
          group.bladesDirty = true;
        }
      }
      for (let lod = 0; lod < CANOPY_LEVEL_COUNT; lod++) {
        group.buckets[lod] = group.slots[lod].update(next[lod], keys[lod]);
        if (group.buckets[lod].length) group.used[lod] = true;
        if (lod < FIRST_SHELL_LEVEL) {
          group.woodBuckets[lod] = group.woodSlots[lod].update(nextWood[lod], woodKeys[lod]);
          if (group.woodBuckets[lod].length) group.woodUsed[lod] = true;
        }
      }
      group.stemBucket = group.stemSlots.update(stems, stemKeys);
      group.airBucket = group.airSlots.update(nextAir, airKeys);
      group.coarseBucket = group.coarseSlots.update(coarse, coarseKeys);
      if (stableShadows) group.shadowBucket = group.shadowSlots.update(shadowRows, shadowKeys);
      if (group.airBucket.length) group.airUsed = true;
      group.shadowShare = shadowShare;
      this.rebuildNearLeaves(group, photoreal);
      this.rebuildCropBuckets(group, photoreal);
    }
  }

  /**
   * Reject offscreen spatial clusters before submitting their vertices. The shader keeps all its
   * original life, blade and shadow decisions; this only removes leaves whose entire motion bound
   * misses the camera. Trees with fallen, broken or rotting parts keep the original full-tree path.
   */
  private updateLeafSelection(
    group: PhotorealGroup<DataT>,
    row: PhotorealRow<DataT>,
    data: Float32Array,
    level: number,
    view: Viewport | null,
    props: TreeLayerProps<DataT>
  ): void {
    const base = row.stateRow * LOD_FLOATS_PER_ROW;
    const {SIZE, LIFE, POSE, MISC, ANCHOR, DETAIL} = TREE_STATE_TEXEL;
    let selection: TreeLeafSelection | null = null;
    if (
      level === 0 &&
      props._leafCulling !== false &&
      view &&
      !props.modelMatrix &&
      !props.extensions?.length &&
      data[base + LIFE * 4] >= 1 &&
      data[base + LIFE * 4 + 2] >= 1 &&
      data[base + POSE * 4] === 0 &&
      data[base + POSE * 4 + 2] === 0 &&
      data[base + POSE * 4 + 3] === 0 &&
      data[base + DETAIL * 4 + 2] === 0
    ) {
      const clusters = getTreeLeafClusters(group.model);
      const crownX = data[base + SIZE * 4];
      const crownY = data[base + SIZE * 4 + 1];
      const height = data[base + SIZE * 4 + 2];
      const trunk = data[base + SIZE * 4 + 3];
      const yaw = data[base + ANCHOR * 4 + 3];
      const leafScale = data[base + MISC * 4 + 3];
      const force =
        Math.max(
          this.state.hasDefaultWind ? getFiniteDimension(props.windStrength, 0) : 0,
          this.state.authoredWindStrength
        ) * data[base + MISC * 4 + 1];
      const windReach = force * height;
      const unit = Math.max(...row.units);
      const {forkZ} = group.model;
      const key = [
        row.anchorX,
        row.anchorY,
        row.anchorZ,
        row.projectionKey,
        crownX,
        crownY,
        height,
        trunk,
        yaw,
        leafScale
      ].join(',');
      if (row.leafBounds?.key !== key) {
        const spheres = new Float64Array(clusters.length * 5);
        clusters.forEach((cluster, index) => {
          const {center, radius} = getTreeLeafClusterSphere(
            cluster,
            crownX,
            crownY,
            height,
            trunk,
            forkZ,
            yaw,
            leafScale,
            0,
            0
          );
          const common = offsetSplatCommonPosition(row.common, center, row.units, row.frame);
          spheres.set(
            [common[0], common[1], common[2], radius * unit, cluster.length * leafScale * unit],
            index * 5
          );
        });
        row.leafBounds = {key, spheres};
      }
      const {spheres} = row.leafBounds;
      const matrix = view.viewProjectionMatrix as number[];
      const norms: [number, number, number] = [
        Math.hypot(matrix[0], matrix[4], matrix[8]),
        Math.hypot(matrix[1], matrix[5], matrix[9]),
        Math.hypot(matrix[3], matrix[7], matrix[11])
      ];
      let clusterIndex = 0;
      selection = selectTreeLeafClusters(
        clusters,
        0,
        () => {
          const offset = clusterIndex++ * 5;
          return intersectsTreeLeafClipBounds(
            spheres,
            offset,
            matrix,
            spheres[offset + 4] * 1.5 + windReach * unit,
            norms
          );
        },
        row.leafSelection
      );
    }
    if (selection !== row.leafSelection) {
      row.leafSelection = selection;
      row.bladesFrom = null;
      group.bladesDirty = true;
    }
  }

  /**
   * The leaves of a tree near enough to the camera for the fine and macro blades. The vertex stage decides for
   * itself, from where a leaf rests and the camera, as all blades must agree, so these lists only need to be
   * generous, and hold until the camera has moved far enough to matter. They are measured the same way as
   * there, as if each leaf were on the axis of the view, so that turning the camera changes nothing. They go by
   * where a leaf rests on the tree as it leans, or lies on the ground under a tree that stands, and reach further
   * by how far the wind may take a leaf toward the camera.
   */
  private updateNearLeaves(
    group: PhotorealGroup<DataT>,
    row: PhotorealRow<DataT>,
    data: Float32Array,
    finePixels: number,
    macroPixels: number,
    focal: number,
    props: TreeLayerProps<DataT>
  ): void {
    const {SIZE, ANCHOR, POSE, MISC, LIFE} = TREE_STATE_TEXEL;
    const base = row.stateRow * LOD_FLOATS_PER_ROW;
    const {camera} = row;
    if (
      !camera ||
      !(finePixels > 0) ||
      row.leafPixels * LOD_LONGEST_LEAF < finePixels * LOD_BLADE_MARGIN
    ) {
      this.clearNearLeaves(group, row);
      return;
    }
    const leafScale = data[base + MISC * 4 + 3];
    const scale = focal * leafScale;
    const growth = data[base + LIFE * 4];
    const foliage = data[base + LIFE * 4 + 2];
    const lean = data[base + POSE * 4];
    const yaw = data[base + ANCHOR * 4 + 3];
    const crownX = data[base + SIZE * 4];
    const crownY = data[base + SIZE * 4 + 1];
    const height = data[base + SIZE * 4 + 2];
    const trunk = data[base + SIZE * 4 + 3];
    const liveHeight = height * getTreeHeightFraction(growth);
    const reachOver = Math.min(
      Math.max(
        this.state.hasDefaultWind ? getFiniteDimension(props.windStrength, 0) : 0,
        this.state.authoredWindStrength
      ) *
        data[base + MISC * 4 + 1] *
        liveHeight *
        0.5,
      TREE_LEAF_BLADE_MARGIN_MOST
    );
    const mayDeform =
      reachOver > 0 ||
      growth < 0.012 ||
      lean > 0.5 ||
      data[base + POSE * 4 + 2] > 0 ||
      data[base + POSE * 4 + 3] > 0;
    const shape = [
      finePixels,
      macroPixels,
      scale,
      reachOver,
      yaw,
      crownX,
      crownY,
      height,
      trunk,
      growth,
      foliage,
      lean,
      data[base + POSE * 4 + 1],
      data[base + MISC * 4],
      Number(mayDeform)
    ];
    const from = row.bladesFrom;
    // The coarse shader uses the current thresholds immediately. It must have a replacement list
    // even when a detail change happens without moving the camera.
    if (from && shape.every((value, index) => value === row.bladesShape[index])) {
      // The shortest blade at the macro boundary has the smallest list margin in metres.
      const margin = (group.shortestLeaf * scale * (1 - LOD_BLADE_MARGIN)) / macroPixels;
      const away = Math.hypot(camera[0] - from[0], camera[1] - from[1], camera[2] - from[2]);
      if (away <= margin * LOD_BLADE_MOVE) return;
    }
    row.bladesFrom = camera;
    row.bladesShape = shape;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const {leaves, leafCount, forkZ} = group.model;
    // Leaning turns a tree about a point on the ground, so a leaf on it is as far from the camera as the camera turned
    // back is from where the leaf rests.
    const [cameraX, cameraY, cameraZ] = getTreeCameraBeforeLean(camera, data, base);
    // A leaf's length over its distance from the camera, for it to be this long on screen.
    const fineReach = scale / (finePixels * LOD_BLADE_MARGIN);
    const macroNear = scale / (macroPixels * LOD_BLADE_MARGIN);
    const macroFar = (scale * LOD_BLADE_MARGIN) / macroPixels;
    const macroOver = reachOver * TREE_LEAF_BLADE_MARGIN_MACRO;
    const fine: number[] = [];
    const macro: number[] = [];
    // Where a shed leaf lies, for a tree that stands: as the leaf stage has it.
    const scatter = 0.5 + 0.25 * Math.max(liveHeight, 1);
    const shed = lean <= 0 && foliage < 1 / 1.02;
    const candidates = row.leafSelection?.visibleLeaves;
    const candidateCount = candidates?.length ?? leafCount;
    for (let candidate = 0; candidate < candidateCount; candidate++) {
      const leaf = candidates ? candidates[candidate] : candidate;
      const offset = leaf * TREE_LEAF_STRIDE;
      const length = leaves[offset + 3];
      let x = leaves[offset] * crownX;
      let y = leaves[offset + 1] * crownY;
      const turned = x;
      x = turned * cos - y * sin;
      y = turned * sin + y * cos;
      let heightZ = leaves[offset + 2];
      let landed = false;
      if (shed) {
        const seed = leaves[offset + 10];
        if (seed > foliage * 1.02 && getFraction(seed * 97.13) < 0.181) {
          const angle = getFraction(seed * 29.41) * Math.PI * 2;
          const out = scatter * getFraction(seed * 53.89);
          x += Math.cos(angle) * out;
          y += Math.sin(angle) * out;
          heightZ = 0;
          landed = true;
        }
      }
      // The shader raises litter by up to 2.5 cm above the ground.
      const groundMargin = landed ? 0.025 : 0;
      const reach = length * fineReach + reachOver + groundMargin;
      const dx = cameraX - x;
      if (dx > reach || dx < -reach) continue;
      const dy = cameraY - y;
      if (dy > reach || dy < -reach) continue;
      const z =
        heightZ < forkZ
          ? (heightZ / forkZ) * trunk
          : trunk + ((heightZ - forkZ) / (1 - forkZ)) * (height - trunk);
      const dz = cameraZ - z;
      const squared = dx * dx + dy * dy + dz * dz;
      if (squared > reach * reach) continue;
      const nearest = length * macroNear + macroOver + groundMargin;
      if (squared <= nearest * nearest) macro.push(leaf);
      // Skip the fine candidate only when the shader's deformed distance can't send it back to fine.
      const farthest = length * macroFar;
      if (mayDeform || landed || squared > farthest * farthest) fine.push(leaf);
    }
    if (!isSameList(row.fineLeaves, fine) || !isSameList(row.macroLeaves, macro)) {
      row.fineLeaves = fine;
      row.macroLeaves = macro;
      group.bladesDirty = true;
    }
  }

  private clearNearLeaves(group: PhotorealGroup<DataT>, row: PhotorealRow<DataT>): void {
    row.bladesFrom = null;
    if (row.fineLeaves.length || row.macroLeaves.length) {
      row.fineLeaves = [];
      row.macroLeaves = [];
      group.bladesDirty = true;
    }
  }

  /** New instance data for the finer blades, if their members changed. */
  private rebuildNearLeaves(group: PhotorealGroup<DataT>, photoreal: PhotorealState<DataT>): void {
    if (!group.bladesDirty) return;
    group.bladesDirty = false;
    const build = (list: (row: PhotorealRow<DataT>) => number[]) => {
      let instances = 0;
      for (const row of group.rows) instances += list(row).length;
      const value = new Float32Array(instances * 2);
      let offset = 0;
      for (const row of group.rows) {
        for (const leaf of list(row)) {
          value[offset++] = row.stateRow;
          value[offset++] = leaf;
        }
      }
      return createLeafData(value, photoreal.rows);
    };
    group.fineData = build(row => row.fineLeaves);
    group.macroData = build(row => row.macroLeaves);
    const listed = group.rows.filter(row => row.useListedLeaves && row.leafSelection);
    const {coarseShadowCount} = group;
    group.coarseShadowInstances = listed.length * coarseShadowCount;
    let coarseCount = group.coarseShadowInstances;
    for (const row of listed) {
      for (const leaf of row.leafSelection!.visibleLeaves)
        if (leaf >= coarseShadowCount) coarseCount++;
    }
    const coarse = new Float32Array(coarseCount * 2);
    let coarseOffset = 0;
    // Every tree's original shadow prefix comes first. A shadow draw submits only this prefix,
    // rather than running every camera-visible leaf through a shader just to reject most of it.
    for (const row of listed) {
      for (let leaf = 0; leaf < coarseShadowCount; leaf++) {
        coarse[coarseOffset++] = row.stateRow;
        coarse[coarseOffset++] = leaf;
      }
    }
    for (const row of listed) {
      for (const leaf of row.leafSelection!.visibleLeaves) {
        if (leaf < coarseShadowCount) continue;
        coarse[coarseOffset++] = row.stateRow;
        coarse[coarseOffset++] = leaf;
      }
    }
    group.coarseData = createLeafData(coarse, photoreal.rows);
    if (group.fineData.length) group.fineUsed = true;
    if (group.macroData.length) group.macroUsed = true;
  }

  /** The points a tree's crops would take in this view, before any budget. */
  private getRowCropVertices(
    row: PhotorealRow<DataT>,
    data: Float32Array,
    lodBias: number
  ): number {
    const kinds = this.state.cropKinds;
    const {CROP0, CROP_DROPPED} = TREE_STATE_TEXEL;
    const base = row.stateRow * LOD_FLOATS_PER_ROW;
    let vertices = 0;
    for (let slot = 0; slot < 2; slot++) {
      const kind = kinds[row.stateRow * 2 + slot];
      if (!kind) continue;
      const first = base + (CROP0 + slot * 3) * 4;
      const dropped = data[base + CROP_DROPPED * 4 + slot];
      const count = data[first] + dropped;
      if (!(count > 0) || !(data[first + 1] > 0)) continue;
      const level = getCropDotLevel(
        kind,
        data[first + 1],
        row as PhotorealRow<unknown>,
        2 ** -lodBias,
        -1
      );
      const shedding = data[first + 3] > 0 || dropped > 0;
      vertices +=
        count *
        getTreeCropLevelThin(kind, level) *
        (shedding ? getTreeCropVertexCount(kind, getTreeCropLevelMesh(level)) : 1);
    }
    return vertices;
  }

  /**
   * Puts a tree's two crop slots in the bucket of their level of detail, and marks what changed. Instances
   * cover the capacity of each slot, so as long as a value stays within it, nothing is written.
   */
  private updateRowCrops(
    group: PhotorealGroup<DataT>,
    row: PhotorealRow<DataT>,
    data: Float32Array,
    pixelScale: number
  ): void {
    const kinds = this.state.cropKinds;
    const {CROP0, CROP_DROPPED, LIFE} = TREE_STATE_TEXEL;
    const base = row.stateRow * LOD_FLOATS_PER_ROW;
    const growth = data[base + LIFE * 4];
    const firstKindChanged = (kinds[row.stateRow * 2] ?? null) !== row.crops[0].kind;
    for (let slot = 0; slot < 2; slot++) {
      const entry = row.crops[slot];
      const kind = kinds[row.stateRow * 2 + slot] ?? null;
      const first = base + (CROP0 + slot * 3) * 4;
      const count = data[first];
      const radius = data[first + 1];
      const dropped = data[base + CROP_DROPPED * 4 + slot];
      let level = -1;
      if (kind && radius > 0 && (count > 0 || dropped > 0) && growth > 0 && row.visible) {
        level = getCropDotLevel(
          kind,
          radius,
          row as PhotorealRow<unknown>,
          pixelScale,
          entry.kind === kind ? entry.level : -1
        );
      }
      let changed =
        kind !== entry.kind || level !== entry.level || (slot === 1 && firstKindChanged);
      if (changed) this.markCropBucket(group, entry.kind, entry.level);
      if (kind !== entry.kind) this.clearNearCrops(group, entry);
      entry.kind = kind;
      entry.level = level;
      if (level < 0 || !kind) {
        entry.attached.capacity = 0;
        entry.dropped = 0;
        this.clearNearCrops(group, entry);
        continue;
      }
      const shedding = data[first + 3] > 0 || dropped > 0;
      if (shedding) this.getCropBucket(group, kind, level).shedding = true;
      const thin = getTreeCropLevelThin(kind, level);
      if (
        updateTreeCropCapacity(
          entry.attached,
          getTreeCropTable(group.model),
          // Blossoms take every twig's way out of the crown, born or not, once the tree can bloom.
          kind === 'flower' && growth >= TREE_CROP_BLOOM_FROM ? 1 : growth,
          count * thin,
          getTreeCropCluster(kind, level)
        )
      ) {
        changed = true;
      }
      const droppedNeed = Math.ceil(dropped * thin);
      if (droppedNeed > entry.dropped || droppedNeed * 4 < entry.dropped) {
        entry.dropped = droppedNeed > 0 ? 2 ** Math.ceil(Math.log2(droppedNeed)) : 0;
        changed = true;
      }
      if (changed) this.markCropBucket(group, kind, level);
      this.updateNearCrops(group, row, entry, slot, data, radius, pixelScale, changed);
      if (shedding) {
        // Its near crops are in the buckets of the meshes, whatever level the slot itself has.
        for (let mesh = 0; mesh < CROP_FIRST_DOT_LEVEL; mesh++) {
          if (entry.near[mesh].length) this.getCropBucket(group, kind, mesh).shedding = true;
        }
      }
    }
  }

  private clearNearCrops(group: PhotorealGroup<DataT>, entry: PhotorealCropSlot): void {
    entry.nearFrom = null;
    for (let mesh = 0; mesh < 2; mesh++) {
      if (entry.near[mesh].length) {
        entry.near[mesh] = [];
        this.markCropBucket(group, entry.kind, mesh);
      }
    }
  }

  /**
   * Which of a tree's crops may be large enough on screen for a mesh. A camera in a crown has a few crops
   * right in front of it and hundreds a few pixels across, which is why this is by crop, not by tree. It is
   * worked out afresh only when the camera has moved far enough to matter. The vertex stage decides what
   * each crop draws from its true size, so a crop in these lists is drawn as a point or as a mesh, never both.
   */
  private updateNearCrops(
    group: PhotorealGroup<DataT>,
    row: PhotorealRow<DataT>,
    entry: PhotorealCropSlot,
    slot: number,
    data: Float32Array,
    radius: number,
    pixelScale: number,
    changed: boolean
  ): void {
    const kind = entry.kind as CropKind;
    const {model} = group;
    const [macroPixels, finePixels] = getTreeCropMeshPixels(kind);
    const {ANCHOR, SIZE, POSE, CROP0} = TREE_STATE_TEXEL;
    const base = row.stateRow * LOD_FLOATS_PER_ROW;
    const fallen = data[base + (CROP0 + slot * 3) * 4 + 3];
    // What has fallen lies beyond the crown, which is what this is measured to.
    const beyondCrown = fallen > 0 ? CROP_NEAR_BEYOND_CROWN : 1;
    if (radius * row.pixelsPerMeter * pixelScale * beyondCrown < finePixels * CROP_NEAR_MARGIN) {
      this.clearNearCrops(group, entry);
      return;
    }
    const {camera, focalPixels} = row;
    const focal = focalPixels * pixelScale;
    const scale = radius * focal;
    if (
      camera &&
      entry.nearFrom &&
      !changed &&
      entry.nearFallen === fallen > 0 &&
      Math.abs(entry.nearScale - scale) <= entry.nearScale * CROP_NEAR_SIZE_HOLD
    ) {
      // The lists have a margin in size on screen, which holds until the camera has gone this far, from the
      // nearest a mesh may be drawn at.
      const [x, y, z] = entry.nearFrom;
      const reach = (scale / macroPixels) * (1 - CROP_NEAR_MARGIN);
      if (Math.hypot(camera[0] - x, camera[1] - y, camera[2] - z) < reach * CROP_NEAR_MOVE) return;
    }
    entry.nearFrom = camera;
    entry.nearScale = scale;
    entry.nearFallen = fallen > 0;

    const yaw = data[base + ANCHOR * 4 + 3];
    const crownX = data[base + SIZE * 4];
    const crownY = data[base + SIZE * 4 + 1];
    const height = data[base + SIZE * 4 + 2];
    const trunk = data[base + SIZE * 4 + 3];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // A tree that has moved from its template, or a view with no one camera, gets a mesh for every crop.
    const anywhere =
      !camera || !(focal > 0) || data[base + POSE * 4] > 0 || data[base + POSE * 4 + 2] > 0;
    const margin =
      (fallen > 0
        ? kind === 'flower'
          ? CROP_NEAR_REACH_PETAL
          : CROP_NEAR_REACH_FALLEN
        : CROP_NEAR_REACH) +
      getFiniteDimension(this.props.windStrength, 0) * height * 0.5;
    const code = getCropCode(row as PhotorealRow<unknown>, slot);
    const macro: number[] = [];
    const fine: number[] = [];
    const table = getTreeCropTable(model);
    // Meshes draw every blossom of a cluster, whatever the points do.
    const cluster = getTreeCropCluster(kind, 0);
    const anchors = entry.attached.byBirth ? table.byBirth : table.order;
    const forkZ = model.forkZ;
    const {cropAnchors} = model;
    const parents = Math.ceil(entry.attached.capacity / getTreeCropCluster(kind, entry.level));
    for (let parent = 0; parent < parents; parent++) {
      const anchor = anchors[parent];
      let pixels = Infinity;
      if (!anywhere) {
        const offset = anchor * TREE_CROP_ANCHOR_STRIDE;
        const localX = cropAnchors[offset] * crownX;
        const localY = cropAnchors[offset + 1] * crownY;
        const heightZ = cropAnchors[offset + 2];
        const z =
          heightZ < forkZ
            ? (heightZ / forkZ) * trunk
            : trunk + ((heightZ - forkZ) / (1 - forkZ)) * (height - trunk);
        const across = Math.max(
          Math.hypot(
            (camera as number[])[0] - (localX * cos - localY * sin),
            (camera as number[])[1] - (localX * sin + localY * cos)
          ) - margin,
          0
        );
        // From the camera to the crop as it hangs, or anywhere below it if it may have fallen.
        const cameraZ = (camera as number[])[2];
        const above = cameraZ > z + margin ? cameraZ - z - margin : 0;
        const below =
          fallen > 0
            ? cameraZ < 0
              ? -cameraZ
              : 0
            : cameraZ < z - margin
              ? z - margin - cameraZ
              : 0;
        pixels =
          (radius * focal) / Math.max(Math.hypot(across, above + below), CROP_NEAREST_METRES);
      }
      if (pixels < finePixels * CROP_NEAR_MARGIN) continue;
      for (let member = 0; member < cluster; member++) {
        const index = anchor * cluster + member;
        fine.push(index, code);
        if (pixels >= macroPixels * CROP_NEAR_MARGIN) macro.push(index, code);
      }
    }
    // Crops supplied as dropped lie anywhere under the crown.
    for (let crop = 0; crop < entry.dropped; crop++) {
      fine.push(crop, slot + CROP_CODE_DROPPED);
      macro.push(crop, slot + CROP_CODE_DROPPED);
    }
    this.setNearCrops(group, entry, 0, macro);
    this.setNearCrops(group, entry, 1, fine);
  }

  private setNearCrops(
    group: PhotorealGroup<DataT>,
    entry: PhotorealCropSlot,
    mesh: number,
    crops: number[]
  ): void {
    const previous = entry.near[mesh];
    if (previous.length === crops.length && previous.every((value, i) => value === crops[i]))
      return;
    entry.near[mesh] = crops;
    this.markCropBucket(group, entry.kind, mesh);
  }

  private getCropBucket(
    group: PhotorealGroup<DataT>,
    kind: CropKind,
    level: number
  ): PhotorealCropBucket<DataT> {
    const key = `${kind}-${level}`;
    let bucket = group.crops.get(key);
    if (!bucket) {
      bucket = {
        kind,
        level,
        dirty: true,
        shedding: false,
        data: createCropData(new Float32Array(0), [])
      };
      group.crops.set(key, bucket);
    }
    return bucket;
  }

  private markCropBucket(group: PhotorealGroup<DataT>, kind: CropKind | null, level: number): void {
    if (kind && level >= 0) this.getCropBucket(group, kind, level).dirty = true;
  }

  /** New instance data for the buckets whose members changed, and only those. */
  private rebuildCropBuckets(group: PhotorealGroup<DataT>, photoreal: PhotorealState<DataT>): void {
    if (!group.crops.size) return;
    const table = getTreeCropTable(group.model);
    for (const bucket of group.crops.values()) {
      if (!bucket.dirty) continue;
      bucket.dirty = false;
      const {kind, level} = bucket;
      const cluster = getTreeCropCluster(kind, level);
      const isMesh = level < CROP_FIRST_DOT_LEVEL;
      let instances = 0;
      for (const row of group.rows) {
        for (const entry of row.crops) {
          if (entry.kind !== kind) continue;
          if (isMesh) instances += entry.near[level].length / 2;
          else if (entry.level === level) instances += entry.attached.capacity + entry.dropped;
        }
      }
      const value = new Float32Array(instances * 3);
      let offset = 0;
      for (const row of group.rows) {
        for (let slot = 0; slot < 2; slot++) {
          const entry = row.crops[slot];
          if (entry.kind !== kind) continue;
          if (isMesh) {
            const crops = entry.near[level];
            for (let i = 0; i < crops.length; i += 2) {
              value[offset++] = row.stateRow;
              value[offset++] = crops[i];
              value[offset++] = crops[i + 1];
            }
          } else if (entry.level === level) {
            offset = writeTreeCropRefs(
              value,
              offset,
              row.stateRow,
              getCropCode(row as PhotorealRow<unknown>, slot),
              entry.attached,
              table,
              cluster
            );
            for (let crop = 0; crop < entry.dropped; crop++) {
              value[offset++] = row.stateRow;
              value[offset++] = crop;
              value[offset++] = slot + CROP_CODE_DROPPED;
            }
          }
        }
      }
      bucket.data = createCropData(value, photoreal.rows);
    }
  }

  /** One upload of the lines that changed, or a new texture if the line count changed. */
  private uploadStateTexture(store: TreeStateStore): void {
    let texture = this.state.stateTexture;
    if (!texture || texture.height !== store.lineCount) {
      texture?.destroy();
      texture = this.context.device.createTexture({
        id: `${this.props.id}-state`,
        format: 'rgba32float',
        width: TREE_STATE_TEXTURE_WIDTH,
        height: store.lineCount,
        data: store.data,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
      });
      this.state.stateTexture = texture;
      store.clearDirty();
      return;
    }
    if (store.isDirty) {
      const {dirtyLineStart: y, dirtyLineEnd: end} = store;
      const floatsPerLine = TREE_STATE_TEXTURE_WIDTH * 4;
      texture.writeData(store.data.subarray(y * floatsPerLine, end * floatsPerLine), {
        y,
        height: end - y
      });
      store.clearDirty();
    }
  }

  /**
   * A pick of a crop gives the state row of its tree, since one tree has thousands of crop instances and
   * they share its picking color. Everything else is a sub-layer row that deck.gl unwraps.
   */
  getPickingInfo(params: GetPickingInfoParams): PickingInfo {
    const {info, sourceLayer} = params;
    if (isStateRowPicked(sourceLayer) && info.index >= 0) {
      info.object = this.state.photoreal?.rows[info.index];
    }
    return super.getPickingInfo(params);
  }

  /** The state row of a row of `data`, or -1 if it has none. */
  private getSourceStateRow(index: number): number {
    return this.state.sources.find(source => source.index === index)?.stateRow ?? -1;
  }

  /** Wood partitions and canopy levels order trees differently; highlight the hovered tree in each. */
  protected _updateAutoHighlight(info: PickingInfo): void {
    updateSplatSourceHighlight(this, info);
    // Crops and macro leaves carry their tree's state row as their picking color.
    const row = info.picked ? this.getSourceStateRow(info.index) : -1;
    for (const layer of this.getSubLayers()) {
      if (!isStateRowPicked(layer)) continue;
      layer.updateAutoHighlight({
        ...info,
        picked: row >= 0,
        index: row,
        color: row >= 0 ? new Uint8Array(layer.encodePickingColor(row)) : null
      } as PickingInfo);
    }
  }

  private getTreeSubLayerProps(sublayerProps) {
    const {id} = sublayerProps;
    const overrides = this.props._subLayerProps?.[id] ?? {};
    const parameters = {
      ...this.props.parameters,
      ...sublayerProps.parameters,
      ...overrides.parameters
    };
    const updateTriggers = {
      all: this.props.updateTriggers?.all,
      ...sublayerProps.updateTriggers,
      ...overrides.updateTriggers
    };
    const props = this.getSubLayerProps({
      ...sublayerProps,
      id,
      type: sublayerProps.type,
      parameters,
      updateTriggers
    });
    // A controlled tree index must name the same tree in each partition's own row order.
    if (!('highlightedObjectIndex' in overrides))
      props.highlightedObjectIndex = getSplatHighlightRow(this, sublayerProps.data);
    // getSubLayerProps adds the triggers of extension accessors, such as `getSelected`.
    return {...props, parameters, updateTriggers: {...props.updateTriggers, ...updateTriggers}};
  }

  renderLayers() {
    const {modelMatrix, coordinateSystem} = this.props;
    const composesModelMatrix =
      coordinateSystem === COORDINATE_SYSTEM.CARTESIAN ||
      coordinateSystem === COORDINATE_SYSTEM.METER_OFFSETS ||
      (coordinateSystem === COORDINATE_SYSTEM.DEFAULT && !this.context?.viewport?.isGeospatial);
    if (
      modelMatrix &&
      composesModelMatrix &&
      (modelMatrix.length !== 16 ||
        Array.from(modelMatrix).some((value, index) =>
          index >= 12 && index < 15 ? !Number.isFinite(value) : value !== (index % 5 === 0 ? 1 : 0)
        ))
    ) {
      throw new Error(
        'TreeLayer modelMatrix supports translation only in Cartesian and metre-offset coordinates.'
      );
    }
    const {windDirection} = this.props;
    const windStrength = Math.max(
      this.state.hasDefaultWind ? getFiniteDimension(this.props.windStrength, 0) : 0,
      this.state.authoredWindStrength
    );
    if (windDirection !== this.state.windBearing) {
      this.state.windBearing = windDirection;
      this.state.windVector = getWindVector(windDirection);
    }
    return this.renderPhotorealLayers(windStrength);
  }

  private renderPhotorealLayers(windStrength: number): Layer[] {
    const {photoreal, stateTexture} = this.state;
    if (!photoreal || !stateTexture) return [];
    const {windTime, windGustTime, shadowEnabled, pickable, wetness, frost, fog} = this.props;
    const shared = {
      stateTexture,
      _stateData: this.state.store?.data ?? null,
      _sourceDataRevision: this.props.extensions.length ? this.state.sourceDataRevision : 0,
      _woodCulling: (this.props as unknown as {_woodCulling?: boolean})._woodCulling !== false,
      windStrength,
      windDirection: this.state.windVector,
      windTime,
      windGustTime,
      windOrigin: photoreal.windOrigin,
      windUnits: photoreal.windUnits,
      shadowEnabled,
      pickable,
      wetness,
      frost,
      fog,
      _dataDiff: getSplatChangedRanges,
      _offset: 0
    };
    if (this.props._cropOnly) return this.renderPhotorealCrops(shared);
    const wood: Layer[] = [];
    const leaves: Layer[] = [];
    const air: Layer[] = [];
    const {leafBlades} = photoreal;
    const {_dataDiff: _noDiff, ...sharedByLeaf} = shared;
    const stableShadows = this.props._stableLeafShadows;
    const woodParameters = {
      blend: this.props.opacity !== 1,
      ...this.props.parameters,
      cullMode: 'back'
    };
    for (const group of photoreal.groups.values()) {
      const {key, model, species, shadowShare, meanLeaf} = group;
      const part = {...shared, template: model, species};
      const blades = [leafBlades[0], leafBlades[1], leafBlades[2], meanLeaf];
      const material = this.props.foliageMaterial ?? DEFAULT_FOLIAGE_MATERIAL;
      const parameters = {...this.props.parameters, cullMode: 'none'};
      if (stableShadows && shadowEnabled !== false) {
        // Color tiers never change these meshes. The caster rows and opacity still follow
        // near residency and lifecycle updates, so a departing tree fades as before.
        const caster = {
          ...part,
          _shadowPass: 'only',
          pickable: false,
          data: group.shadowBucket
        };
        leaves.push(
          new TreeShellLayer(
            this.getTreeSubLayerProps({
              ...caster,
              lod: 2,
              type: TreeShellLayer,
              id: `canopy-${key}-shadow`,
              material,
              parameters
            })
          )
        );
        wood.push(
          new TreePhotorealWoodLayer(
            this.getTreeSubLayerProps({
              ...caster,
              template: getTreeStemModel(model),
              _woodCulling: false,
              lod: 3,
              type: TreePhotorealWoodLayer,
              id: `photoreal-wood-${key}-shadow`,
              material: this.props.woodMaterial ?? DEFAULT_WOOD_MATERIAL,
              parameters: woodParameters
            })
          )
        );
      }
      wood.push(
        new TreePhotorealWoodLayer(
          this.getTreeSubLayerProps({
            ...part,
            template: getTreeStemModel(model),
            _woodCulling: false,
            lod: 3,
            _shadowPass: stableShadows ? 'skip' : null,
            data: group.stemBucket,
            visible: group.stemBucket.length > 0 && this.props.visible,
            type: TreePhotorealWoodLayer,
            id: `wood-${key}-stem`,
            material: this.props.woodMaterial ?? DEFAULT_WOOD_MATERIAL,
            parameters: woodParameters
          })
        )
      );
      // Nearest first, for the depth test, and most of a crown's wood is behind its leaves.
      for (const blade of ['macro', 'fine'] as const) {
        if (!(blade === 'macro' ? group.macroUsed : group.fineUsed)) continue;
        const data = blade === 'macro' ? group.macroData : group.fineData;
        leaves.push(
          new TreePhotorealLeafLayer({
            ...this.getTreeSubLayerProps({
              ...sharedByLeaf,
              template: model,
              species,
              lod: 0,
              blade,
              leafBlades: blades,
              data: NO_CROP_ROWS,
              type: TreePhotorealLeafLayer,
              id: `photoreal-leaves-${key}-${blade}`,
              material,
              parameters
            }),
            data,
            // An empty one keeps its model, and costs a frame nothing.
            visible: data.length > 0 && this.props.visible,
            highlightedObjectIndex: this.getHighlightedStateRow()
          } as never)
        );
      }
      leaves.push(
        new TreePhotorealLeafLayer({
          ...this.getTreeSubLayerProps({
            ...sharedByLeaf,
            template: model,
            species,
            lod: 0,
            blade: 'coarse',
            listed: true,
            shadowInstances: group.coarseShadowInstances,
            leafBlades: blades,
            shadowShare,
            _shadowPass: stableShadows ? 'skip' : null,
            data: NO_CROP_ROWS,
            type: TreePhotorealLeafLayer,
            id: `photoreal-leaves-${key}-listed`,
            material,
            parameters
          }),
          data: group.coarseData,
          visible: group.coarseData.length > 0 && this.props.visible,
          highlightedObjectIndex: this.getHighlightedStateRow()
        } as never)
      );
      for (let lod = 0; lod < 4; lod++) {
        if (group.woodUsed[lod])
          wood.push(
            new TreePhotorealWoodLayer(
              this.getTreeSubLayerProps({
                ...part,
                lod,
                _woodCulling: shared._woodCulling && lod < 2 && group.woodBuckets[lod].length < 32,
                _shadowPass: stableShadows ? 'skip' : null,
                data: group.woodBuckets[lod],
                type: TreePhotorealWoodLayer,
                id: `photoreal-wood-${key}-${lod}`,
                material: this.props.woodMaterial ?? DEFAULT_WOOD_MATERIAL,
                parameters: woodParameters
              })
            )
          );
        if (group.used[lod])
          leaves.push(
            new TreePhotorealLeafLayer(
              this.getTreeSubLayerProps({
                ...part,
                lod,
                leafBlades: blades,
                shadowShare: lod === 0 ? shadowShare : undefined,
                _shadowPass: stableShadows ? 'skip' : null,
                data: lod === 0 ? group.coarseBucket : group.buckets[lod],
                type: TreePhotorealLeafLayer,
                id: `photoreal-leaves-${key}-${lod}`,
                material,
                parameters
              })
            )
          );
      }
      for (let lod = FIRST_SHELL_LEVEL; lod < CANOPY_LEVEL_COUNT; lod++) {
        if (!group.used[lod]) continue;
        leaves.push(
          new TreeShellLayer(
            this.getTreeSubLayerProps({
              ...part,
              lod: lod - FIRST_SHELL_LEVEL,
              _shadowPass: stableShadows ? 'skip' : null,
              data: group.buckets[lod],
              type: TreeShellLayer,
              id: `canopy-${key}-${lod}`,
              material,
              parameters
            })
          )
        );
      }
      if (group.airUsed) {
        // Their depth first, then the leaves themselves, which blend.
        for (const pass of ['depth', 'blend'] as const) {
          air.push(
            new TreePhotorealLeafLayer({
              ...this.getTreeSubLayerProps({
                ...part,
                lod: 0,
                air: pass,
                leafBlades: blades,
                data: group.airBucket,
                type: TreePhotorealLeafLayer,
                id: `photoreal-leaves-${key}-air-${pass}`,
                material,
                parameters: {...parameters, ...AIR_PARAMETERS[pass]}
              }),
              // Not for picking, and an empty one keeps its model and costs a frame nothing.
              pickable: false,
              visible: group.airBucket.length > 0 && this.props.visible
            } as never)
          );
        }
      }
    }
    // Leaves in the air blend, so they come after everything they may be seen against.
    return [...leaves, ...wood, ...this.renderPhotorealCrops(shared), ...air];
  }

  /** The state row of the row of `data` that is highlighted, as crops and macro leaves encode a tree. */
  private getHighlightedStateRow(): number | null | undefined {
    const {highlightedObjectIndex} = this.props;
    return Number.isInteger(highlightedObjectIndex)
      ? this.getSourceStateRow(highlightedObjectIndex as number)
      : (highlightedObjectIndex as null | undefined);
  }

  /**
   * Crops of the photoreal path: one `TreePhotorealCropLayer` per template, crop kind and level of detail
   * that has held crops. Their instances live in binary attribute data, and all that animates in the state
   * texture, so a frame that changes only numbers keeps the data's identity and writes no attribute.
   */
  private renderPhotorealCrops(shared: Record<string, unknown>): Layer[] {
    const {photoreal} = this.state;
    if (!photoreal) return [];
    const {_dataDiff: _noDiff, ...common} = shared;
    const {cropMaterial} = this.props;
    const highlighted = this.getHighlightedStateRow();
    const layers: Layer[] = [];
    for (const group of photoreal.groups.values()) {
      const {key, model, species} = group;
      for (const bucket of group.crops.values()) {
        const {kind, level, data, shedding} = bucket;
        layers.push(
          new TreePhotorealCropLayer({
            ...this.getTreeSubLayerProps({
              ...common,
              template: model,
              species,
              kind,
              shedding,
              pixelScale: photoreal.cropPixelScale,
              lod: level,
              data: NO_CROP_ROWS,
              type: TreePhotorealCropLayer,
              id: `photoreal-crops-${key}-${kind}-${level}`,
              material: cropMaterial ?? CROP_MATERIALS[kind] ?? DEFAULT_CROP_MATERIAL,
              parameters: {...this.props.parameters, cullMode: kind === 'flower' ? 'none' : 'back'}
            }),
            data,
            // An empty level keeps its model, and costs a frame nothing.
            visible: data.length > 0 && this.props.visible,
            highlightedObjectIndex: highlighted
          } as never)
        );
      }
    }
    return layers;
  }
}
