// deck.gl-community
// SPDX-License-Identifier: MIT

import {ScatterplotLayer} from '@deck.gl/layers';
import Ajv2020 from 'ajv/dist/2020';
import {expect, test} from 'vitest';
import {createPlaygroundResolver} from '../src/runtime/playground-resolver';
import {DataSchema, ScatterplotLayerSchema} from '../src/schemas/deckgl';

test('validates binding descriptors consistently in runtime and editor schemas', () => {
  const resolver = createPlaygroundResolver({
    layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
  });
  const layer = {id: 'points', '@@type': 'ScatterplotLayer'};
  const validate = new Ajv2020({strict: false}).compile(resolver.jsonSchema);
  expect(DataSchema.safeParse({'@@data': 'points'}).success).toBe(true);
  expect(validate({layers: [{...layer, data: {'@@data': 'points'}}]})).toBe(true);
  for (const data of [
    {'@@data': ''},
    {'@@data': 2},
    {'@@data': 'points', extra: true},
    {'@@data': null}
  ]) {
    expect(DataSchema.safeParse(data).success).toBe(false);
    expect(validate({layers: [{...layer, data}]})).toBe(false);
    expect(() => resolver.resolve({layers: [{...layer, data}]}, {})).toThrow();
  }
  expect(validate({layers: [{...layer, getPosition: [1, 2, 3, 4]}]})).toBe(false);
  expect(validate({mapStyle: 'style.json'})).toBe(false);
  expect(validate({views: []})).toBe(false);
  expect(validate({})).toBe(true);
});
