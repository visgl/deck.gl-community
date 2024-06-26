// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// import {ScatterplotLayer} from '@deck.gl/layers';
import {fs} from './rounded-rectangle-layer-fragment';
import {RectangleLayer} from './rectangle-layer';

export class RoundedRectangleLayer extends RectangleLayer {
  static layerName = 'RoundedRectangleLayer';
  draw({uniforms}) {
    super.draw({
      uniforms: {
        ...uniforms,
        cornerRadius: (this.props as any).cornerRadius
      }
    });
  }

  getShaders() {
    // use object.assign to make sure we don't overwrite existing fields like `vs`, `modules`...
    return Object.assign({}, super.getShaders(undefined!), {
      fs
    });
  }
}

RoundedRectangleLayer.defaultProps = {
  // cornerRadius: the amount of rounding at the rectangle corners
  // 0 - rectangle. 1 - circle.
  cornerRadius: 0.1
};
