// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {type AccessorFunction, type DefaultProps} from '@deck.gl/core';
import {_GeoCellLayer, type _GeoCellLayerProps} from '@deck.gl/geo-layers';
import {GlobalGrid} from '../global-grid-systems/grids/global-grid';
import {flattenPolygon, normalizeLongitudes} from '../global-grid-systems/utils/geometry-utils';

/** All properties supported by GlobalGridLayer. */
export type GlobalGridLayerProps<DataT = unknown> = _GlobalGridLayerProps<DataT> &
  _GeoCellLayerProps<DataT>;

/** Properties added by GlobalGridLayer. */
type _GlobalGridLayerProps<DataT> = {
  /** The DGGS decoder to use. */
  globalGrid: GlobalGrid;
  /** Called for each data object to retrieve the DGGS cell identifier. By default, it reads `cellId` property of data object. */
  getCellId?: AccessorFunction<DataT, string | bigint>;
};

/** Render filled and/or stroked polygons based on the specified DGGS geospatial indexing system. */
export class GlobalGridLayer<DataT = any, ExtraProps extends {} = {}> extends _GeoCellLayer<
  DataT,
  Required<_GlobalGridLayerProps<DataT>> & ExtraProps
> {
  static layerName = 'GlobalGridLayer';
  static defaultProps: DefaultProps<GlobalGridLayerProps> = {
    getCellId: {type: 'accessor', value: (d: any) => d.cellId},
    globalGrid: {type: 'object', compare: true, value: undefined!}
  };

  initializeState(): void {
    this.props.globalGrid?.initialize?.();
  }

  indexToBounds(): Partial<_GeoCellLayer['props']> | null {
    const {data, getCellId} = this.props;

    return {
      data,
      // Polygon normalization also enables subdivision along the globe's surface.
      _normalize: true,
      _windingOrder: 'CCW',
      positionFormat: 'XY',
      getPolygon: (x: DataT, objectInfo) => {
        const {globalGrid} = this.props;
        const cell = getCellId(x, objectInfo);
        // Keep adjacent longitudes continuous before tessellation, without modifying
        // boundary arrays that a grid adapter may cache and reuse.
        const boundary = globalGrid
          .cellToBoundary(cell)
          .map(([lng, lat]) => [lng, lat] as [number, number]);
        normalizeLongitudes(boundary);
        const first = boundary[0];
        const last = boundary[boundary.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          boundary.push(first);
        }
        return flattenPolygon(boundary);
      }
    };
  }
}
