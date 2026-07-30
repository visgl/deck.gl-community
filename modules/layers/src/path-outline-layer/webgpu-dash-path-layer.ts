// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PathLayer} from '@deck.gl/layers';

import type {NumericArray} from '@math.gl/core';
import type {ShaderModule, ShaderPlugin} from '@luma.gl/shadertools';

type WebGpuPathStyleProps = {
  dashAlignMode: number;
  dashGapPickable: number;
};

type WebGpuDashPathProps = {
  dashJustified?: boolean;
  dashGapPickable?: boolean;
};

const webgpuPathStyleUniforms = {
  name: 'webgpuPathStyle',
  source: /* wgsl */ `\
struct WebGpuPathStyleUniforms {
  dashAlignMode: f32,
  dashGapPickable: i32,
};

@group(0) @binding(auto) var<uniform> webgpuPathStyle: WebGpuPathStyleUniforms;
`,
  uniformTypes: {
    dashAlignMode: 'f32',
    dashGapPickable: 'i32'
  }
} as const satisfies ShaderModule<WebGpuPathStyleProps>;

const webgpuPathStylePlugin: ShaderPlugin = {
  name: 'webgpu-path-style',
  wgsl: {
    modules: [webgpuPathStyleUniforms],
    vertexInputs: {
      instanceDashArrays: 'vec2<f32>',
      instanceDashOffsets: 'f32'
    },
    varyings: {
      webgpuDashArray: {type: 'vec2<f32>'},
      webgpuDashOffset: {type: 'f32'}
    },
    injections: [
      {
        target: 'vs:#main-end',
        injection: /* wgsl */ `\
webgpuDashArray = instanceDashArrays;
webgpuDashOffset = instanceDashOffsets / max(widthPixels, 0.0001);
`
      },
      {
        target: 'fs:#main-start',
        injection: /* wgsl */ `\
let solidLength = webgpuDashArray.x;
let gapLength = webgpuDashArray.y;
var unitLength = solidLength + gapLength;
var dashOffset = webgpuDashOffset;

if (unitLength > 0.0) {
  if (webgpuPathStyle.dashAlignMode > 0.5) {
    unitLength = varyings.vPathLength / max(round(varyings.vPathLength / unitLength), 1.0);
    dashOffset = solidLength / 2.0;
  }

  let positionInUnit = varyings.vPathPosition.y + dashOffset;
  let unitOffset = positionInUnit - floor(positionInUnit / unitLength) * unitLength;
  if (gapLength > 0.0 && unitOffset > solidLength) {
    if (path.capType <= 0.5) {
      if (!(webgpuPathStyle.dashGapPickable != 0 && picking.isActive > 0.5)) {
        discard;
      }
    } else {
      let distanceToSolid = length(vec2<f32>(
        min(unitOffset - solidLength, unitLength - unitOffset),
        varyings.vPathPosition.x
      ));
      if (distanceToSolid > 1.0 &&
          !(webgpuPathStyle.dashGapPickable != 0 && picking.isActive > 0.5)) {
        discard;
      }
    }
  }
}
`
      }
    ]
  }
};

/**
 * PathLayer variant that supplies the missing WGSL half of PathStyleExtension.
 *
 * @remarks
 * This is internal compatibility code for deck.gl 9.4 alpha.2. The upstream path geometry is
 * reused unchanged; only dash attributes, varyings, and fragment masking are added.
 *
 * @internal
 */
export class WebGpuDashPathLayer extends PathLayer<any, WebGpuDashPathProps> {
  static override layerName = 'WebGpuDashPathLayer';

  override initializeState(): void {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceDashArrays: {
        size: 2,
        accessor: 'getDashArray'
      },
      instanceDashOffsets: {
        size: 1,
        accessor: 'getPath',
        transform: this.getDashOffsets.bind(this)
      }
    });
  }

  override getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      plugins: [...(shaders.plugins ?? []), webgpuPathStylePlugin]
    };
  }

  override draw(params): void {
    this.state.model!.shaderInputs.setProps({
      webgpuPathStyle: {
        dashAlignMode: this.props.dashJustified ? 1 : 0,
        dashGapPickable: this.props.dashGapPickable ? 1 : 0
      }
    });
    super.draw(params);
  }

  private getDashOffsets(path: NumericArray | NumericArray[]): number[] {
    const result = [0];
    const positionSize = this.props.positionFormat === 'XY' ? 2 : 3;
    const isNested = Array.isArray(path[0]);
    const geometrySize = isNested ? path.length : path.length / positionSize;
    let previousPosition: number[] | undefined;

    for (let index = 0; index < geometrySize - 1; index++) {
      const position = isNested
        ? (path[index] as NumericArray)
        : (path as NumericArray).slice(index * positionSize, index * positionSize + positionSize);
      const projectedPosition = this.projectPosition(position as number[]);
      if (index > 0) {
        result[index] =
          result[index - 1] +
          Math.hypot(...projectedPosition.map((x, i) => x - previousPosition![i]));
      }
      previousPosition = projectedPosition;
    }

    result[geometrySize - 1] = 0;
    return result;
  }
}
