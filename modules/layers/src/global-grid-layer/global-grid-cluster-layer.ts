// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  type AccessorFunction,
  type UpdateParameters,
  type DefaultProps,
  createIterable
} from '@deck.gl/core';
import {_GeoCellLayer, type _GeoCellLayerProps} from '@deck.gl/geo-layers';
import {type GlobalGrid} from '../global-grid-systems/grids/global-grid';
import {normalizeLongitudes} from '../global-grid-systems/utils/geometry-utils';

/** All properties supported by GlobalGridClusterLayer. */
export type GlobalGridClusterLayerProps<DataT = unknown> = _GlobalGridClusterLayerProps<DataT> &
  _GeoCellLayerProps<DataT>;

/** Properties added by GlobalGridClusterLayer. */
type _GlobalGridClusterLayerProps<DataT> = {
  /** The DGGS decoder to use. */
  globalGrid: GlobalGrid;
  /** Called for each data object to retrieve the hexagon identifiers. By default, it reads `cellIds` property of data object. */
  getCellIds?: AccessorFunction<DataT, string[] | bigint[]>;
};

export class GlobalGridClusterLayer<DataT = any, ExtraProps extends {} = {}> extends _GeoCellLayer<
  DataT,
  Required<_GlobalGridClusterLayerProps<DataT>> & ExtraProps
> {
  static layerName = 'GlobalGridClusterLayer';
  static defaultProps = {
    getCellIds: {type: 'accessor', value: (d: any) => d.cellIds},
    globalGrid: {type: 'object', compare: true, value: undefined!}
  } as const satisfies DefaultProps<GlobalGridClusterLayerProps>;

  declare state: {
    polygons: {polygon: number[][][]}[];
  };

  initializeState(): void {
    this.props.globalGrid.initialize?.();
  }

  updateState({props, changeFlags}: UpdateParameters<this>): void {
    if (
      changeFlags.dataChanged ||
      (changeFlags.updateTriggersChanged && changeFlags.updateTriggersChanged.getCellIds)
    ) {
      const {data, getCellIds, globalGrid} = props;
      const polygons: {polygon: number[][][]}[] = [];

      const {iterable, objectInfo} = createIterable(data);
      for (const object of iterable) {
        objectInfo.index++;
        const cellIds = getCellIds(object, objectInfo);
        if (!globalGrid.cellsToBoundaryMultiPolygon) {
          throw new Error(`${globalGrid.name} adapter: cellsToBoundaryMultiPolygon not supported`);
        }
        // TODO - should not need to map the tokens
        const cellIndexes = cellIds.map((cellId) =>
          typeof cellId === 'string' ? globalGrid.tokenToCell?.(cellId) : cellId
        );
        const multiPolygon = globalGrid.cellsToBoundaryMultiPolygon(cellIndexes);

        for (const polygon of multiPolygon) {
          // Normalize polygons to prevent wrapping over the anti-meridian
          // eslint-disable-next-line max-depth
          for (const ring of polygon) {
            normalizeLongitudes(ring);
          }
          polygons.push(this.getSubLayerRow({polygon}, object, objectInfo.index));
        }
      }

      this.setState({polygons});
    }
  }

  indexToBounds(): Partial<_GeoCellLayer['props']> {
    const {getElevation, getFillColor, getLineColor, getLineWidth} = this.props;

    return {
      data: this.state.polygons,
      getPolygon: (d) => d.polygon,

      getElevation: this.getSubLayerAccessor(getElevation),
      getFillColor: this.getSubLayerAccessor(getFillColor),
      getLineColor: this.getSubLayerAccessor(getLineColor),
      getLineWidth: this.getSubLayerAccessor(getLineWidth)
    };
  }
}
