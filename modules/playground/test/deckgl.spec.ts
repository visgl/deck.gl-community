// deck.gl-community
// SPDX-License-Identifier: MIT

import {describe, expect, test} from 'vitest';

import {
  DeckGLDocumentSchema,
  DeckGLLayerSchemas,
  DeckGLViewSchemas,
  JsonFunctionSchema
} from '../src/schemas/deckgl';

describe('deck.gl schemas', () => {
  test('includes every official layer family', () => {
    expect(Object.keys(DeckGLLayerSchemas)).toEqual(
      expect.arrayContaining([
        'ScatterplotLayer',
        'GeoJsonLayer',
        'ScreenGridLayer',
        'MVTLayer',
        'WMSLayer',
        'ScenegraphLayer'
      ])
    );
    expect(Object.keys(DeckGLLayerSchemas)).toHaveLength(35);
  });

  test('includes every core view shape', () => {
    expect(Object.keys(DeckGLViewSchemas)).toEqual([
      'MapView',
      'FirstPersonView',
      'OrbitView',
      'OrthographicView',
      'GlobeView'
    ]);
  });

  test('validates JSON-encoded layers and views', () => {
    const document = {
      layers: [
        {
          '@@type': 'ScatterplotLayer',
          id: 'points',
          data: 'points.json',
          getPosition: '@@=position',
          getFillColor: [255, 0, 0]
        }
      ],
      views: {'@@type': 'MapView', id: 'main'},
      initialViewState: {longitude: -122, latitude: 37, zoom: 10}
    };

    expect(DeckGLDocumentSchema.parse(document)).toEqual(document);
  });

  test('accepts function references as accessors', () => {
    expect(JsonFunctionSchema.parse({'@@function': 'calculateRadius', base: 2})).toEqual({
      '@@function': 'calculateRadius',
      base: 2
    });
  });

  test('rejects unknown layer discriminators', () => {
    expect(() =>
      DeckGLDocumentSchema.parse({layers: [{'@@type': 'NotALayer', id: 'invalid'}]})
    ).toThrow();
  });
});
