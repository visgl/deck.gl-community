// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// import {ScatterplotLayer} from '@deck.gl/layers';
import type {ShaderModule} from '@luma.gl/shadertools';
import type {Model} from '@luma.gl/engine';
import {fs} from './rounded-rectangle-layer-fragment';
import {RectangleLayer, type RectangleLayerProps} from './rectangle-layer';

const uniformBlock = `\
uniform roundedRectangleUniforms {
  float cornerRadius;
} roundedRectangle;
`;

export type RoundedRectangleProps = {
  cornerRadius: number;
};

export const roundedRectangleUniforms = {
  name: 'roundedRectangle',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    cornerRadius: 'f32'
  }
} as const satisfies ShaderModule<RoundedRectangleProps>;

/** Props for the {@link RoundedRectangleLayer} composite layer. */
export type RoundedRectangleLayerProps = RectangleLayerProps & {
  /** Radius applied to each rectangle corner in world units. */
  cornerRadius: number;
};

export class RoundedRectangleLayer extends RectangleLayer {
  static layerName = 'RoundedRectangleLayer';

  declare props: RoundedRectangleLayerProps;

  draw(props: Parameters<RectangleLayer['draw']>[0]) {
    const {cornerRadius} = this.props;
    const roundedRectangleProps: RoundedRectangleProps = {cornerRadius};
    const model = this.state.model as Model;
    model.shaderInputs.setProps({roundedRectangle: roundedRectangleProps});
    super.draw(props);
  }

  getShaders() {
    // use object.assign to make sure we don't overwrite existing fields like `vs`, `modules`...
    const shaders = super.getShaders(undefined!);
    return {
      ...shaders,
      fs,
      modules: [...shaders.modules, roundedRectangleUniforms]
    };
  }
}

RoundedRectangleLayer.defaultProps = {
  // cornerRadius: the amount of rounding at the rectangle corners
  // 0 - rectangle. 1 - circle.
  cornerRadius: 0.1
};
