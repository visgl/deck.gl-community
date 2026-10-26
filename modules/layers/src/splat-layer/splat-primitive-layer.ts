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
import {prepareShadowDraw} from './splat-shadow';
import {SPLAT_WGSL, getSplatAccumulationWGSL, getSplatTransmissionWGSL} from './splat.wgsl.js';

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
   * The vertex attributes use 15 of the 16 slots WebGL2 and WebGPU guarantee, leaving one for a
   * subclass's per-instance attribute. Per-object color filters such as `SelectionPulseExtension`
   * read their data by instance index. The WGSL exposes `WGSL_FILTER_COLOR_ANCHOR`.
   */
  static instanceColorFilters = true;
  /** Marks this class and its subclasses as Gaussian primitives for `SplatEffect`'s passes. */
  static splatPrimitive = true;
  declare state: {
    model?: Model;
    accumulationModel?: Model;
    transmissionModel?: Model;
    effect: SplatEffect;
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
      instanceCoverageWeight: {size: 1, accessor: 'getCoverageWeight', defaultValue: 1},
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
    this.setState({effect: SplatEffect.get(this.context.deck)});
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
    const coverage = params.props._coverageRanges;
    if (coverage && coverage !== params.oldProps._coverageRanges)
      for (const range of coverage)
        this.getAttributeManager()!.invalidate('getCoverageWeight', range);
    if (params.props.source !== params.oldProps.source || params.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.accumulationModel?.destroy();
      this.state.transmissionModel?.destroy();
      // Derive the weighted passes from this layer's own shaders, so a subclass's patch reaches them.
      const shaders = this.getShaders();
      const makeModel = (mode: 'picking' | 'accumulation' | 'transmission') =>
        new Model(this.context.device, {
          ...shaders,
          ...(mode === 'accumulation'
            ? {fs: SPLAT_ACCUMULATION_FRAGMENT, source: getSplatAccumulationWGSL(shaders.source)}
            : mode === 'transmission'
              ? {fs: SPLAT_TRANSMISSION_FRAGMENT, source: getSplatTransmissionWGSL(shaders.source)}
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
    // A repeated MapView draws each wrapped world copy with its own viewport object. Owners are
    // selected for, and composited into, the primary copy only: shifted duplicates would add to the
    // shared optical targets and resolve them once per copy.
    const viewport = shaderModuleProps.project.viewport;
    if (viewport !== this.context.viewport && viewport.id === this.context.viewport?.id) return;
    const pickingActive = shaderModuleProps.picking?.isActive;
    const mode = shaderModuleProps.splat?.mode ?? 0;
    if (shaderModuleProps.shadow?.drawToShadowMap) {
      if (!prepareShadowDraw(this)) return;
    } else if (!pickingActive && mode === 0) {
      if (shaderModuleProps.splat?.resolve)
        this.state.effect.resolve(renderPass, shaderModuleProps.project.viewport.id);
      return;
    }
    const {kernelVariance, alphaCutoff, support} = this.props;
    const model =
      mode === 1
        ? this.state.accumulationModel || this.state.model
        : mode === 2
          ? this.state.transmissionModel
          : this.state.model;
    model?.shaderInputs.setProps({
      splat: {
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
  }
}
