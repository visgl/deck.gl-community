// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  Layer,
  createIterable,
  project32,
  picking,
  type Accessor,
  type Color,
  type DefaultProps,
  type LayerProps,
  type Position,
  type UpdateParameters
} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import {phongMaterial, type PhongMaterialProps} from '@luma.gl/shadertools';
import {acquireSplatGeometry, type SplatSource} from './splat-source';
import {getSplatTransform} from './splat-transform';
import {
  SPLAT_VERTEX,
  SPLAT_FRAGMENT,
  SPLAT_ACCUMULATION_FRAGMENT,
  SPLAT_TRANSMISSION_FRAGMENT,
  splatUniforms
} from './splat-shaders';
import {SplatEffect} from './splat-effect';
import {clearShadowDepthOffset} from './splat-shadow';
import {SPLAT_WGSL, SPLAT_ACCUMULATION_WGSL, SPLAT_TRANSMISSION_WGSL} from './splat.wgsl.js';

// Picking omits LightingEffect, but the effect's shadow shader remains a deck default module.
// Retain its harmless fallback samplers from a draw pass so the pick pass can bind the module.
const PICKING_SHADOW_BINDINGS = new WeakMap<object, Record<string, any>>();

function withPickingShadowBindings(owner: object, props: Record<string, any>) {
  if (props.shadow?.dummyShadowMap) PICKING_SHADOW_BINDINGS.set(owner, props.shadow);
  const previous = PICKING_SHADOW_BINDINGS.get(owner);
  return props.picking?.isActive && previous
    ? {
        ...props,
        shadow: {...previous, project: props.project, shadowEnabled: false, drawToShadowMap: false}
      }
    : props;
}

export type PreparedSplatProps<DataT> = {
  data: DataT[];
  /** Color composition across prepared sources. @default 'weighted' */
  transparency?: 'weighted' | 'sorted';
  /** Immutable Gaussian template shared by every owner in data. */
  source: SplatSource;
  /** Owner anchor in the layer coordinate system. */
  getPosition?: Accessor<DataT, Position>;
  /** Pitch, yaw, roll in degrees, matching SimpleMeshLayer. */
  getOrientation?: Accessor<DataT, number[]>;
  /** Source-local XYZ scale, applied before orientation and translation. */
  getScale?: Accessor<DataT, number[]>;
  /** Local translation in metres, applied after scale and orientation. */
  getTranslation?: Accessor<DataT, number[]>;
  /** Affine source-local transform. When supplied, replaces orientation, scale and translation. */
  getTransformMatrix?: Accessor<DataT, number[] | null>;
  /** RGBA owner tint. Template and owner alpha each multiply opacity once. */
  getColor?: Accessor<DataT, Color>;
  /** Bend height, stable phase, and flex multiplier. Defaults to a rigid source. */
  getDeformation?: Accessor<DataT, number[]>;
  /** Bend strength as a fraction of the owner's height. @default 0 */
  deformationStrength?: number;
  /** Seconds, or null for the shared deck.gl animation clock. @default null */
  deformationTime?: number | null;
  /** Pixel variance added to projected covariance, with determinant opacity compensation. @default 0.3 */
  kernelVariance?: number;
  /** Fragment contribution threshold. @default 0.0039215686 */
  alphaCutoff?: number;
  /** Gaussian support radius in standard deviations. @default 3 */
  support?: number;
  /** Automatic spatial hierarchy. The finest source is always retained. */
  hierarchy?: import('./splat-hierarchy').SplatHierarchy;
  /** Maximum aggregate centre displacement in device pixels. @default 0.75 */
  pixelError?: number;
  /** Screen-center allocation priority under a finite `maxSplats` budget. It never changes requested screen error. @default 0 */
  foveationStrength?: number;
  /** Gaussian submission budget. Finite caps retain a small transition headroom for optical fades; coarsest coverage is the minimum. @default Infinity */
  maxSplats?: number;
  /** Maximum aggregate accumulation pixels across view targets. Picking and opaque draws keep host resolution. @default Infinity */
  maxRenderPixels?: number;
  /** Internal optical blend weight, independent of owner RGBA. */
  getCoverageWeight?: Accessor<DataT, number>;
  /** @internal Rows whose coverage weight changed; each new list invalidates only those rows. */
  _coverageRanges?: {startRow: number; endRow: number}[] | null;
  /** Lighting material for authored source normals; supports unlit rendering. */
  material?: PhongMaterialProps;
  /**
   * Cast shadows from a `LightingEffect` light with `_shadow: true` (WebGL2). Each Gaussian
   * casts with a probability equal to its alpha. Gaussians receive shadows either way.
   * @default true
   */
  shadowEnabled?: boolean;
};
export type SplatLayerProps<DataT = unknown> = PreparedSplatProps<DataT> & LayerProps;
const defaultProps: DefaultProps<SplatLayerProps> = {
  source: null,
  transparency: 'weighted',
  hierarchy: null,
  pixelError: 0.75,
  foveationStrength: {type: 'number', value: 0, min: 0, max: 1},
  maxSplats: Infinity,
  maxRenderPixels: Infinity,
  getCoverageWeight: {type: 'accessor', value: 1},
  _coverageRanges: null,
  getPosition: {type: 'accessor', value: (d: any) => d.position},
  getOrientation: {type: 'accessor', value: [0, 0, 0]},
  getScale: {type: 'accessor', value: [1, 1, 1]},
  getTranslation: {type: 'accessor', value: [0, 0, 0]},
  getTransformMatrix: {type: 'accessor', value: null},
  getColor: {type: 'accessor', value: [255, 255, 255, 255]},
  getDeformation: {type: 'accessor', value: [1, 0, 0]},
  deformationStrength: 0,
  deformationTime: null,
  kernelVariance: {type: 'number', value: 0.3, min: 0},
  alphaCutoff: {type: 'number', value: 1 / 255, min: 0, max: 1},
  support: {type: 'number', value: 3, min: 1, max: 6},
  material: {ambient: 0.5, diffuse: 0.7, shininess: 2, specularColor: [0, 0, 0]},
  shadowEnabled: true
};

/** Instanced, anisotropic 3D Gaussians with shared weighted transparency and stable owner picking. */
export class SplatPrimitiveLayer<DataT = unknown> extends Layer<
  Required<PreparedSplatProps<DataT>>
> {
  static layerName = 'SplatPrimitiveLayer';
  static defaultProps = defaultProps;
  /**
   * The vertex attributes fill the 16 slots WebGL2 and WebGPU guarantee: per-object color filters
   * such as `SelectionPulseExtension` read their data by instance index. The WGSL exposes
   * `WGSL_FILTER_COLOR_ANCHOR`.
   */
  static instanceColorFilters = true;
  declare state: {
    model?: Model;
    accumulationModel?: Model;
    transmissionModel?: Model;
    effect: SplatEffect;
    windRows: WeakMap<object, number[]>;
  };

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instancePositions: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        accessor: 'getPosition'
      },
      instanceColors: {
        size: 4,
        type: 'unorm8',
        accessor: 'getColor',
        defaultValue: [255, 255, 255, 255]
      },
      instanceWindData: {
        size: 7,
        accessor: ['getDeformation', 'getCoverageWeight'],
        shaderAttributes: {
          instanceDeformation: {size: 4, elementOffset: 0},
          instanceCoverageWeight: {size: 3, elementOffset: 4}
        },
        update: this.calculateWindData
      },
      instanceModelMatrix: {
        size: 12,
        accessor: ['getOrientation', 'getScale', 'getTranslation', 'getTransformMatrix'],
        shaderAttributes: {
          instanceModelMatrixCol0: {size: 3, elementOffset: 0},
          instanceModelMatrixCol1: {size: 3, elementOffset: 3},
          instanceModelMatrixCol2: {size: 3, elementOffset: 6},
          instanceTranslation: {size: 3, elementOffset: 9}
        },
        update: this.calculateTransforms
      }
    });
    this.setState({effect: SplatEffect.get(this.context.deck), windRows: new WeakMap()});
  }

  getShaders() {
    return super.getShaders({
      vs: SPLAT_VERTEX,
      fs: SPLAT_FRAGMENT,
      source: SPLAT_WGSL,
      modules: [project32, picking, phongMaterial, splatUniforms]
    });
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    const triggers = params.changeFlags.updateTriggersChanged;
    if (triggers && (triggers.getDeformation || triggers.all)) this.state.windRows = new WeakMap();
    const coverage = params.props._coverageRanges;
    if (coverage && coverage !== params.oldProps._coverageRanges)
      for (const range of coverage)
        this.getAttributeManager()!.invalidate('getCoverageWeight', range);
    if (params.props.source !== params.oldProps.source || params.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.accumulationModel?.destroy();
      this.state.transmissionModel?.destroy();
      const makeModel = (mode: 'picking' | 'accumulation' | 'transmission') =>
        new Model(this.context.device, {
          ...this.getShaders(),
          ...(mode === 'accumulation'
            ? {fs: SPLAT_ACCUMULATION_FRAGMENT, source: SPLAT_ACCUMULATION_WGSL}
            : mode === 'transmission'
              ? {fs: SPLAT_TRANSMISSION_FRAGMENT, source: SPLAT_TRANSMISSION_WGSL}
              : {}),
          id: `${this.id}-${mode}`,
          geometry: acquireSplatGeometry(this.context.device, this.props.source),
          bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
          isInstanced: true
        });
      const drawing = this.props.operation.includes('draw');
      const webgpu = this.context.device.type === 'webgpu';
      this.setState({
        model: makeModel('picking'),
        // WebGL accumulates color and optical depth through MRT. WebGPU uses the normal
        // single-target model for color and a dedicated optical-depth pass.
        accumulationModel: drawing && !webgpu ? makeModel('accumulation') : undefined,
        transmissionModel: drawing && webgpu ? makeModel('transmission') : undefined
      });
      this.getAttributeManager()!.invalidateAll();
    }
  }

  getModels(): Model[] {
    return [this.state.model, this.state.accumulationModel, this.state.transmissionModel].filter(
      (model): model is Model => Boolean(model)
    );
  }

  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]) {
    super.setShaderModuleProps(withPickingShadowBindings(this, props));
  }

  private calculateWindData(attribute, {startRow, endRow}) {
    const {iterable, objectInfo} = createIterable(this.props.data, startRow, endRow);
    const get = (accessor, object) =>
      typeof accessor === 'function' ? accessor(object, objectInfo) : accessor;
    for (const object of iterable) {
      objectInfo.index++;
      const cacheable = object !== null && typeof object === 'object';
      let wind = cacheable ? this.state.windRows.get(object) : undefined;
      if (!wind) {
        const [height, phase, flex] = get(this.props.getDeformation, object);
        wind = [
          height,
          flex,
          Math.sin(phase),
          Math.cos(phase),
          Math.sin(phase * 1.7),
          Math.cos(phase * 1.7)
        ];
        if (cacheable) this.state.windRows.set(object, wind);
      }
      const offset = objectInfo.index * 7;
      for (let i = 0; i < 4; i++) attribute.value[offset + i] = wind[i];
      attribute.value[offset + 4] = get(this.props.getCoverageWeight, object);
      attribute.value[offset + 5] = wind[4];
      attribute.value[offset + 6] = wind[5];
    }
  }

  private calculateTransforms(attribute, {startRow, endRow}) {
    const {iterable, objectInfo} = createIterable(this.props.data, startRow, endRow);
    const get = (accessor, object) =>
      typeof accessor === 'function' ? accessor(object, objectInfo) : accessor;
    for (const object of iterable) {
      objectInfo.index++;
      attribute.value.set(
        getSplatTransform(
          get(this.props.getOrientation, object),
          get(this.props.getScale, object),
          get(this.props.getTranslation, object),
          get(this.props.getTransformMatrix, object)
        ),
        objectInfo.index * 12
      );
    }
  }

  draw({shaderModuleProps, renderPass}) {
    const pickingActive = shaderModuleProps.picking?.isActive;
    const mode = shaderModuleProps.splat?.mode ?? 0;
    // deck.gl's shadow pass. Its 9.4 shadow module has no WGSL: no WebGPU shader reads the map.
    const shadowPass = Boolean(shaderModuleProps.shadow?.drawToShadowMap);
    if (shadowPass && this.context.device.type === 'webgpu') return;
    if (shadowPass) clearShadowDepthOffset(this);
    if (!pickingActive && mode === 0 && !shadowPass) {
      if (shaderModuleProps.splat?.resolve)
        this.state.effect.resolve(renderPass, shaderModuleProps.project.viewport.id);
      if (this.props.deformationStrength > 0 && this.props.deformationTime === null)
        this.setNeedsRedraw();
      return;
    }
    const {deformationStrength, deformationTime, kernelVariance, alphaCutoff, support} = this.props;
    const time = deformationTime ?? this.context.timeline.getTime() / 1000;
    const model =
      mode === 1
        ? this.state.accumulationModel || this.state.model
        : mode === 2
          ? this.state.transmissionModel
          : this.state.model;
    model?.shaderInputs.setProps({
      splat: {
        strength: deformationStrength,
        time,
        wave: [
          Math.sin(time * 1.6),
          Math.cos(time * 1.6),
          Math.sin(time * 3.2),
          Math.cos(time * 3.2)
        ],
        opticalDepthMode: this.props.source.opticalDepths ? 1 : 0,
        kernelVariance,
        alphaCutoff,
        support,
        mode
      },
      phongMaterial: this.props.material
    });
    if (mode === 4) {
      if (this.props.transparency === 'sorted' && model) this.state.effect.collect(this, model);
      return;
    }
    model?.setInstanceCount(this.getNumInstances());
    model?.draw(renderPass);
    if (deformationStrength > 0 && deformationTime === null) this.setNeedsRedraw();
  }
}
