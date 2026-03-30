// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PathLayerProps} from '@deck.gl/layers';
import {PathLayer} from '@deck.gl/layers';
import type {DefaultProps, LayerContext} from '@deck.gl/core';
import {Framebuffer} from '@luma.gl/core';
import type {RenderPipelineParameters, Texture} from '@luma.gl/core';
import {outline} from './outline';

/**
 * Unit literal to shader unit number conversion.
 */
export const UNIT = {
  common: 0,
  meters: 1,
  pixels: 2
};

// TODO - this should be built into assembleShaders
function injectShaderCode({source, code = ''}) {
  const INJECT_CODE = /}[^{}]*$/;
  return source.replace(INJECT_CODE, code.concat('\n}\n'));
}

const VS_CODE = `\
  outline_setUV(gl_Position);
  outline_setZLevel(instanceZLevel);
`;

const FS_CODE = `\
  fragColor = outline_filterColor(fragColor);
`;

const OUTLINE_SHADOWMAP_PARAMETERS: RenderPipelineParameters = {
  blend: true,
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one',
  blendColorOperation: 'max',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one',
  blendAlphaOperation: 'max',
  depthWriteEnabled: false,
  depthCompare: 'always'
};

const OUTLINE_RENDER_PARAMETERS: RenderPipelineParameters = {
  blend: false,
  depthWriteEnabled: false,
  depthCompare: 'always'
};

export type PathOutlineLayerProps<DataT> = PathLayerProps<DataT> & {
  dashJustified?: boolean;
  getDashArray?: [number, number] | ((d: DataT) => [number, number] | null);
  getZLevel?: (d: DataT, index: number) => number;
};

const defaultProps: DefaultProps<PathOutlineLayerProps<any>> = {
  getZLevel: () => 0
};

export class PathOutlineLayer<DataT = any, ExtraPropsT = Record<string, unknown>> extends PathLayer<
  DataT,
  ExtraPropsT & Required<PathOutlineLayerProps<DataT>>
> {
  static layerName = 'PathOutlineLayer';
  static defaultProps = defaultProps;

  state: {
    model?: any;
    pathTesselator: any;
    outlineFramebuffer: Framebuffer;
  } = undefined!;

  // Override getShaders to inject the outline module
  getShaders() {
    const shaders = super.getShaders();
    return Object.assign({}, shaders, {
      modules: shaders.modules.concat([outline]),
      vs: injectShaderCode({source: shaders.vs, code: VS_CODE}),
      fs: injectShaderCode({source: shaders.fs, code: FS_CODE})
    });
  }

  // @ts-expect-error PathLayer is missing LayerContext arg
  initializeState(context: LayerContext) {
    super.initializeState();

    const attributeManager = this.getAttributeManager();

    if (!attributeManager) {
      throw new Error('PathOutlineLayer requires an attribute manager during initialization.');
    }

    // Create an outline "shadow" map
    // TODO - we should create a single outlineMap for all layers
    const outlineFramebuffer = context.device.createFramebuffer({
      colorAttachments: [
        context.device.createTexture({
          format: 'rgba8unorm',
          width: 1,
          height: 1,
          mipLevels: 1
        })
      ]
    });

    attributeManager.addInstanced({
      instanceZLevel: {
        size: 1,
        type: 'uint8',
        accessor: 'getZLevel'
      }
    });

    this.setState({
      outlineFramebuffer,
      model: this._getModel()
    });
  }

  finalizeState(context: LayerContext) {
    this.state.outlineFramebuffer?.destroy();
    super.finalizeState(context);
  }

  // Override draw to add render module
  draw() {
    const model = this.state.model;
    const outlineFramebuffer = this.state.outlineFramebuffer;

    if (!model || !outlineFramebuffer) {
      return;
    }

    const viewport = this.context.viewport;
    const viewportWidth = Math.max(1, Math.ceil(viewport.width));
    const viewportHeight = Math.max(1, Math.ceil(viewport.height));

    outlineFramebuffer.resize({width: viewportWidth, height: viewportHeight});

    const shadowmapTexture = getFramebufferTexture(outlineFramebuffer);

    if (!shadowmapTexture) {
      return;
    }

    const {
      jointRounded,
      capRounded,
      billboard,
      miterLimit,
      widthUnits,
      widthScale,
      widthMinPixels,
      widthMaxPixels
    } = this.props;

    const basePathProps = {
      jointType: Number(jointRounded),
      capType: Number(capRounded),
      billboard,
      widthUnits: UNIT[widthUnits],
      widthScale,
      miterLimit,
      widthMinPixels,
      widthMaxPixels
    };

    // Render the outline shadowmap (based on segment z orders)
    this.setShaderModuleProps({
      outline: {
        outlineEnabled: true,
        outlineRenderShadowmap: true,
        outlineShadowmap: shadowmapTexture
      }
    });
    model.shaderInputs.setProps({
      path: {
        ...basePathProps,
        jointType: 0,
        widthScale: widthScale * 1.3
      }
    });
    model.setParameters(OUTLINE_SHADOWMAP_PARAMETERS);
    const shadowRenderPass = this.context.device.beginRenderPass({
      id: `${this.props.id}-outline-shadowmap`,
      framebuffer: outlineFramebuffer,
      parameters: {viewport: [0, 0, viewportWidth, viewportHeight]},
      clearColor: [0, 0, 0, 0],
      clearDepth: 1,
      clearStencil: 0
    });
    model.draw(shadowRenderPass);
    shadowRenderPass.end();

    // Now use the outline shadowmap to render the lines (with outlines)
    this.setShaderModuleProps({
      outline: {
        outlineEnabled: true,
        outlineRenderShadowmap: false,
        outlineShadowmap: shadowmapTexture
      }
    });
    model.shaderInputs.setProps({
      path: basePathProps
    });
    model.setParameters(OUTLINE_RENDER_PARAMETERS);
    model.draw(this.context.renderPass);
  }
}

function getFramebufferTexture(framebuffer: Framebuffer): Texture | null {
  const colorAttachment = framebuffer.colorAttachments[0];

  if (!colorAttachment) {
    return null;
  }

  return 'texture' in colorAttachment ? colorAttachment.texture : colorAttachment;
}
