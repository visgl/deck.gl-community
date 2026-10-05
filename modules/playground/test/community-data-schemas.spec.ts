// deck.gl-community
// SPDX-License-Identifier: MIT
import {describe, expect, test} from 'vitest';
import {z} from 'zod';
import Ajv2020 from 'ajv/dist/2020';
import {Layer} from '@deck.gl/core';
import editableExample from '../../../examples/playground/examples/15-editable-geojson.json';
import {CommunityDataLayerSchemas} from '../src/schemas/community-data-layers';

const cases = {
  GeoArrowArcLayer: [
    {getSourcePosition: '@@#source', getTargetPosition: '@@#target', getWidth: '@@#widths'},
    {getSourcePosition: '@@=source'}
  ],
  GeoArrowColumnLayer: [{getPosition: '@@#geometry', getElevation: 10}, {diskResolution: 2}],
  _GeoArrowH3HexagonLayer: [{getHexagon: '@@#cells'}, {getHexagon: '@@=cell'}],
  GeoArrowHeatmapLayer: [{getWeight: '@@#weights', aggregation: 'MEAN'}, {aggregation: 'COUNT'}],
  GeoArrowPathLayer: [{getPath: '@@#geometry', getWidth: 2}, {getWidth: [1, 2]}],
  GeoArrowPointCloudLayer: [{getNormal: '@@#normals', pointSize: 3}, {getPosition: [0, 0, 0]}],
  GeoArrowPolygonLayer: [{getPolygon: '@@#geometry', extruded: true}, {lineWidthUnits: 'feet'}],
  GeoArrowScatterplotLayer: [
    {
      getFillColor: [
        [0, 0, 0],
        [255, 255, 255]
      ],
      getRadius: '@@#radii'
    },
    {getFillColor: [256, 0, 0]}
  ],
  GeoArrowSolidPolygonLayer: [
    {earcutWorkerUrl: null, earcutWorkerPoolSize: 2},
    {earcutWorkerPoolSize: 0}
  ],
  _GeoArrowTextLayer: [{getText: '@@#labels', getTextAnchor: 'start'}, {getTextAnchor: 'left'}],
  GeoArrowTripsLayer: [{getTimestamps: '@@#times', currentTime: 5}, {getTimestamps: [1, 2]}],
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

describe('Arrow and editable JSON schemas', () => {
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
      ...(name.includes('GeoArrow') ? {data: '@@#table'} : {}),
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
    if (name.includes('GeoArrow')) {
      test(`${name} requires native Arrow resources instead of imported rows`, () => {
        for (const data of [[], {'@@data': 'points'}, 'points.arrow', {batches: []}]) {
          expect(schema.safeParse({...base, data}).success).toBe(false);
          expect(validate({...base, data})).toBe(false);
        }
      });
    }
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

test('GeoArrow vector-only inputs cannot be replaced by ordinary row accessors', () => {
  const base = {id: 'text', '@@type': '_GeoArrowTextLayer', data: '@@#table', getText: '@@#labels'};
  for (const props of [
    {background: true},
    {getText: '@@=label'},
    {getPixelOffset: '@@=offset'},
    {getPosition: '@@=position'}
  ]) {
    expect(
      CommunityDataLayerSchemas._GeoArrowTextLayer.safeParse({...base, ...props}).success
    ).toBe(false);
  }
});

test('catalog covers every public Arrow and editable layer export', async () => {
  const modules = await Promise.all([
    import('../../arrow-layers/src/index'),
    import('../../editable-layers/src/index')
  ]);
  const exports = modules.flatMap(module =>
    Object.entries(module)
      .filter(([, value]) => typeof value === 'function' && value.prototype instanceof Layer)
      .map(([name]) => name)
  );
  expect(Object.keys(CommunityDataLayerSchemas).sort()).toEqual(exports.sort());
});
