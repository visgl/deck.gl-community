/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';

const feature = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {layerName: 'place', rank: 2}
};

function haloLayer(paint: Record<string, unknown>, zoom = 7.6): any {
  return new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout: {'text-field': 'Label'}, paint},
    zoom,
    labelBackground: [255, 255, 255, 255]
  } as any);
}

describe('label halo opacity', () => {
  test('a hidden label leaves no halo', () => {
    const layer = haloLayer({'text-opacity': 0, 'text-halo-color': '#ffffff'});
    expect(layer.getLabelColor(feature)[3]).toBe(0);
    expect(layer.getLabelBackgroundColor(feature)[3]).toBe(0);
  });

  test('the halo fades with a data-driven text-opacity', () => {
    const layer = haloLayer({'text-opacity': ['/', ['get', 'rank'], 4]});
    expect(layer.getLabelBackgroundColor(feature)).toEqual([255, 255, 255, 128]);
  });

  test('a zoom-dependent text-opacity also triggers the halo', () => {
    const layer = haloLayer({
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 10, 1]
    });
    expect(layer.getLabelUpdateTriggers().getBackgroundColor).not.toEqual(
      haloLayer({}).getLabelUpdateTriggers().getBackgroundColor
    );
  });
});

describe('label halo wiring', () => {
  test('the text sublayer draws the faded halo, not the constant one', () => {
    const layer = haloLayer({'text-opacity': 0});
    layer.state = {labelData: [{position: [0, 0], feature}]};
    layer.context = {} as any;
    layer.internalState = {subLayers: []} as any;
    const [text] = layer.renderLayers();
    const getBackgroundColor = text.props.getBackgroundColor;
    expect(typeof getBackgroundColor).toBe('function');
    expect(
      getBackgroundColor({position: [0, 0], feature}, {index: 0, data: [], target: []})[3]
    ).toBe(0);
  });
});

describe('label halo color', () => {
  function layerWithBackground(
    labelBackground: number[],
    paint: Record<string, unknown> = {}
  ): any {
    return new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      styleLayer: {layout: {'text-field': 'Label'}, paint},
      zoom: 7.6,
      labelBackground
    } as any);
  }

  test('keeps a faint halo faint', () => {
    // `rgba(255,255,255,0.004)` arrives as a 0-255 alpha of 1.
    expect(layerWithBackground([255, 255, 255, 1]).getLabelBackgroundColor(feature)).toEqual([
      255, 255, 255, 1
    ]);
    expect(
      layerWithBackground([255, 255, 255, 200], {'text-opacity': 0.5}).getLabelBackgroundColor(
        feature
      )
    ).toEqual([255, 255, 255, 100]);
  });

  test('the halo trigger follows the halo color', () => {
    const trigger = (labelBackground: number[]) =>
      layerWithBackground(labelBackground).getLabelUpdateTriggers().getBackgroundColor;
    expect(trigger([255, 255, 255, 255])).not.toEqual(trigger([0, 0, 0, 255]));
    expect(trigger([255, 255, 255, 255])).toEqual(trigger([255, 255, 255, 255]));
  });
});
