// deck.gl-community
// SPDX-License-Identifier: MIT
import {describe, expect, test} from 'vitest';
import {z} from 'zod';
import Ajv2020 from 'ajv/dist/2020';
import {Layer} from '@deck.gl/core';
import editableExample from '../../../examples/playground/examples/15-editable-geojson.json';
import {CommunityDataLayerSchemas} from '../src/schemas/community-data-layers';

const cases = {
  EditableGeoJsonLayer: [
    {data: {type: 'FeatureCollection', features: []}, mode: '@@#ViewMode'},
    {selectedFeatureIndexes: [-1]}
  ],
  EditableH3ClusterLayer: [
    {data: [{hexIds: ['8928308280fffff']}], resolution: 9, getHexagons: '@@=hexIds'},
    {resolution: 16}
  ],
  SelectionLayer: [{selectionType: 'polygon', layerIds: ['points']}, {selectionType: 'circle'}],
  ElevatedEditHandleLayer: [{getPosition: '@@=position', radiusUnits: 'pixels'}, {pointSize: 4}],
  JunctionScatterplotLayer: [
    {getInnerRadius: 2, getStrokeColor: [1, 2, 3]},
    {getInnerRadius: 'two'}
  ]
} satisfies Record<keyof typeof CommunityDataLayerSchemas, [object, object]>;

describe('Editable JSON schemas', () => {
  for (const [name, [valid, invalid]] of Object.entries(cases)) {
    const schema = CommunityDataLayerSchemas[name as keyof typeof CommunityDataLayerSchemas];
    const validate = new Ajv2020({strict: false}).compile(
      z.toJSONSchema(schema, {
        override: ({jsonSchema}) => {
          delete jsonSchema.id;
        }
      })
    );
    const base = {
      id: 'example',
      '@@type': name,
      ...valid
    };
    test(`${name} validates its props in Zod and JSON Schema`, () => {
      expect(schema.safeParse(base).success).toBe(true);
      expect(validate(base), JSON.stringify(validate.errors)).toBe(true);
      for (const properties of [invalid, {unknownProp: true}]) {
        const input = {...base, ...properties};
        expect(schema.safeParse(input).success).toBe(false);
        expect(validate(input)).toBe(false);
      }
    });
  }
});

test('editable gallery configuration retains validated geometry and mode references', () => {
  expect(
    CommunityDataLayerSchemas.EditableGeoJsonLayer.safeParse(editableExample.layers[0]).success
  ).toBe(true);
  const base = {
    id: 'edit',
    '@@type': 'EditableGeoJsonLayer',
    data: {type: 'FeatureCollection', features: []}
  };
  for (const props of [
    {mode: '@@#ModifyMode', onEdit: '@@#applyEdit'},
    {
      mode: 'view',
      editHandleType: 'icon',
      editHandleIconAtlas: 'handles.png',
      editHandleIconMapping: {point: {x: 0, y: 0, width: 16, height: 16}}
    }
  ]) {
    expect(
      CommunityDataLayerSchemas.EditableGeoJsonLayer.safeParse({...base, ...props}).success
    ).toBe(true);
  }
  for (const props of [
    {mode: 'unknown'},
    {mode: {'@@type': 'ViewMode'}},
    {onEdit: () => {}},
    {editHandleIconMapping: {point: {width: -1}}},
    {data: {type: 'Point', coordinates: [0, 0]}}
  ]) {
    expect(
      CommunityDataLayerSchemas.EditableGeoJsonLayer.safeParse({...base, ...props}).success
    ).toBe(false);
  }
});

test('catalog covers every public editable layer export', async () => {
  const editable = await import('../../editable-layers/src/index');
  const exports = Object.entries(editable)
    .filter(([, value]) => typeof value === 'function' && value.prototype instanceof Layer)
    .map(([name]) => name);
  expect(Object.keys(CommunityDataLayerSchemas).sort()).toEqual(exports.sort());
});
