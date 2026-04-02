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
  modelMatrix: number[];
  viewMatrix: number[];
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

const SKYBOX_MODEL_MATRIX = new Matrix4().scale([2, 2, 2]);

const defaultProps: DefaultProps<SkyboxLayerProps> = {
  cubemap: null,
  loadOptions: null
};

type _SkyboxLayerProps = {
  cubemap: string | TextureCubeManifest | null;
  loadOptions?: TextureCubeLoaderOptions | null;
};

export type SkyboxLayerProps = _SkyboxLayerProps & LayerProps;

type LoadedCubemapTexture = {
  type: 'cube';
  data: unknown[];
};

type SkyboxLayerState = {
  cubemapTexture: DynamicTexture | null;
  loadCount: number;
  model?: Model;
  shaderInputs?: ShaderInputs<{app: typeof app.props}>;
};

export class SkyboxLayer<
  ExtraProps extends Record<string, unknown> = Record<string, unknown>
> extends Layer<Required<_SkyboxLayerProps> & ExtraProps> {
  static defaultProps = defaultProps;
  static layerName = 'SkyboxLayer';

  state!: SkyboxLayerState;

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

    this._loadCubemap();
  }

  updateState({props, oldProps}: UpdateParameters<this>): void {
    if (props.cubemap !== oldProps.cubemap || props.loadOptions !== oldProps.loadOptions) {
      this._loadCubemap();
    }
  }

  finalizeState(): void {
    this.state.cubemapTexture?.destroy();
    this.state.model?.destroy();
  }

  draw(): void {
    const {model, cubemapTexture, shaderInputs} = this.state;
    if (!model || !cubemapTexture || !shaderInputs) {
      return;
    }

    const viewport = this.context.viewport;
    shaderInputs.setProps({
      app: {
        modelMatrix: SKYBOX_MODEL_MATRIX,
        viewMatrix: getSkyboxViewMatrix(viewport),
        projectionMatrix: viewport.projectionMatrix
      }
    });

    model.draw(this.context.renderPass);
  }

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

  getShaders() {
    return {
      source: SKYBOX_WGSL,
      vs: SKYBOX_VS,
      fs: SKYBOX_FS
    };
  }

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

function getSkyboxViewMatrix(viewport: Viewport): Matrix4 {
  const viewMatrix = new Matrix4(viewport.viewMatrixUncentered || viewport.viewMatrix);
  viewMatrix[12] = 0;
  viewMatrix[13] = 0;
  viewMatrix[14] = 0;
  return viewMatrix;
}

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
