// Frozen native mesh reference from 1d30abb264e51bd0bf89902fb690246348595d9a.
// Kept in the example for controlled before/after rendering and benchmarks.
// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, createIterable} from '@deck.gl/core';
import type {Color, DefaultProps, LayerProps, Position} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {
  getTreeMesh,
  sampleCrownSurface,
  samplePineSurface,
  createTreeRng
} from '../../../modules/layers/src/tree-layer/tree-geometry';
import {TreeMeshLayer} from '../../../modules/layers/src/tree-layer/tree-mesh-layer';
import {TreeLayer as NativeTreeLayer} from '../../../modules/layers/src/tree-layer/tree-layer';
import {SplatLayer} from '../../../modules/layers/src/splat-layer/splat-layer';
import {getSplatAxes, type SplatSource} from '../../../modules/layers/src/splat-layer/splat-source';
import type {TreeMesh} from '../../../modules/layers/src/tree-layer/tree-geometry';

/** Procedural species silhouette. */
export type TreeType = 'pine' | 'oak' | 'palm' | 'birch' | 'cherry';
/** Deciduous winter trees have branches; evergreens retain their crowns. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** Optional, explicitly supplied fruit, nuts, or flowering points. */
export type CropConfig = {
  color: Color;
  count: number;
  droppedCount?: number;
  /** Actual sphere radius in metres. */
  radius: number;
};

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

  /** Longitude/latitude position of the tree base. */
  getPosition?: (d: DataT) => Position;

  /** Base elevation (metres above sea level). @default 0 */
  getElevation?: (d: DataT) => number;

  /**
   * Silhouette / species variant.
   * 'pine'   – layered conical tiers (evergreen)
   * 'oak'    – wide lobed canopy
   * 'palm'   – ring-scarred palm trunk with arching pinnate fronds
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
   * Horizontal canopy scale in metres. Broadleaf envelopes retain the legacy approximate half-scale radius.
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
   * Season controls default foliage colour and deciduous winter branch geometry.
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
  /** Fraction of tree height used for optional GPU wind deformation. Zero stops continuous redraw. @default 0 */
  windStrength?: number;
  /** Wind clock in seconds, or null to use deck.gl's timeline. Set a number for repeatable comparisons. @default null */
  windTime?: number | null;
  /** Cast shadows when the host LightingEffect enables them. WebGL only until deck.gl supports WebGPU shadows. @default true */
  shadowEnabled?: boolean;
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
  sizeScale: {type: 'number', value: 1, min: 0},
  windStrength: {type: 'number', value: 0, min: 0, max: 0.2},
  windTime: null,
  shadowEnabled: true
};

type TreeRow<DataT> = {
  object: DataT;
  position: Position;
  type: TreeType;
  winter: boolean;
  levels: number;
  height: number;
  trunkHeight: number;
  trunkRadius: number;
  scale: [number, number, number];
  orientation: [number, number, number];
  translation: [number, number, number];
  wind: [number, number, number];
};
type CropRow = {
  position: Position;
  translation: [number, number, number];
  radius: number;
  color: Color;
  wind: [number, number, number];
};
type TreeState<DataT> = {
  groups: Map<string, TreeRow<DataT>[]>;
  trunks: TreeRow<DataT>[];
  palms: TreeRow<DataT>[];
  liveCrops: CropRow[];
  droppedCrops: CropRow[];
};

const GEOMETRY_PROPS = [
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
  'sizeScale'
] as const;

const TREE_MESH_ACCESSORS = Object.entries({
  ...SimpleMeshLayer.defaultProps,
  ...TreeMeshLayer.defaultProps
})
  .filter(
    ([, definition]) =>
      definition &&
      typeof definition === 'object' &&
      'type' in definition &&
      definition.type === 'accessor'
  )
  .map(([name]) => name);

/** Layered, instanced trees built with vis.gl geometry, seasonal crowns and optional GPU wind. */
class LegacyMeshTreeLayer<DataT = unknown, ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_TreeLayerProps<DataT>>
> {
  static layerName = 'MeshTreeLayer';
  static defaultProps = defaultProps;
  declare state: TreeState<DataT>;

  initializeState() {
    this.state = {groups: new Map(), trunks: [], palms: [], liveCrops: [], droppedCrops: []};
  }

  updateState({props, oldProps, changeFlags}) {
    const triggers = changeFlags.updateTriggersChanged;
    const changed =
      changeFlags.dataChanged ||
      GEOMETRY_PROPS.some(
        key => props[key] !== oldProps[key] || triggers === true || triggers?.all || triggers?.[key]
      );
    if (!changed) return;
    const groups = new Map<string, TreeRow<DataT>[]>();
    const trunks: TreeRow<DataT>[] = [];
    const palms: TreeRow<DataT>[] = [];
    const liveCrops: CropRow[] = [];
    const droppedCrops: CropRow[] = [];
    const {iterable, objectInfo} = createIterable(props.data);
    for (const object of iterable as Iterable<DataT>) {
      objectInfo.index++;
      const type: TreeType = props.getTreeType(object);
      if (!['pine', 'oak', 'palm', 'birch', 'cherry'].includes(type)) continue;
      const position = props.getPosition(object);
      const seed =
        ((Math.round(position[0] * 10000) * 92821) ^ (Math.round(position[1] * 10000) * 65537)) >>>
        0;
      const height = Math.max(0, props.getHeight(object) * props.sizeScale);
      const fraction = Math.max(0, Math.min(1, props.getTrunkHeightFraction(object)));
      const canopyHeight = height * (1 - fraction);
      const radius = Math.max(0, props.getCanopyRadius(object) * props.sizeScale);
      const season: Season = props.getSeason(object);
      const winter = season === 'winter' && type !== 'pine' && type !== 'palm';
      const levels =
        type === 'pine' ? Math.max(1, Math.min(5, Math.round(props.getBranchLevels(object)))) : 3;
      const row = this.getSubLayerRow<TreeRow<DataT>>(
        {
          object,
          position: [position[0], position[1], props.getElevation(object) || 0],
          type,
          winter,
          levels,
          height,
          trunkHeight: height * fraction + (type === 'palm' ? canopyHeight * 0.24 : 0),
          trunkRadius: Math.max(0, props.getTrunkRadius(object) * props.sizeScale),
          scale: [
            radius * (1 + ((seed & 0xffff) / 65535 - 0.5) * 0.6),
            radius * (1 + (((seed >>> 16) & 0xffff) / 65535 - 0.5) * 0.6),
            canopyHeight
          ],
          orientation: [
            winter ? 0 : (((seed ^ (seed >>> 7)) & 0xff) / 255 - 0.5) * 24,
            (((seed ^ (seed >>> 13)) & 0xffff) / 65535) * 360,
            0
          ],
          translation: [0, 0, height * fraction - canopyHeight * 0.22],
          wind: [height, (seed / 4294967296) * Math.PI * 2, 1]
        },
        object,
        objectInfo.index
      );
      const key = `${type}-${winter ? 'winter' : 'foliage'}-${levels}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
      (type === 'palm' ? palms : trunks).push(row);
      const crop = props.getCrop(object);
      if (crop && crop.radius > 0) {
        const cropRadius = crop.radius * props.sizeScale;
        const rng = createTreeRng(seed);
        // SimpleMeshLayer uses yaw about Z and pitch about Y (roll is zero).
        const transform = new Matrix4()
          .rotateZ((row.orientation[1] * Math.PI) / 180)
          .rotateY((row.orientation[0] * Math.PI) / 180)
          .scale(row.scale);
        const count = Math.max(0, Math.floor(crop.count));
        for (let i = 0; i < count; i++) {
          const theta = rng() * Math.PI * 2;
          const vertical = -0.75 + rng() * 1.5;
          const horizontal = Math.sqrt(1 - vertical * vertical);
          let point: [number, number, number];
          if (type === 'palm') {
            point = [Math.cos(theta) * 0.16, Math.sin(theta) * 0.16, 0.3 + rng() * 0.08];
          } else if (type === 'pine') {
            const z = 0.18 + rng() * 0.5;
            point = samplePineSurface(levels, z, theta);
          } else {
            point = sampleCrownSurface(type, [
              horizontal * Math.cos(theta),
              horizontal * Math.sin(theta),
              vertical
            ]);
            point = [point[0] * 1.04, point[1] * 1.04, 0.5 + (point[2] - 0.5) * 1.04];
          }
          const offset = transform.transformAsVector(point) as [number, number, number];
          offset[2] += row.translation[2];
          liveCrops.push(
            this.getSubLayerRow(
              {
                position: row.position,
                translation: offset,
                radius: cropRadius,
                color: crop.color,
                wind: row.wind
              },
              object,
              objectInfo.index
            )
          );
        }
        const groundRng = createTreeRng(seed ^ 0x1a2b3c4d);
        for (let i = 0; i < Math.max(0, Math.floor(crop.droppedCount ?? 0)); i++) {
          const theta = groundRng() * Math.PI * 2;
          const r = Math.sqrt(groundRng()) * radius * 0.5;
          droppedCrops.push(
            this.getSubLayerRow(
              {
                position: row.position,
                translation: [Math.cos(theta) * r, Math.sin(theta) * r, cropRadius],
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
    this.setState({groups, trunks, palms, liveCrops, droppedCrops});
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
      type: TreeMeshLayer,
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
    const {windStrength, windTime, shadowEnabled, getTrunkColor, getCanopyColor, getSeason} =
      this.props;
    const shared = {windStrength, windTime, shadowEnabled, pickable: this.props.pickable};
    const layers: TreeMeshLayer<unknown>[] = [];
    const trunkColor = (row: TreeRow<DataT>) =>
      getTrunkColor(row.object) ?? DEFAULT_TRUNK_COLORS[row.type];
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
            getWind: (row: TreeRow<DataT>) => row.wind,
            material: {ambient: 0.4, diffuse: 0.7, shininess: 4},
            updateTriggers: {getColor: [getTrunkColor, this.props.updateTriggers?.getTrunkColor]}
          })
        )
      );
    };
    trunks(this.state.trunks, 'trunks', false);
    trunks(this.state.palms, 'trunks-palm', true);
    for (const [key, data] of this.state.groups) {
      const {type, winter, levels} = data[0];
      layers.push(
        new TreeMeshLayer(
          this.getTreeSubLayerProps(
            {
              id: `canopy-${key}`,
              data,
              ...shared,
              mesh: getTreeMesh('canopy', type, 'high', winter, levels),
              doubleSided: type === 'palm',
              parameters:
                type === 'palm'
                  ? {...this.props.parameters, cullMode: 'none'}
                  : this.props.parameters,
              getPosition: (row: TreeRow<DataT>) => row.position,
              getTranslation: (row: TreeRow<DataT>) => row.translation,
              getScale: (row: TreeRow<DataT>) => row.scale,
              getStemRadius: (row: TreeRow<DataT>) => (row.winter ? row.trunkRadius * 0.7 : -1),
              getOrientation: (row: TreeRow<DataT>) => row.orientation,
              getWind: (row: TreeRow<DataT>) => row.wind,
              getColor: (row: TreeRow<DataT>) =>
                winter
                  ? trunkColor(row)
                  : (getCanopyColor(row.object) ??
                    DEFAULT_CANOPY_COLORS[type][getSeason(row.object) || 'summer']),
              material: {ambient: 0.42, diffuse: 0.72, shininess: 2},
              updateTriggers: {
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
      layers.push(
        new TreeMeshLayer(
          this.getTreeSubLayerProps({
            id,
            data,
            ...shared,
            mesh: getTreeMesh('crop'),
            getPosition: (row: CropRow) => row.position,
            getTranslation: (row: CropRow) => row.translation,
            getScale: (row: CropRow) => [row.radius, row.radius, row.radius],
            getColor: (row: CropRow) => row.color,
            getWind: (row: CropRow) => row.wind,
            material: {ambient: 0.4, diffuse: 0.7, shininess: 24}
          })
        )
      );
    }
    return layers;
  }
}


/** New species have no historical mesh; their reference uses opaque elliptical leaf cards. */
class LeafCardLayer extends SplatLayer {
  static layerName = 'LeafCardLayer';
  renderLayers() {
    return super.renderLayers().map(layer => {
      const props = layer.props as any;
      return new TreeMeshLayer({
      ...props,
      data: props.data,
      id: `${layer.id}-mesh-reference`,
      mesh: getLeafCardMesh(props.source),
      getWind: props.getDeformation as any,
      windStrength: props.deformationStrength,
      windTime: props.deformationTime,
      doubleSided: true,
      parameters: {...layer.props.parameters, cullMode: 'none'}
    } as any);
    });
  }
}
class NewSpeciesMeshLayer extends NativeTreeLayer {
  static layerName = 'NewSpeciesMeshLayer';
  renderLayers() {
    return super.renderLayers().map(layer => layer instanceof SplatLayer
      ? new LeafCardLayer({...layer.props, data: layer.props.data, id: layer.id}) : layer);
  }
}
const LEAF_MESHES = new WeakMap<SplatSource, TreeMesh>();
function getLeafCardMesh(source: SplatSource): TreeMesh {
  const cached = LEAF_MESHES.get(source);
  if (cached) return cached;
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let leaf = 0; leaf < source.opacities.length; leaf++) {
    const axes = getSplatAxes(source.rotations.subarray(leaf * 4, leaf * 4 + 4), source.scales.subarray(leaf * 3, leaf * 3 + 3));
    for (let corner = 0; corner < 8; corner++) {
      const angle = corner * Math.PI / 4;
      for (let axis = 0; axis < 3; axis++) positions.push(source.positions[leaf * 3 + axis] + (axes[0][axis] * Math.cos(angle) + axes[1][axis] * Math.sin(angle)) * 2);
      normals.push(...(source.normals?.subarray(leaf * 3, leaf * 3 + 3) ?? [0, 0, 1]));
      colors.push(...source.colors.subarray(leaf * 4, leaf * 4 + 3));
    }
    for (let triangle = 1; triangle < 7; triangle++) indices.push(leaf * 8, leaf * 8 + triangle, leaf * 8 + triangle + 1);
  }
  const mesh: TreeMesh = {attributes: {
    POSITION: {value: new Float32Array(positions), size: 3},
    NORMAL: {value: new Float32Array(normals), size: 3},
    COLOR_0: {value: new Float32Array(colors), size: 3},
    TEXCOORD_0: {value: new Float32Array(positions.length / 3 * 2), size: 2}
  }, indices: {value: new Uint32Array(indices), size: 1}, topology: 'triangle-list', mode: 4};
  LEAF_MESHES.set(source, mesh);
  return mesh;
}
/** Preserve the historical five-species reference and include both newly added species. */
export class MeshTreeLayer extends CompositeLayer<any> {
  static layerName = 'MeshTreeLayer';
  static defaultProps = NativeTreeLayer.defaultProps;
  declare state: {legacy: any[]; added: any[]};
  initializeState() { this.state = {legacy: [], added: []}; }
  updateState({changeFlags}) {
    if (!changeFlags.dataChanged && !changeFlags.updateTriggersChanged && this.state.legacy.length + this.state.added.length) return;
    const legacy: any[] = [], added: any[] = [];
    for (const object of this.props.data) {
      const type = this.props.getTreeType(object);
      (type === 'banyan' || type === 'mangrove' ? added : legacy).push(object);
    }
    this.setState({legacy, added});
  }
  renderLayers() {
    return [
      this.state.legacy.length && new LegacyMeshTreeLayer({...this.props, ...this.getSubLayerProps({id: 'legacy'}), data: this.state.legacy}),
      this.state.added.length && new NewSpeciesMeshLayer({...this.props, ...this.getSubLayerProps({id: 'new-species'}), data: this.state.added})
    ];
  }
}
