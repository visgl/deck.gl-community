// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {load} from '@loaders.gl/core';
import {
  TextureCubeLoader,
  type TextureCubeLoaderOptions,
  type TextureCubeManifest
} from '@loaders.gl/textures';
import {Layer} from '@deck.gl/core';
import type {DefaultProps, LayerProps, UpdateParameters, Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import type {Device, RenderPipelineParameters} from '@luma.gl/core';
import {CubeGeometry, DynamicTexture, Model, ShaderInputs} from '@luma.gl/engine';
import type {TextureCubeData} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {convertLoadedCubemapToTextureData, createCubemapLoadOptions} from './cubemap-utils';

type AppUniforms = {
  /** World transform for the unit cube used to draw the skybox. */
  modelMatrix: number[];
  /** View transform with translation removed so the skybox stays camera-centered. */
  viewMatrix: number[];
  /** Projection transform for the active viewport. */
  projectionMatrix: number[];
};

const app: ShaderModule<AppUniforms, AppUniforms> = {
  name: 'app',
  uniformTypes: {
    modelMatrix: 'mat4x4<f32>',
    viewMatrix: 'mat4x4<f32>',
    projectionMatrix: 'mat4x4<f32>'
  }
};

const SKYBOX_PARAMETERS: RenderPipelineParameters = {
  cullMode: 'front',
  depthWriteEnabled: false,
  depthCompare: 'less-equal'
};

const SKYBOX_SCALE = new Matrix4().scale([2, 2, 2]);

const defaultProps: DefaultProps<SkyboxLayerProps> = {
  cubemap: null,
  loadOptions: null,
  orientation: 'default'
};

type _SkyboxLayerProps = {
  /** Cubemap manifest URL or manifest object to load and render. */
  cubemap: string | TextureCubeManifest | null;
  /** Optional loaders.gl texture-cube load options. */
  loadOptions?: TextureCubeLoaderOptions | null;
  /**
   * Declares how the cubemap faces are oriented relative to deck.gl's Z-up
   * world. Use `y-up` for cubemaps authored for Y-up scenes, such as the
   * Tycho star map faces from the luma.gl globe showcase.
   */
  orientation?: 'default' | 'y-up';
};

export type SkyboxLayerProps = _SkyboxLayerProps & LayerProps;

type LoadedCubemapTexture = {
  type: 'cube';
  data: unknown[];
};

type SkyboxLayerState = {
  /** Active GPU cubemap texture, if one has been loaded successfully. */
  cubemapTexture: DynamicTexture | null;
  /** Monotonic load token used to discard stale async cubemap loads. */
  loadCount: number;
  /** Backing model that renders the cube geometry. */
  model?: Model;
  /** Shader input manager for the skybox uniforms. */
  shaderInputs?: ShaderInputs<{app: typeof app.props}>;
};

/**
 * Renders a camera-centered cubemap background for `MapView`, `GlobeView`,
 * `FirstPersonView`, and other 3D-capable deck.gl views.
 */
export class SkyboxLayer<
  ExtraProps extends Record<string, unknown> = Record<string, unknown>
> extends Layer<Required<_SkyboxLayerProps> & ExtraProps> {
  static defaultProps = defaultProps;
  static layerName = 'SkyboxLayer';

  state!: SkyboxLayerState;

  /** Initializes the cube model and starts loading the cubemap texture. */
  initializeState(): void {
    const attributeManager = this.getAttributeManager();
    attributeManager?.remove(['instancePickingColors']);

    const shaderInputs = new ShaderInputs(
      createShaderInputModules(this.context.defaultShaderModules),
      {
        disableWarnings: true
      }
    );
    const model = this._getModel(shaderInputs);

    this.setState({
      cubemapTexture: null,
      loadCount: 0,
      model,
      shaderInputs
    });

    void this._loadCubemap();
  }

  /** Reloads the cubemap when its source manifest or load options change. */
  updateState({props, oldProps}: UpdateParameters<this>): void {
    if (props.cubemap !== oldProps.cubemap || props.loadOptions !== oldProps.loadOptions) {
      void this._loadCubemap();
    }
  }

  /** Releases GPU resources owned by the layer. */
  finalizeState(): void {
    this.state.cubemapTexture?.destroy();
    this.state.model?.destroy();
  }

  /** Draws the skybox cube for the current viewport. */
  draw(): void {
    const {model, cubemapTexture, shaderInputs} = this.state;
    if (!model || !cubemapTexture || !shaderInputs) {
      return;
    }

    const viewport = this.context.viewport;
    shaderInputs.setProps({
      app: {
        modelMatrix: getSkyboxModelMatrix(this.props.orientation),
        viewMatrix: getSkyboxViewMatrix(viewport),
        projectionMatrix: viewport.projectionMatrix
      }
    });

    model.draw(this.context.renderPass);
  }

  /** Creates the luma.gl model used to render the skybox cube. */
  protected _getModel(shaderInputs: ShaderInputs<{app: typeof app.props}>): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()?.getBufferLayouts() || [],
      geometry: new CubeGeometry({indices: true}),
      shaderInputs,
      isInstanced: false,
      parameters: SKYBOX_PARAMETERS
    });
  }

  /** Returns the WGSL/GLSL shader pair used by the layer. */
  getShaders() {
    return {
      source: SKYBOX_WGSL,
      vs: SKYBOX_VS,
      fs: SKYBOX_FS
    };
  }

  /** Starts an asynchronous cubemap load for the current props. */
  private async _loadCubemap(): Promise<void> {
    const {cubemap, loadOptions} = this.props;
    const nextLoadCount = this.state.loadCount + 1;
    this.setState({loadCount: nextLoadCount});

    if (!cubemap) {
      this._setCubemapTexture(null);
      return;
    }

    try {
      const loadedTexture = await loadCubemapSource(cubemap, loadOptions);
      if (this.state.loadCount !== nextLoadCount || !this.state.model) {
        return;
      }

      const cubemapData = convertLoadedCubemapToTextureData(loadedTexture);
      this._setCubemapTexture(createCubemapTexture(this.context.device, cubemapData));
    } catch (error) {
      if (this.state.loadCount === nextLoadCount) {
        this.raiseError(error as Error, 'SkyboxLayer failed to load cubemap');
      }
    }
  }

  /** Swaps the active GPU cubemap texture and updates model bindings. */
  private _setCubemapTexture(texture: DynamicTexture | null): void {
    const {cubemapTexture, model} = this.state;
    if (cubemapTexture === texture) {
      return;
    }

    cubemapTexture?.destroy();
    this.setState({cubemapTexture: texture});

    if (texture && model) {
      model.setBindings({cubeTexture: texture});
    }

    this.setNeedsRedraw('skybox cubemap updated');
  }
}

/** Loads a cubemap manifest or manifest URL through loaders.gl. */
async function loadCubemapSource(
  cubemap: string | TextureCubeManifest,
  loadOptions?: TextureCubeLoaderOptions | null
): Promise<LoadedCubemapTexture> {
  const normalizedLoadOptions = createCubemapLoadOptions(cubemap, loadOptions);

  if (typeof cubemap === 'string') {
    return (await load(cubemap, TextureCubeLoader, normalizedLoadOptions)) as LoadedCubemapTexture;
  }

  return (await TextureCubeLoader.parseText(
    JSON.stringify(cubemap),
    normalizedLoadOptions
  )) as LoadedCubemapTexture;
}

/** Creates the runtime `DynamicTexture` instance used by the skybox model. */
function createCubemapTexture(device: Device, data: TextureCubeData): DynamicTexture {
  return new DynamicTexture(device, {
    dimension: 'cube',
    data,
    mipmaps: true,
    sampler: {
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear'
    }
  });
}

/** Removes camera translation from the active view matrix for skybox rendering. */
function getSkyboxViewMatrix(viewport: Viewport): Matrix4 {
  const viewMatrix = new Matrix4(viewport.viewMatrixUncentered || viewport.viewMatrix);
  viewMatrix[12] = 0;
  viewMatrix[13] = 0;
  viewMatrix[14] = 0;
  return viewMatrix;
}

/** Returns the skybox cube transform for the requested cubemap orientation. */
function getSkyboxModelMatrix(orientation: 'default' | 'y-up' = 'default'): Matrix4 {
  if (orientation === 'y-up') {
    return new Matrix4().rotateX(Math.PI / 2).scale([2, 2, 2]);
  }

  return new Matrix4(SKYBOX_SCALE);
}

/** Converts the current shader module list into a name-indexed dictionary. */
function createShaderInputModules(defaultShaderModules: ShaderModule[]): {
  [moduleName: string]: ShaderModule;
} {
  return Object.fromEntries([app, ...defaultShaderModules].map((module) => [module.name, module]));
}

const SKYBOX_WGSL = /* wgsl */ `
struct appUniforms {
  modelMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  projectionMatrix: mat4x4<f32>,
};

@group(0) @binding(auto) var<uniform> app : appUniforms;
@group(0) @binding(auto) var cubeTexture : texture_cube<f32>;
@group(0) @binding(auto) var cubeTextureSampler : sampler;

struct VertexInputs {
  @location(0) positions : vec3<f32>,
};

struct VertexOutputs {
  @builtin(position) position : vec4<f32>,
  @location(0) direction : vec3<f32>,
};

@vertex
fn vertexMain(inputs: VertexInputs) -> VertexOutputs {
  var outputs : VertexOutputs;
  let clipPosition =
    app.projectionMatrix *
    app.viewMatrix *
    app.modelMatrix *
    vec4<f32>(inputs.positions, 1.0);
  outputs.position = vec4<f32>(clipPosition.x, clipPosition.y, clipPosition.w, clipPosition.w);
  outputs.direction = inputs.positions;
  return outputs;
}

@fragment
fn fragmentMain(inputs: VertexOutputs) -> @location(0) vec4<f32> {
  return textureSample(cubeTexture, cubeTextureSampler, normalize(inputs.direction));
}
`;

const SKYBOX_VS = /* glsl */ `#version 300 es
in vec3 positions;

uniform appUniforms {
  mat4 modelMatrix;
  mat4 viewMatrix;
  mat4 projectionMatrix;
} app;

out vec3 vDirection;

void main(void) {
  vec4 clipPosition =
    app.projectionMatrix * app.viewMatrix * app.modelMatrix * vec4(positions, 1.0);
  gl_Position = clipPosition.xyww;
  vDirection = positions;
}
`;

const SKYBOX_FS = /* glsl */ `#version 300 es
precision highp float;

uniform samplerCube cubeTexture;

in vec3 vDirection;
out vec4 fragColor;

void main(void) {
  fragColor = texture(cubeTexture, normalize(vDirection));
}
`;
