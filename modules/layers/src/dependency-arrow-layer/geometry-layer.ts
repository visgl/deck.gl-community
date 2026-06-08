// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Layer, picking, project32, UNIT} from '@deck.gl/core';
import {Geometry, Model} from '@luma.gl/engine';

import type {
  Accessor,
  Color,
  DefaultProps,
  LayerProps,
  Position,
  Unit,
  UpdateParameters
} from '@deck.gl/core';

/** Properties supported by the internal dependency marker geometry layer. */
export type GeometryLayerProps<DataT = unknown> = LayerProps & _GeometryLayerProps<DataT>;

type _GeometryLayerProps<DataT> = {
  /** Units used by marker size. @defaultValue 'common' */
  sizeUnits?: Unit;
  /** Scale applied to marker size. @defaultValue 1 */
  sizeScale?: number;

  /** Retained for API compatibility with existing callers. */
  nodeDepth?: unknown;

  /** Marker interpolation route. @defaultValue 'line' */
  interpolationMode?: 'line' | 'arc';

  /** Accessor returning encoded picking color. */
  getPickingColor?: Accessor<DataT, Color>;
  /** Accessor returning the marker segment start. */
  getSourcePosition?: Accessor<DataT, Position>;
  /** Accessor returning the marker segment end. */
  getTargetPosition?: Accessor<DataT, Position>;
  /** Accessor returning marker position ratio along the segment. */
  getPositionRatio?: Accessor<DataT, number>;
  /** Accessor returning marker bounding box as `[along, width]`. */
  getSize?: Accessor<DataT, [number, number]>;
  /** Accessor returning marker color as `[R, G, B, A?]`. */
  getColor?: Accessor<DataT, Color>;

  /** Accessor returning arc height when `interpolationMode` is `'arc'`. */
  getArcHeight?: Accessor<DataT, number>;
  /** Accessor returning arc tilt when `interpolationMode` is `'arc'`. */
  getArcTilt?: Accessor<DataT, number>;
};

type GeometryLayerUniformProps = {
  sizeScale: number;
  sizeUnits: number;
  interpolationMode: number;
};

const geometryLayerUniforms = {
  name: 'geometryLayer',
  vs: `\
uniform geometryLayerUniforms {
  float sizeScale;
  highp int sizeUnits;
  highp int interpolationMode;
} geometryLayer;
`,
  fs: `\
uniform geometryLayerUniforms {
  float sizeScale;
  highp int sizeUnits;
  highp int interpolationMode;
} geometryLayer;
  `,
  uniformTypes: {
    sizeScale: 'f32',
    sizeUnits: 'i32',
    interpolationMode: 'i32'
  }
} as const;

const defaultProps: DefaultProps<_GeometryLayerProps<any>> = {
  sizeUnits: 'common',
  sizeScale: {type: 'number', min: 0, value: 1},

  interpolationMode: 'line',

  getPickingColor: {type: 'accessor', value: [0, 0, 0]},
  getSourcePosition: {type: 'accessor', value: (x: any) => x.source},
  getTargetPosition: {type: 'accessor', value: (x: any) => x.target},
  getPositionRatio: {type: 'accessor', value: 1},
  getSize: {type: 'accessor', value: [1, 1]},
  getColor: {type: 'accessor', value: [0, 0, 0, 255]},
  getArcHeight: {type: 'accessor', value: 1},
  getArcTilt: {type: 'accessor', value: 0}
};

const vs = `\
#version 300 es
#define SHADER_NAME geometry-layer-vertex-shader

in vec2 positions;
in vec3 instanceSourcePositions;
in vec3 instanceSourcePositions64Low;
in vec3 instanceTargetPositions;
in vec3 instanceTargetPositions64Low;
in float instanceRatios;
in vec2 instanceSizes;
in vec4 instanceColors;
in float instanceArcHeights;
in float instanceArcTilts;
in vec3 instancePickingColors;

out vec4 vColor;
out vec2 vPosition;
flat out vec2 vPixelSize;

const int GEOMETRY_LINE = 0;
const int GEOMETRY_ARC = 1;

// START ARC LAYER VERTEX

float paraboloid(float distance, float sourceZ, float targetZ, float ratio) {
  float deltaZ = targetZ - sourceZ;
  float dh = distance * instanceArcHeights;
  if (dh == 0.0) {
    return sourceZ + deltaZ * ratio;
  }
  float unitZ = deltaZ / dh;
  float p2 = unitZ * unitZ + 1.0;

  // sqrt does not deal with negative values, manually flip source and target if delta.z < 0
  float dir = step(deltaZ, 0.0);
  float z0 = mix(sourceZ, targetZ, dir);
  float r = mix(ratio, 1.0 - ratio, dir);
  return sqrt(r * (p2 - r)) * dh + z0;
}

vec3 interpolateArc(vec3 source, vec3 target, float ratio) {
  float distance = length(source.xy - target.xy);
  float z = paraboloid(distance, source.z, target.z, ratio);

  float tiltAngle = radians(instanceArcTilts);
  vec2 tiltDirection = normalize(target.xy - source.xy);
  vec2 tilt = vec2(-tiltDirection.y, tiltDirection.x) * z * sin(tiltAngle);

  return vec3(
    mix(source.xy, target.xy, ratio) + tilt,
    z * cos(tiltAngle)
  );
}

// END ARC LAYER VERTEX

vec3 interplolatePath(vec3 source, vec3 target, float ratio) {
  if (geometryLayer.interpolationMode == GEOMETRY_ARC) {
    return interpolateArc(source, target, ratio);
  }
  return mix(source, target, ratio);
}

void main(void) {
  geometry.worldPosition = instanceSourcePositions;
  geometry.worldPositionAlt = instanceTargetPositions;
  vPosition = (positions + 1.0) / 2.0;
  geometry.uv = vPosition;

  vec3 source = project_position(instanceSourcePositions, instanceSourcePositions64Low);
  vec3 target = project_position(instanceTargetPositions, instanceTargetPositions64Low);
  vec3 curr = interplolatePath(source, target, instanceRatios);
  vec2 normal;
  if (instanceRatios < 0.01) {
    vec3 next = interplolatePath(source, target, instanceRatios + 0.01);
    normal = next.xy - curr.xy;
  } else {
    vec3 prev = interplolatePath(source, target, instanceRatios - 0.01);
    normal = curr.xy - prev.xy;
  }

  vec2 scaledSize = instanceSizes * geometryLayer.sizeScale;
  // Anchor the marker at the triangle tip, so ratio 1.0 places the arrowhead on the endpoint.
  vec2 markerPosition = vec2((positions.x - 1.0) / 2.0, positions.y / 2.0);
  vec2 offset = markerPosition * scaledSize;
  float angle = atan(normal.y, normal.x);
  float cosA = cos(angle);
  float sinA = sin(angle);
  offset = vec2(
    offset.x * cosA - offset.y * sinA,
    offset.x * sinA + offset.y * cosA
  );
  vec3 offsetCommon = vec3(offset, 0.);
  if (geometryLayer.sizeUnits == UNIT_PIXELS) {
    offsetCommon.xy = project_pixel_size(offset);
    vPixelSize = scaledSize;
  } else {
    vPixelSize = project_size(scaledSize);
  }

  geometry.pickingColor = instancePickingColors;
  geometry.position = vec4(curr + offsetCommon, 0.1);
  gl_Position = project_common_position_to_clipspace(geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;

const fs = `\
#version 300 es
#define SHADER_NAME geometry-layer-fragment-shader

precision highp float;

in vec4 vColor;
in vec2 vPosition;
flat in vec2 vPixelSize;

out vec4 fragColor;

float smoothedgeSigned(float signedDistance) {
  float edgeRadius = fwidth(signedDistance);
  return smoothstep(-edgeRadius, edgeRadius, signedDistance);
}

float inTriangle(vec2 bbox, vec2 uv) {
  float w = max(bbox.x, 1.0);
  float h = max(bbox.y, 1.0);
  float d = ((1.0 - abs(1.0 - uv.y * 2.0)) - uv.x) * w;
  return smoothedgeSigned(d);
}

void main(void) {
  geometry.uv = vPosition;
  float inShape = inTriangle(vPixelSize, vPosition);

  if (inShape == 0.0) {
    discard;
  }

  fragColor = vColor;
  fragColor.a *= inShape;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

/** Renders triangle markers resolved by {@link DependencyArrowLayer}. */
export class GeometryLayer<DataT = unknown> extends Layer<Required<_GeometryLayerProps<DataT>>> {
  static override defaultProps = defaultProps;
  static override layerName = 'GeometryLayer';

  override state: {
    model?: Model;
  } = {};

  override getShaders() {
    return super.getShaders({vs, fs, modules: [project32, picking, geometryLayerUniforms]});
  }

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instanceSourcePositions: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        transition: true,
        accessor: 'getSourcePosition'
      },
      instanceTargetPositions: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        transition: true,
        accessor: 'getTargetPosition'
      },
      instanceRatios: {
        size: 1,
        transition: true,
        accessor: 'getPositionRatio'
      },
      instanceArcHeights: {
        size: 1,
        transition: true,
        accessor: 'getArcHeight'
      },
      instanceArcTilts: {
        size: 1,
        transition: true,
        accessor: 'getArcTilt'
      },
      instanceSizes: {
        size: 2,
        transition: true,
        accessor: 'getSize'
      },
      instanceColors: {
        size: 4,
        transition: true,
        type: 'unorm8',
        accessor: 'getColor',
        defaultValue: [0, 0, 0, 255]
      },
      instancePickingColors: {
        size: 3,
        type: 'uint8',
        accessor: 'getPickingColor'
      }
    });
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    if (params.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = this._getModel();
      this.getAttributeManager()!.invalidateAll();
    }
  }

  override draw() {
    const model = this.state.model;
    if (!model) {
      return;
    }

    const {sizeScale, sizeUnits, interpolationMode} = this.props;

    const geometryLayerProps: GeometryLayerUniformProps = {
      sizeScale,
      sizeUnits: UNIT[sizeUnits],
      interpolationMode: interpolationMode === 'line' ? 0 : 1
    };

    model.shaderInputs.setProps({geometryLayer: geometryLayerProps});
    model.draw(this.context.renderPass);
  }

  protected _getModel(): Model {
    // A square that minimally covers the unit circle.
    const positions = [-1, -1, 1, -1, -1, 1, 1, 1];

    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: {size: 2, value: new Float32Array(positions)}
        }
      }),
      isInstanced: true
    });
  }
}
