// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _GlobeViewport,
  Layer,
  OrbitViewport,
  type DefaultProps,
  type LayerProps,
  type Viewport
} from '@deck.gl/core';
import {Geometry, Model, ShaderInputs} from '@luma.gl/engine';
import {Matrix4} from '@math.gl/core';
import {SKY_FS, SKY_VS, SKY_WGSL, skyUniforms} from './sky-layer-shaders';

type Direction = readonly [number, number, number];

type _SkyLayerProps = {
  /**
   * Direction toward the sun in east, north, up order. For Cartesian views these
   * axes are X, Y, Z, except for Y-up OrbitView where they are X, -Z, Y.
   * The layer normalizes the vector. @default [0, 1, 0.35]
   */
  sunDirection?: Direction;
  /** Aerosol optical depth at 550 nm. Larger values produce more haze. @default 0.12 */
  aerosolOpticalDepth?: number;
  /** Linear brightness multiplier before display mapping. @default 1 */
  exposure?: number;
};

export type SkyLayerProps = _SkyLayerProps & LayerProps;

const DEFAULT_SUN: Direction = [0, 1, 0.35];
const DEFAULT_SUN_LENGTH = Math.hypot(...DEFAULT_SUN);
const DEFAULT_PROPS: DefaultProps<SkyLayerProps> = {
  sunDirection: {type: 'array', value: DEFAULT_SUN, compare: true},
  aerosolOpticalDepth: {type: 'number', value: 0.12, min: 0, max: 2},
  exposure: {type: 'number', value: 1, min: 0, max: 32}
};
const BACKGROUND_PARAMETERS = {
  cullMode: 'none',
  depthCompare: 'less-equal',
  depthWriteEnabled: false
} as const;

// A coarse grid integrates clear air at the vertices. The fragment shader resolves the sun and its glow.
function getGeometry(): Geometry {
  const columns = 32;
  const rows = 24;
  const positions = new Float32Array((columns + 1) * (rows + 1) * 2);
  const indices = new Uint16Array(columns * rows * 6);
  let offset = 0;
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions[offset++] = (2 * column) / columns - 1;
      positions[offset++] = (2 * row) / rows - 1;
    }
  }
  offset = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.set([a, b, d, a, d, c], offset);
      offset += 6;
    }
  }
  return new Geometry({
    topology: 'triangle-list',
    attributes: {positions: {size: 2, value: positions}},
    indices
  });
}

/** Builds the clip-space to sky-space ray transform without camera translation. */
function getClipToLocal(viewport: Viewport): Matrix4 {
  const camera = new Matrix4(viewport.viewMatrixUncentered || viewport.viewMatrix);
  camera[12] = 0;
  camera[13] = 0;
  camera[14] = 0;
  const rays = camera.invert().multiplyRight(new Matrix4(viewport.projectionMatrix).invert());

  if (viewport instanceof _GlobeViewport) {
    const longitude = (viewport.longitude * Math.PI) / 180;
    const latitude = (viewport.latitude * Math.PI) / 180;
    const sinLongitude = Math.sin(longitude);
    const cosLongitude = Math.cos(longitude);
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    // GlobeView stores rays in world coordinates. Express them in the tangent frame at the target.
    return new Matrix4([
      cosLongitude,
      -sinLongitude * sinLatitude,
      sinLongitude * cosLatitude,
      0,
      sinLongitude,
      cosLongitude * sinLatitude,
      -cosLongitude * cosLatitude,
      0,
      0,
      cosLatitude,
      sinLatitude,
      0,
      0,
      0,
      0,
      1
    ]).multiplyRight(rays);
  }
  if (viewport instanceof OrbitViewport && viewport.orbitAxis === 'Y') {
    return new Matrix4().rotateX(Math.PI / 2).multiplyRight(rays);
  }
  return rays;
}

function getSunDirection(direction: Direction): Direction {
  const [x, y, z] = direction ?? DEFAULT_SUN;
  const length = Math.hypot(x, y, z);
  return Number.isFinite(length) && length > 0
    ? [x / length, y / length, z / length]
    : [0, 1 / DEFAULT_SUN_LENGTH, 0.35 / DEFAULT_SUN_LENGTH];
}

function getBoundedValue(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : fallback;
}

/** A procedural clear-sky background with atmospheric scattering and a visible sun. */
export class SkyLayer<ExtraProps extends {} = {}> extends Layer<
  Required<_SkyLayerProps> & ExtraProps
> {
  static layerName = 'SkyLayer';
  static defaultProps = DEFAULT_PROPS;

  declare state: {model: Model};

  initializeState(): void {
    this.getAttributeManager()?.remove(['instancePickingColors']);
    this.setState({
      model: new Model(this.context.device, {
        id: this.props.id,
        geometry: getGeometry(),
        shaderInputs: new ShaderInputs({sky: skyUniforms}, {disableWarnings: true}),
        vs: SKY_VS,
        fs: SKY_FS,
        source: SKY_WGSL,
        parameters: BACKGROUND_PARAMETERS
      })
    });
  }

  draw({renderPass, shaderModuleProps}: Parameters<Layer['draw']>[0]): void {
    if (shaderModuleProps?.picking?.isActive || shaderModuleProps?.shadow?.drawToShadowMap) return;
    const {aerosolOpticalDepth, sunDirection, exposure, opacity} = this.props;
    const {model} = this.state;
    model.setParameters({...model.parameters, ...BACKGROUND_PARAMETERS});
    model.shaderInputs.setProps({
      sky: {
        clipToLocal: getClipToLocal(this.context.viewport),
        sunDirection: getSunDirection(sunDirection),
        aerosolOpticalDepth: getBoundedValue(aerosolOpticalDepth, 0.12, 2),
        exposure: getBoundedValue(exposure, 1, 32),
        opacity
      }
    });
    model.draw(renderPass);
  }
}
