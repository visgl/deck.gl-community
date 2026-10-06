// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {CompositeLayer} from '@deck.gl/core';
import {TreeMeshLayer} from './tree-mesh-layer';
import {getTreeWoodMesh} from './tree-wood';
import {intersectsSplatLightVolume} from '../splat-layer/splat-culling';
import type {SplatShadowProjection} from '../splat-layer/splat-shadow-pass';
import type {Viewport} from '@deck.gl/core';
import type {TreeType} from './tree-layer';

type Row = {
  position: [number, number, number];
  scale: [number, number, number];
  translation: [number, number, number];
  type: TreeType;
  levels: number;
};
/** Automatic woody refinement. The connected full branching mesh is retained for close views. */
export class TreeWoodLayer extends CompositeLayer<any> {
  static layerName = 'TreeWoodLayer';
  static defaultProps = TreeMeshLayer.defaultProps;
  declare state: {near: Row[]; far: Row[]; shadow: Row[]};
  private shadowKey = '';
  initializeState() {
    this.state = {near: [], far: [], shadow: []};
  }
  shouldUpdateState({changeFlags}) {
    return changeFlags.somethingChanged;
  }
  updateState({changeFlags}) {
    if (!changeFlags.dataChanged && !changeFlags.viewportChanged) return;
    const near: Row[] = [],
      far: Row[] = [];
    const viewport = this.context.viewport;
    const viewports = this.context.deck.getViewports();
    const pixelsPerMeter = Math.max(
      ...viewports.map(view => view.scale * view.distanceScales.unitsPerMeter[2])
    );
    for (const row of this.props.data as Row[]) {
      const position = this.project(row.position);
      const radius = Math.max(...row.scale) * pixelsPerMeter * 4;
      if (
        viewports.length <= 1 &&
        (position[0] < -radius ||
          position[0] > viewport.width + radius ||
          position[1] < -radius ||
          position[1] > viewport.height + radius)
      )
        continue;
      (Math.max(...row.scale) * pixelsPerMeter > 48 ? near : far).push(row);
    }
    this.shadowKey = '';
    this.setState({near, far, shadow: this.props.data});
  }
  prepareShadow(projections: SplatShadowProjection[], viewport: Viewport) {
    const key = projections
      .map(projection => [...projection.matrix, ...projection.center])
      .join(',');
    if (key === this.shadowKey) return;
    this.shadowKey = key;
    const shadow = (this.props.data as Row[]).filter(row => {
      const position = this.projectPosition(row.position, {viewport});
      const radius =
        (Math.max(...row.scale) * 2 + Math.hypot(...row.translation)) *
        viewport.distanceScales.unitsPerMeter[2];
      return projections.some(projection =>
        intersectsSplatLightVolume(position, radius, projection)
      );
    });
    this.setState({shadow});
  }
  renderLayers() {
    const row = this.props.data[0] as Row | undefined;
    if (!row) return [];
    return (
      [
        ['near', this.state.near, false],
        ['far', this.state.far, true],
        [
          'shadow',
          this.state.shadow,
          Math.max(...row.scale) *
            this.context.viewport.scale *
            this.context.viewport.distanceScales.unitsPerMeter[2] <=
            48
        ]
      ] as const
    ).flatMap(([id, data, aggregate]) =>
      data.length
        ? [
            new TreeMeshLayer({
              ...this.props,
              ...this.getSubLayerProps({id}),
              data,
              operation: id === 'shadow' ? 'shadow' : 'draw',
              pickable: id !== 'shadow' && this.props.pickable,
              mesh: getTreeWoodMesh(row.type, row.levels, aggregate)
            })
          ]
        : []
    );
  }
}
