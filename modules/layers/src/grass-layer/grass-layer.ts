// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Layer, color, picking, project32} from '@deck.gl/core';
import type {
  Accessor,
  Color,
  DefaultProps,
  LayerProps,
  Position,
  UpdateParameters
} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import {grassUniforms, grassVertex, grassFragment, grassWgsl} from './grass-layer-shaders';

export type GrassLayerProps<DataT = {position: Position}> = LayerProps & {
  /** Center of each grass patch, in the layer's coordinate system. Defaults to `row.position`. */
  getPosition?: Accessor<DataT, Position>;
  /** Width east and length north of a patch, in meters. @default [4, 4] */
  getSize?: Accessor<DataT, [number, number]>;
  /** Nominal blade height in meters. @default 0.22 */
  getHeight?: Accessor<DataT, number>;
  /** Nominal blade width in meters. @default 0.025 */
  getBladeWidth?: Accessor<DataT, number>;
  /** Base blade color as an sRGB byte tuple. @default [86, 123, 49, 255] */
  getColor?: Accessor<DataT, Color>;
  /** Fraction of the patch's blade budget to draw, from zero to one. @default 1 */
  getDensity?: Accessor<DataT, number>;
  /** Integer from 0 to 16,777,215 that varies the pattern. @default 0 */
  getSeed?: Accessor<DataT, number>;
  /** Maximum blades per patch, from 1 to 4096. @default 1024 */
  bladesPerPatch?: number;
  /** Wind direction as a bearing in degrees, clockwise from north. @default 90 */
  windDirection?: number;
  /** Blade bend due to wind, from zero to one. @default 0 */
  windStrength?: number;
  /** Wind clock in seconds, or null to use the deck.gl timeline. @default null */
  windTime?: number | null;
};

const DEFAULT_COLOR: [number, number, number, number] = [86, 123, 49, 255];
const defaultProps: DefaultProps<GrassLayerProps> = {
  getPosition: {type: 'accessor', value: row => row.position},
  getSize: {type: 'accessor', value: [4, 4]},
  getHeight: {type: 'accessor', value: 0.22},
  getBladeWidth: {type: 'accessor', value: 0.025},
  getColor: {type: 'accessor', value: DEFAULT_COLOR},
  getDensity: {type: 'accessor', value: 1},
  getSeed: {type: 'accessor', value: 0},
  bladesPerPatch: {type: 'number', value: 1024, min: 1, max: 4096},
  windDirection: {type: 'number', value: 90},
  windStrength: {type: 'number', value: 0, min: 0, max: 1},
  windTime: null
};

const VERTICES_PER_BLADE = 15;

/** Draws deterministic, curved grass blades inside data-defined rectangular patches. */
export class GrassLayer<DataT = {position: Position}> extends Layer<
  Required<GrassLayerProps<DataT>>
> {
  static layerName = 'GrassLayer';
  static defaultProps: DefaultProps<GrassLayerProps> & {shadowEnabled: boolean} = {
    ...defaultProps,
    shadowEnabled: false
  };

  declare state: {model?: Model};

  getShaders() {
    return super.getShaders({
      vs: grassVertex,
      fs: grassFragment,
      source: grassWgsl,
      modules: [project32, picking, color, grassUniforms]
    });
  }

  initializeState(): void {
    this.getAttributeManager()!.addInstanced({
      instancePositions: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        accessor: 'getPosition'
      },
      instanceSizes: {size: 2, accessor: 'getSize'},
      instanceHeights: {size: 1, accessor: 'getHeight'},
      instanceBladeWidths: {size: 1, accessor: 'getBladeWidth'},
      instanceColors: {size: 4, type: 'unorm8', accessor: 'getColor', defaultValue: DEFAULT_COLOR},
      instanceDensities: {size: 1, accessor: 'getDensity'},
      instanceSeeds: {size: 1, accessor: 'getSeed'}
    });
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    if (params.changeFlags.extensionsChanged || !this.state.model) {
      this.state.model?.destroy();
      this.state.model = new Model(this.context.device, {
        ...this.getShaders(),
        id: this.props.id,
        bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
        isInstanced: true,
        topology: 'triangle-list'
      });
      this.getAttributeManager()!.invalidateAll();
    }
  }

  draw(): void {
    const {model} = this.state;
    if (!model) return;

    const {bladesPerPatch, windDirection, windStrength, windTime} = this.props;
    const blades = Math.floor(Math.max(1, Math.min(4096, bladesPerPatch ?? 1024)));
    const bearing = ((windDirection || 0) * Math.PI) / 180;
    const time = windTime ?? this.context.timeline.getTime() / 1000;
    model.shaderInputs.setProps({
      grass: {
        bladeCount: blades,
        wind: [Math.sin(bearing), Math.cos(bearing), windStrength, time]
      }
    });
    model.setVertexCount(blades * VERTICES_PER_BLADE);
    model.draw(this.context.renderPass);
    if (windStrength > 0 && windTime === null) this.setNeedsRedraw();
  }
}
