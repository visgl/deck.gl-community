// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getTextLayerFontWeight} from '../src/text-font';
import {getCharacterWidthMeasurer} from '../src/text-layout';

describe('labels along lines in a browser', () => {
  test('are placed by the measured width of their text', () => {
    const layer = new MVTLabelLayer({
      id: 'line-labels',
      config: {labels: true},
      zoom: 14,
      tileZoom: 14,
      tileSize: 512,
      styleLayer: {
        layout: {'text-field': '{name}', 'symbol-placement': 'line-center', 'text-size': 10}
      }
    });
    const font = layer.getFont();
    const measure = getCharacterWidthMeasurer(getTextLayerFontWeight(font), font.fontFamily);
    // Ten narrow characters: estimated at 0.6 em each they are 60 px, too long for a 40 px line.
    expect(measure('i') * 10 * 10).toBeLessThan(40);
    const feature = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.4, 0.5],
          [0.4 + 40 / 512, 0.5]
        ]
      },
      properties: {name: 'iiiiiiiiii'}
    };
    expect(layer.getLabelData([feature], false)).toHaveLength(1);
  });
});
