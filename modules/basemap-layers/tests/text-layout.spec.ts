// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, test, vi} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {
  FALLBACK_CHARACTER_WIDTH,
  MAX_CACHED_CHARACTERS,
  MAX_CACHED_FONTS,
  MAX_WRAPPED_TEXT_LENGTH,
  getCharacterWidthMeasurer,
  transformText,
  wrapText
} from '../src/text-layout';

/** Creates a point feature with expression inputs. */
function feature(properties: Record<string, unknown> = {}) {
  return {geometry: {type: 'Point', coordinates: [0, 0]}, properties};
}

/** Creates a label layer, with empty label state, for accessor tests. */
function labelLayer(layout: Record<string, unknown> = {}, zoom = 7.6, props = {}) {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout},
    zoom,
    ...props
  } as any);
  layer.state = {labelData: []};
  return layer;
}

/** Gives every code point a one-em advance. */
const measure = () => 1;

const LONG_LABEL = 'Lorem ipsum dolor sit amet consectetur';

describe('transformText', () => {
  test('applies upper and lower case and preserves other values', () => {
    expect(transformText('Hello', 'uppercase')).toBe('HELLO');
    expect(transformText('Hello', 'lowercase')).toBe('hello');
    for (const value of ['none', 'unknown', undefined, 42]) {
      expect(transformText('Hello', value)).toBe('Hello');
    }
  });
});

describe('wrapText', () => {
  test('keeps a short label on one line', () => {
    expect(wrapText('aaa bb', 6, measure)).toBe('aaa bb');
  });

  test('balances lines instead of greedily filling the first one', () => {
    // Total advance = 9 including spaces, so target = 9 / ceil(9 / 6) = 4.5.
    // Candidate x values exclude spaces: 3, 5, final 7. Breaking after aaa costs
    // (3 - 4.5)^2 + (4 - 4.5)^2 / 2 = 2.375. Greedy aaa bb / cc costs
    // (5 - 4.5)^2 + (2 - 4.5)^2 / 2 = 3.375, and no break costs (7 - 4.5)^2 * 2 = 12.5.
    // Thus aaa / bb cc wins, where a greedy fill to 6 ems gives aaa bb / cc.
    expect(wrapText('aaa bb cc', 6, measure)).toBe('aaa\nbb cc');
  });

  test('uses the measured advance of wide characters', () => {
    expect(wrapText('W W W', 5, measure)).toBe('W W W');
    expect(wrapText('W W W', 5, character => (character === 'W' ? 3 : 1))).toBe('W\nW\nW');
  });

  test('never breaks inside a long word and skips measurement without break opportunities', () => {
    const unused = vi.fn(measure);
    expect(wrapText('unbreakable😀word', 2, unused)).toBe('unbreakable😀word');
    expect(unused).not.toHaveBeenCalled();
    expect(wrapText('', 2, unused)).toBe('');
    expect(unused).not.toHaveBeenCalled();
  });

  test('honors newlines, trims surrounding whitespace and preserves empty lines', () => {
    expect(wrapText(' \talpha \n\t beta ', 100, measure)).toBe('alpha\nbeta');
    expect(wrapText('alpha\n\nbeta', 100, measure)).toBe('alpha\n\nbeta');
  });

  test('breaks after a hyphen and before an opening parenthesis', () => {
    expect(wrapText('abc-def', 4, measure)).toBe('abc-\ndef');
    expect(wrapText('abc(def)', 4, measure)).toBe('abc\n(def)');
  });

  test('breaks between ideographs, including supplementary code points', () => {
    expect(wrapText('天地玄黄', 2, measure)).toBe('天地\n玄黄');
    expect(wrapText('𠀀𠀁𠀂𠀃', 2, measure)).toBe('𠀀𠀁\n𠀂𠀃');
  });

  test('prefers server-suggested breakpoints without dropping the zero-width space', () => {
    expect(wrapText('天地\u200b玄黄', 2, character => (character === '\u200b' ? 0 : 1))).toBe(
      '天地\u200b\n玄黄'
    );
  });
});

describe('getCharacterWidthMeasurer in Node', () => {
  test('caches the measurer and uses half-em advances without canvas', () => {
    const measureWidth = getCharacterWidthMeasurer('400', 'sans-serif');
    expect(getCharacterWidthMeasurer(400, 'sans-serif')).toBe(measureWidth);
    expect(measureWidth('W')).toBe(FALLBACK_CHARACTER_WIDTH);
    expect(measureWidth('i')).toBe(0.5);
  });
});

describe('MVTLabelLayer text layout', () => {
  test('wraps point labels with the default ten-em width', () => {
    const layer = labelLayer({'text-field': LONG_LABEL});
    expect(layer.getLabel(feature())).toBe('Lorem ipsum dolor sit\namet consectetur');
  });

  test('evaluates max width per feature', () => {
    const layer = labelLayer({'text-field': 'aaa bb cc', 'text-max-width': ['get', 'w']});
    expect(layer.getLabel(feature({w: 3}))).toBe('aaa\nbb cc');
    expect(layer.getLabel(feature({w: 100}))).toBe('aaa bb cc');
  });

  test('transforms literal and data-driven labels before wrapping', () => {
    expect(
      labelLayer({'text-field': 'Hello', 'text-transform': 'uppercase'}).getLabel(feature())
    ).toBe('HELLO');
    const layer = labelLayer({'text-field': 'Hello', 'text-transform': ['get', 'transform']});
    expect(layer.getLabel(feature({transform: 'uppercase'}))).toBe('HELLO');
    expect(layer.getLabel(feature({transform: 'lowercase'}))).toBe('hello');
  });

  test('does not wrap line placements but preserves explicit newlines and transforms', () => {
    for (const placement of ['line', 'line-center']) {
      const layer = labelLayer({
        'text-field': `${LONG_LABEL}\nHi`,
        'symbol-placement': placement,
        'text-transform': 'uppercase'
      });
      expect(layer.getLabel(feature())).toBe(`${LONG_LABEL}\nHi`.toUpperCase());
    }
  });

  test('resolves fonts only when measurement is needed and keeps empty labels undefined', () => {
    const layer = labelLayer({'text-field': ['get', 'name']});
    const font = vi.spyOn(layer, 'getFont');
    expect(layer.getLabel(feature({name: 'Word'}))).toBe('Word');
    expect(layer.getLabel(feature({name: '  '}))).toBeUndefined();
    expect(font).not.toHaveBeenCalled();
    layer.getLabel(feature({name: LONG_LABEL}));
    expect(font).toHaveBeenCalledTimes(1);
  });

  test('evaluates line height at stepped zoom and forwards it to TextLayer', () => {
    const layers = [
      [labelLayer(), 1.2],
      [labelLayer({'text-line-height': 2}), 2],
      [labelLayer({'text-line-height': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 2]}), 1.5]
    ] as const;
    for (const [layer, expected] of layers) {
      expect(layer.getLineHeight()).toBe(expected);
      const textLayer = layer.renderLayers().find(sublayer => sublayer.id.endsWith('-text'));
      expect(textLayer?.props.lineHeight).toBe(expected);
    }
  });

  test('invalidates text when wrapping, transform, placement or font inputs change', () => {
    const layout: Record<string, unknown> = {'text-field': LONG_LABEL};
    const layer = labelLayer(layout);
    let trigger = layer.getLabelUpdateTriggers().getText;
    for (const [name, value] of Object.entries({
      'text-max-width': 5,
      'text-transform': 'uppercase',
      'symbol-placement': 'line',
      'text-font': ['Noto Sans Bold']
    })) {
      layout[name] = value;
      const next = layer.getLabelUpdateTriggers().getText;
      expect(next).not.toBe(trigger);
      trigger = next;
    }
    expect(
      labelLayer(layout, 7.6, {fontFamily: 'serif'}).getLabelUpdateTriggers().getText
    ).not.toBe(trigger);
  });
});

describe('resource bounds on untrusted labels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const HUGE_LENGTH = 100_000;

  test('wraps text up to the length cap', () => {
    const text = 'ab '.repeat(MAX_WRAPPED_TEXT_LENGTH).slice(0, MAX_WRAPPED_TEXT_LENGTH);
    expect(wrapText(text, 10, measure)).toContain('\n');
  });

  test('returns a 100k-character label unwrapped without measuring it', () => {
    for (const text of ['ab '.repeat(HUGE_LENGTH / 3), '天'.repeat(HUGE_LENGTH)]) {
      const counted = vi.fn(measure);
      const start = performance.now();
      expect(wrapText(text, 10, counted)).toBe(text);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(counted).not.toHaveBeenCalled();
    }
  });

  test('getLabel on a 100k-character label finishes quickly', () => {
    const layer = labelLayer({'text-field': ['get', 'name'], 'text-transform': 'uppercase'});
    const name = 'ab '.repeat(HUGE_LENGTH / 3);
    const start = performance.now();
    const label = layer.getLabel(feature({name}));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(label).toBe(name.trim().toUpperCase());
  });

  test('bounds the per-font character width cache', () => {
    const measureText = vi.fn(() => ({width: 32}));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {font: '', measureText};
        }
      }
    );
    const measureWidth = getCharacterWidthMeasurer(400, 'cache-bound-test');
    measureWidth('a');
    measureWidth('a');
    expect(measureText).toHaveBeenCalledTimes(1);
    for (let i = 0; i < MAX_CACHED_CHARACTERS; i++) {
      measureWidth(String.fromCodePoint(0x4e00 + i));
    }
    measureText.mockClear();
    // The cache filled and was cleared, so 'a' is measured again.
    expect(measureWidth('a')).toBe(0.5);
    expect(measureText).toHaveBeenCalledTimes(1);
  });

  test('bounds the number of cached fonts', () => {
    const first = getCharacterWidthMeasurer(400, 'font-bound-test-0');
    expect(getCharacterWidthMeasurer(400, 'font-bound-test-0')).toBe(first);
    for (let i = 1; i <= MAX_CACHED_FONTS; i++) {
      getCharacterWidthMeasurer(400, `font-bound-test-${i}`);
    }
    expect(getCharacterWidthMeasurer(400, 'font-bound-test-0')).not.toBe(first);
  });
});

describe('per-tile wrap budget', () => {
  test('charges each wrap its cost and skips a wrap the budget cannot pay', () => {
    // 9 characters and 2 break opportunities: 9 + 2 * 3 / 2 = 12 steps.
    const budget = {steps: 12};
    expect(wrapText('aaa bb cc', 6, measure, budget)).toBe('aaa\nbb cc');
    expect(budget.steps).toBe(0);
    expect(wrapText('aaa bb cc', 6, measure, budget)).toBe('aaa bb cc');
    expect(budget.steps).toBe(0);
  });

  /** A label layer that has gone through `updateState` with one feature per name. */
  function updatedLayer(layout: Record<string, unknown>, names: string[]) {
    const data = names.map(name => feature({name}));
    const layer = labelLayer(layout, 7.6, {data});
    layer.state = {};
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    return {layer, data};
  }

  const IDEOGRAPHS = '天'.repeat(MAX_WRAPPED_TEXT_LENGTH);

  test('bounds the wrapping work of one tile and keeps every read of a label the same', () => {
    const {layer, data} = updatedLayer(
      {'text-field': ['get', 'name']},
      Array.from({length: 500}, () => IDEOGRAPHS)
    );
    const start = performance.now();
    const first = data.map(object => layer.getLabel(object));
    expect(performance.now() - start).toBeLessThan(1000);
    const wrapped = first.filter(label => label?.includes('\n')).length;
    expect(wrapped).toBeGreaterThan(0);
    expect(wrapped).toBeLessThan(data.length);
    // deck.gl reads each label several times per update; the reads must agree.
    expect(data.map(object => layer.getLabel(object))).toEqual(first);
  });

  test('grants a fresh budget when the text trigger changes', () => {
    const layout: Record<string, unknown> = {'text-field': ['get', 'name']};
    const {layer, data} = updatedLayer(
      layout,
      Array.from({length: 500}, () => IDEOGRAPHS)
    );
    const last = data[data.length - 1];
    data.forEach(object => layer.getLabel(object));
    // The budget ran out before the last label.
    expect(layer.getLabel(last)).toBe(IDEOGRAPHS);
    layout['text-max-width'] = 20;
    layer.updateState({changeFlags: {}} as any);
    expect(layer.getLabel(last)).toContain('\n');
  });
});

describe('fontFamily in the text trigger', () => {
  test('keys a function by identity', () => {
    const font = () => 'serif';
    const trigger = (fontFamily: unknown) =>
      labelLayer({'text-field': 'x'}, 7.6, {fontFamily}).getLabelUpdateTriggers().getText;
    expect(trigger(font)).toBe(trigger(font));
    expect(trigger(() => 'serif')).not.toBe(trigger(font));
  });
});
