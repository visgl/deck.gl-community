/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {LabelTextLayer} from '../src/label-text-layer';

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
  });
});
