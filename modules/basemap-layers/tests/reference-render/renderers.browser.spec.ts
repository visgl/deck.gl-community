// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TextLayer} from '@deck.gl/layers';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {type BasemapLayerDraw, getFontAtlases, renderBasemapLayer} from './renderers';
import {DEFAULT_SCENES} from './scenes';

describe('renderBasemapLayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('times both draws, and the first draw alone', async () => {
    // A clock that only the draws move: 30 ms for the first, 50 ms for the second.
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const steps = [30, 50];
    const draw = async (): Promise<BasemapLayerDraw> => {
      const step = steps.shift()!;
      clock += step;
      return {
        pixels: new Uint8ClampedArray(0),
        labels: [],
        requests: [],
        problems: [],
        duration: step,
        fontAtlases: []
      };
    };
    const render = await renderBasemapLayer({}, DEFAULT_SCENES[0], {}, {}, draw);
    expect(steps).toEqual([]);
    expect(render.duration).toBe(80);
    expect(render.firstDrawDuration).toBe(30);
  });

  test('draws both passes with the render options', async () => {
    const options: unknown[] = [];
    const draw = async (...args: unknown[]): Promise<BasemapLayerDraw> => {
      options.push(args[3]);
      return {
        pixels: new Uint8ClampedArray(0),
        labels: [],
        requests: [],
        problems: [],
        duration: 0,
        fontAtlases: []
      };
    };
    await renderBasemapLayer({}, DEFAULT_SCENES[0], {}, {pixelRatio: 2, pitch: 45}, draw);
    expect(options).toEqual([
      {pixelRatio: 2, pitch: 45},
      {pixelRatio: 2, pitch: 45}
    ]);
  });

  test.each([
    'first',
    'second'
  ])('fails when the %s draw draws labels and reports no font atlas', async failing => {
    const draws: BasemapLayerDraw['fontAtlases'][] = [
      [
        {
          key: 'font',
          manager: {props: {}, setProps: () => {}, atlas: {}},
          characters: new Set(['P']),
          atlases: new Set([{}])
        }
      ],
      []
    ];
    if (failing === 'first') {
      draws.reverse();
    }
    const draw = async (): Promise<BasemapLayerDraw> => ({
      pixels: new Uint8ClampedArray(0),
      labels: ['Paris'],
      requests: [],
      problems: [],
      duration: 0,
      fontAtlases: draws.shift()!
    });
    await expect(renderBasemapLayer({}, DEFAULT_SCENES[0], {}, {}, draw)).rejects.toThrow(
      'BasemapLayer drew 1 labels from no font atlas'
    );
    // The failing draw is the last one drawn.
    expect(draws).toHaveLength(failing === 'first' ? 1 : 0);
  });
});

describe('getFontAtlases', () => {
  /** A `TextLayer` whose font atlas manager has the given fields. */
  function getTextLayer(manager: Record<string, unknown>) {
    const layer = new TextLayer({id: 'text'});
    (layer as any).state = {fontAtlasManager: manager};
    return layer;
  }

  test('reads the font, characters and atlas of each text layer', () => {
    const atlas = {};
    const manager = {_key: 'font', mapping: {b: {}, a: {}}, atlas};
    const [font, ...rest] = getFontAtlases([{state: {}}, getTextLayer(manager)]);
    expect(rest).toEqual([]);
    expect(font.key).toBe('font');
    expect(font.manager).toBe(manager);
    expect([...font.characters]).toEqual(['b', 'a']);
    expect([...font.atlases]).toEqual([atlas]);
  });

  const MANAGER_FIELDS = ['_key', 'mapping', 'atlas'];

  test.each(MANAGER_FIELDS)('fails when deck.gl renames the font atlas manager field %s', field => {
    const manager: Record<string, unknown> = {_key: 'font', mapping: {a: {}}, atlas: {}};
    delete manager[field];
    expect(() => getFontAtlases([getTextLayer(manager)])).toThrow(
      `deck.gl FontAtlasManager has no \`${field}\``
    );
  });

  test('fails when deck.gl renames the text layer state field fontAtlasManager', () => {
    const layer = new TextLayer({id: 'text'});
    (layer as any).state = {atlasManager: {}};
    expect(() => getFontAtlases([layer])).toThrow(
      'deck.gl TextLayer state has no `fontAtlasManager`'
    );
  });
});
