// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LineLayer} from '@deck.gl/layers';
import {describe, expect, it} from 'vitest';

import {HorizonGraphLayer, MultiHorizonGraphLayer} from '../src';

describe('MultiHorizonGraphLayer', () => {
  it('renders portable line dividers alongside each horizon series', () => {
    const layer = new MultiHorizonGraphLayer({
      id: 'portable-horizons',
      data: [
        {values: [1, -2, 3], scale: 10},
        {values: [-3, 2, -1], scale: 10}
      ],
      getSeries: series => series.values,
      getScale: series => series.scale,
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      dividerWidth: 2
    });

    const [dividers, ...horizons] = layer.renderLayers();

    expect(dividers).toBeInstanceOf(LineLayer);
    expect(dividers.props.id).toBe('portable-horizons-dividers');
    expect(dividers.props.widthUnits).toBe('common');
    expect(dividers.props.getWidth).toBe(2);
    expect(dividers.props.data).toHaveLength(3);
    expect(horizons).toHaveLength(2);
    expect(horizons.every(horizon => horizon instanceof HorizonGraphLayer)).toBe(true);
  });

  it('omits divider geometry when dividers are disabled', () => {
    const layer = new MultiHorizonGraphLayer({
      id: 'portable-horizons-no-dividers',
      data: [{values: [1, -2, 3], scale: 10}],
      getSeries: series => series.values,
      getScale: series => series.scale,
      width: 100,
      height: 50,
      dividerWidth: 0
    });

    const horizons = layer.renderLayers();

    expect(horizons).toHaveLength(1);
    expect(horizons[0]).toBeInstanceOf(HorizonGraphLayer);
  });
});
