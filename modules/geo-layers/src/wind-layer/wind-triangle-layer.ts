// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {color, Layer, picking, project32} from '@deck.gl/core';
import {Geometry, Model} from '@luma.gl/engine';

import source from './wind-triangle-layer.wgsl';

import type {
  Accessor,
  Color,
  DefaultProps,
  LayerProps,
  Position,
  UpdateParameters
} from '@deck.gl/core';

type _WindTriangleLayerProps<DataT> = {
  getFirstPosition?: Accessor<DataT, Position>;
  getSecondPosition?: Accessor<DataT, Position>;
  getThirdPosition?: Accessor<DataT, Position>;
  getColor?: Accessor<DataT, Color>;
};

/** @internal Props for the dual-backend triangle primitive used by wind sublayers. */
export type WindTriangleLayerProps<DataT> = LayerProps & _WindTriangleLayerProps<DataT>;

const defaultProps: DefaultProps<_WindTriangleLayerProps<any>> = {
  getFirstPosition: {type: 'accessor', value: [0, 0, 0]},
  getSecondPosition: {type: 'accessor', value: [0, 0, 0]},
  getThirdPosition: {type: 'accessor', value: [0, 0, 0]},
  getColor: {type: 'accessor', value: [0, 0, 0, 255]}
};

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME wind-triangle-layer-vertex-shader

in vec2 positions;
in vec3 instanceFirstPositions;
in vec3 instanceSecondPositions;
in vec3 instanceThirdPositions;
in vec4 instanceColors;
in vec3 instancePickingColors;

out vec4 vColor;

void main(void) {
  vec3 position =
    instanceFirstPositions * (1.0 - positions.x - positions.y) +
    instanceSecondPositions * positions.x +
    instanceThirdPositions * positions.y;

  geometry.worldPosition = position;
  geometry.pickingColor = instancePickingColors;
  gl_Position = project_position_to_clipspace(
    position,
    vec3(0.0),
    vec3(0.0),
    geometry.position
  );
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME wind-triangle-layer-fragment-shader

precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main(void) {
  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

/**
 * Internal dual-backend triangle primitive for wind glyphs and station terrain.
 *
 * @internal
 */
export class WindTriangleLayer<DataT> extends Layer<Required<_WindTriangleLayerProps<DataT>>> {
  static override layerName = 'WindTriangleLayer';
  static override defaultProps = defaultProps;

  override state: {model?: Model} = {};

  override getShaders() {
    return super.getShaders({source, vs, fs, modules: [project32, color, picking]});
  }

  override initializeState(): void {
    this.getAttributeManager()!.addInstanced({
      instanceFirstPositions: {
        size: 3,
        accessor: 'getFirstPosition',
        transition: true
      },
      instanceSecondPositions: {
        size: 3,
        accessor: 'getSecondPosition',
        transition: true
      },
      instanceThirdPositions: {
        size: 3,
        accessor: 'getThirdPosition',
        transition: true
      },
      instanceColors: {
        size: 4,
        type: 'unorm8',
        accessor: 'getColor',
        defaultValue: [0, 0, 0, 255],
        transition: true
      }
    });
  }

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    if (params.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = new Model(this.context.device, {
        ...this.getShaders(),
        id: this.props.id,
        bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
        geometry: new Geometry({
          topology: 'triangle-list',
          attributes: {
            positions: {size: 2, value: new Float32Array([0, 0, 1, 0, 0, 1])}
          }
        }),
        isInstanced: true
      });
      this.getAttributeManager()!.invalidateAll();
    }
  }

  override draw(): void {
    this.state.model?.draw(this.context.renderPass);
  }
}
