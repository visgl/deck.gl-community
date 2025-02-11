// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PathLayerProps} from '@deck.gl/layers';
import {PathLayer} from '@deck.gl/layers';
import type {ShaderModule} from '@luma.gl/shadertools';

import {insertBefore} from '../utils/utils';

const uniformBlock = `\
uniform pickingLineWidthUniforms {
  float extraPixels;
} pickingLineWidth;
`;

export type PickingLineWidthProps = {
  extraPixels: number;
};

export const pickingUniforms = {
  name: 'pickingLineWidth',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    extraPixels: 'f32'
  }
} as const satisfies ShaderModule<PickingLineWidthProps>;

interface EditablePathLayerProps extends PathLayerProps<any> {
  pickingLineWidthExtraPixels?: number;
}

const defaultProps = {
  ...PathLayer.defaultProps,
  pickingLineWidthExtraPixels: {type: 'number', min: 0, value: Number.MAX_SAFE_INTEGER}
};

export class EditablePathLayer extends PathLayer<any, EditablePathLayerProps> {
  getShaders() {
    const shaders = super.getShaders();

    shaders.vs = insertBefore(
      shaders.vs,
      'vec3 width;',
      `
       if(bool(picking.isActive)){
        widthPixels.xy += pickingLineWidth.extraPixels;
       }
      `
    );

    return {
      ...shaders,
      modules: [...shaders.modules, pickingUniforms]
    };
  }

  draw(props) {
    const {pickingLineWidthExtraPixels} = this.props;
    const pickingProps: PickingLineWidthProps = {extraPixels: pickingLineWidthExtraPixels};
    const model = this.state.model;
    model.shaderInputs.setProps({pickingLineWidth: pickingProps});
    super.draw(props);
  }
}

EditablePathLayer.defaultProps = defaultProps;
EditablePathLayer.layerName = 'EditablePathLayer';
