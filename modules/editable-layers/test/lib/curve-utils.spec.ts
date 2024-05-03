// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import {generateCurveFromControlPoints} from '../../src/utils/curve-utils';
import {Feature} from '../../src/utils/geojson-types';

const POLYLINE: Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.41988182067871, 37.8014343052295],
      [-122.41904497146605, 37.802790657411244],
      [-122.41724252700804, 37.801603850614384],
      [-122.41612672805786, 37.80314669573162]
    ]
  }
};

it('test generateCurveFromControlPoints', () => {
  // @ts-expect-error TODO
  const result = generateCurveFromControlPoints(POLYLINE);
  expect(result).toMatchSnapshot();
});
