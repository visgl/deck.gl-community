// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Field,
  FixedSizeList,
  Float32,
  Table,
  makeData,
  makeVector,
  vectorFromArray
} from 'apache-arrow';
import {expect, test} from 'vitest';
import {convertGeoArrowTableToBinaryFeatureCollection} from '@deck.gl-community/layers/source-layers';

test('preserves sibling properties across native GeoArrow point batches', () => {
  const point = new FixedSizeList(2, new Field('xy', new Float32()));
  function createBatch(x: number, name: string) {
    const table = new Table({
      geometry: makeVector(
        makeData({type: point, length: 1, child: makeVector(new Float32Array([x, 0])).data[0]})
      ),
      name: vectorFromArray([name])
    });
    table.schema.fields[0].metadata.set('ARROW:extension:name', 'geoarrow.point');
    return table;
  }
  const table = createBatch(1, 'first').concat(createBatch(2, 'second'));
  const {points} = convertGeoArrowTableToBinaryFeatureCollection(table);
  expect(points?.properties.map(properties => properties.name)).toEqual(['first', 'second']);
  expect(Array.from(points!.positions.value)).toEqual([1, 0, 2, 0]);
  expect(Array.from(points!.featureIds.value)).toEqual([0, 1]);
  expect(Array.from(points!.globalFeatureIds.value)).toEqual([0, 1]);
});
