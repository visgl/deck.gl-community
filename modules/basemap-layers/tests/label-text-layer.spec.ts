/* eslint-disable import/no-extraneous-dependencies */
import {
  FirstPersonViewport,
  OrthographicViewport,
  WebMercatorViewport,
  _GlobeViewport as GlobeViewport
} from '@deck.gl/core';
import {describe, expect, test} from 'vitest';
import {LabelTextLayer, getLabelForeshortening} from '../src/label-text-layer';

function filter(props: Record<string, unknown>, renderPass: string, isPicking = false) {
  const layer = new LabelTextLayer({id: 'text', background: true, ...props} as any);
  const context = {viewport: null as any, renderPass, isPicking};
  return {
    background: layer.filterSubLayer({...context, layer: {id: 'text-background'} as any}),
    characters: layer.filterSubLayer({...context, layer: {id: 'text-characters'} as any})
  };
}

describe('LabelTextLayer', () => {
  test('leaves a transparent, borderless background out of the screen pass only', () => {
    const transparent = {getBackgroundColor: [0, 0, 0, 0]};
    expect(filter(transparent, 'screen')).toEqual({background: false, characters: true});
    // The collision map and picking still draw it.
    expect(filter(transparent, 'collision')).toEqual({background: true, characters: true});
    expect(filter(transparent, 'picking:hover', true)).toEqual({
      background: true,
      characters: true
    });
  });

  test('draws a visible background or border', () => {
    expect(filter({getBackgroundColor: [0, 0, 0, 1]}, 'screen').background).toBe(true);
    expect(filter({getBackgroundColor: [0, 0, 0, 0], getBorderWidth: 1}, 'screen').background).toBe(
      true
    );
    expect(filter({getBackgroundColor: () => [0, 0, 0, 0]}, 'screen').background).toBe(true);
    // A highlight colors the box of the highlighted label.
    const transparent = {getBackgroundColor: [0, 0, 0, 0]};
    expect(filter({...transparent, autoHighlight: true}, 'screen').background).toBe(true);
    expect(filter({...transparent, highlightedObjectIndex: 0}, 'screen').background).toBe(true);
    expect(filter({...transparent, highlightedObjectIndex: -1}, 'screen').background).toBe(false);
    expect(filter({...transparent, highlightedObjectIndex: null}, 'screen').background).toBe(false);
    // A transition to a transparent background or no border still draws while it fades.
    for (const transition of ['getBackgroundColor', 'getBorderWidth']) {
      const fading = {getBackgroundColor: [0, 0, 0, 0], transitions: {[transition]: 300}};
      expect(filter(fading, 'screen').background).toBe(true);
    }
  });
});

describe('getLabelForeshortening', () => {
  const camera = {width: 800, height: 600, longitude: 0, latitude: 0, zoom: 13};

  test("is the cosine of a map's pitch for labels on the map, and 1 for billboards", () => {
    const viewport = new WebMercatorViewport({...camera, pitch: 60});
    expect(getLabelForeshortening(viewport, false)).toBeCloseTo(0.5, 6);
    expect(getLabelForeshortening(viewport, true)).toBe(1);
    expect(getLabelForeshortening(new WebMercatorViewport(camera), false)).toBe(1);
  });

  test('stays positive beyond a pitch of 90 degrees', () => {
    for (const pitch of [89, 90, 95, 180]) {
      const viewport = new WebMercatorViewport({...camera, pitch});
      expect(getLabelForeshortening(viewport, false), `pitch ${pitch}`).toBeGreaterThanOrEqual(
        Math.cos((89 * Math.PI) / 180)
      );
    }
  });

  test('is 1 in views that are not tilted about screen x', () => {
    const views = [
      new FirstPersonViewport({...camera, pitch: -80}),
      new OrthographicViewport({width: 800, height: 600}),
      new GlobeViewport({...camera, zoom: 3})
    ];
    for (const viewport of views) {
      expect(getLabelForeshortening(viewport, false), viewport.constructor.name).toBe(1);
    }
  });
});
