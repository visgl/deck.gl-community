// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test} from 'vitest';
import {applyArabicShaping} from '../src/arabic-shaping';
import {containsRightToLeftText, processBidirectionalText} from '../src/bidi';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {orderBidirectionalText, transformText, wrapText} from '../src/text-layout';

/** The code points of `text`, as `U+XXXX` strings, so that a failure shows what was drawn. */
function codePoints(text: string): string[] {
  return Array.from(
    text,
    character => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
  );
}

/** Creates a label layer, with empty label state, for accessor tests. */
function labelLayer(layout: Record<string, unknown>) {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout},
    zoom: 4
  } as any);
  layer.state = {labelData: []};
  return layer;
}

// تشاد (Chad): teh, sheen, alef, dal.
const CHAD = 'تشاد';
// The same, in the shapes it is written in: initial teh, medial sheen, final alef, isolated dal
// (alef does not join the letter after it).
const CHAD_SHAPED = 'ﺗﺸﺎﺩ';
// السودان (Sudan): alef, lam, seen, waw, dal, alef, noon.
const SUDAN = 'السودان';
// Isolated alef, initial lam, medial seen, final waw; dal, alef and noon stand alone, as neither
// dal nor alef joins the letter after it.
const SUDAN_SHAPED = 'ﺍﻟﺴﻮﺩﺍﻥ';
// الخرطوم (Khartoum): alef, lam, khah, reh, tah, waw, meem.
const KHARTOUM = 'الخرطوم';
const KHARTOUM_SHAPED = 'ﺍﻟﺨﺮﻃﻮﻡ';

describe('applyArabicShaping', () => {
  test('writes each letter in the shape it takes in its word', () => {
    expect(codePoints(applyArabicShaping(CHAD))).toEqual(codePoints(CHAD_SHAPED));
    expect(codePoints(applyArabicShaping(SUDAN))).toEqual(codePoints(SUDAN_SHAPED));
    expect(codePoints(applyArabicShaping(KHARTOUM))).toEqual(codePoints(KHARTOUM_SHAPED));
  });

  test('writes lam followed by alef as their ligature', () => {
    // لا alone, and after a letter that joins it: سلام (salaam).
    expect(codePoints(applyArabicShaping('لا'))).toEqual(['U+FEFB']);
    expect(codePoints(applyArabicShaping('سلام'))).toEqual(codePoints('ﺳﻼﻡ'));
  });

  test('leaves text without Arabic as it is', () => {
    expect(applyArabicShaping('Khartoum')).toBe('Khartoum');
    expect(applyArabicShaping('שלום')).toBe('שלום');
  });
});

describe('processBidirectionalText', () => {
  test('reverses right-to-left text', () => {
    expect(codePoints(processBidirectionalText(CHAD_SHAPED, []).join(''))).toEqual(
      codePoints('ﺩﺎﺸﺗ')
    );
  });

  test('keeps left-to-right runs in order within a left-to-right paragraph', () => {
    const [line] = processBidirectionalText(`Khartoum ${KHARTOUM_SHAPED}`, []);
    expect(codePoints(line)).toEqual(
      codePoints(`Khartoum ${Array.from(KHARTOUM_SHAPED).reverse().join('')}`)
    );
  });

  test('puts a left-to-right run on the right of a right-to-left paragraph', () => {
    const [line] = processBidirectionalText(`${KHARTOUM_SHAPED} Khartoum`, []);
    expect(codePoints(line)).toEqual(
      codePoints(`Khartoum ${Array.from(KHARTOUM_SHAPED).reverse().join('')}`)
    );
  });

  test('breaks at line break points and at paragraph ends, reordering each line', () => {
    expect(processBidirectionalText('אב גד', [3])).toEqual([
      // The trailing space takes the paragraph's direction, at the line's right end.
      ' בא',
      'דג'
    ]);
    expect(processBidirectionalText('Chad\nאב', [])).toEqual(['Chad\n', 'בא']);
    // The space ending a left-to-right run of a right-to-left paragraph moves to the paragraph's
    // end of the line (rule L1), rather than staying with the run.
    expect(processBidirectionalText('\u05d0\u05d1 abc def', [7])).toEqual([
      ' abc \u05d1\u05d0',
      'def'
    ]);
  });

  test('mirrors brackets read right to left', () => {
    expect(processBidirectionalText('א(ב)', [])).toEqual(['(ב)א']);
  });

  test('detects right-to-left text', () => {
    expect(containsRightToLeftText('Khartoum (1)')).toBe(false);
    expect(containsRightToLeftText(`Khartoum ${KHARTOUM}`)).toBe(true);
    expect(containsRightToLeftText(CHAD_SHAPED)).toBe(true);
  });
});

describe('labels', () => {
  test('text-transform shapes Arabic, as MapLibre does', () => {
    expect(transformText(CHAD, 'none')).toBe(CHAD_SHAPED);
  });

  test('wrapText reorders each line it breaks', () => {
    const measure = () => 1;
    expect(wrapText(`Khartoum ${KHARTOUM_SHAPED}`, 6, measure)).toBe(
      `Khartoum\n${Array.from(KHARTOUM_SHAPED).reverse().join('')}`
    );
    // Without a break opportunity, the text is still reordered.
    expect(wrapText(CHAD_SHAPED, 6, measure)).toBe('ﺩﺎﺸﺗ');
    expect(orderBidirectionalText(CHAD_SHAPED)).toBe('ﺩﺎﺸﺗ');
    expect(orderBidirectionalText('Main Street')).toBe('Main Street');
  });

  test('point labels are shaped, wrapped in logical order and reordered per line', () => {
    const layer = labelLayer({
      'text-field': ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']]
    });
    const label = layer.getLabel({
      geometry: {type: 'Point', coordinates: [0, 0]},
      properties: {'name:latin': 'Chad', 'name:nonlatin': CHAD}
    } as any);
    expect(codePoints(label!)).toEqual(codePoints('Chad\nﺩﺎﺸﺗ'));
  });

  test('line labels are shaped and reordered', () => {
    const layer = labelLayer({'symbol-placement': 'line', 'text-field': ['get', 'name']});
    const label = layer.getLabel({
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [10, 0]
        ]
      },
      properties: {name: `Khartoum ${SUDAN}`}
    } as any);
    expect(codePoints(label!)).toEqual(
      codePoints(`Khartoum ${Array.from(SUDAN_SHAPED).reverse().join('')}`)
    );
  });

  test('the glyphs requested for a label are those of its shaped text', () => {
    const requested: string[] = [];
    const layer = labelLayer({'text-field': ['get', 'name']});
    layer.props = {
      ...layer.props,
      glyphs: {
        url: 'glyphs/{fontstack}/{range}.pbf',
        hasGlyphs: () => false,
        retain: () => true,
        load: (_fontStack: string, texts: string[]) => {
          requested.push(...texts);
          return null;
        }
      }
    } as any;
    layer.hasLabelGlyphs(
      [{geometry: {type: 'Point', coordinates: [0, 0]}, properties: {name: CHAD}}] as any,
      new Set()
    );
    expect(requested.map(codePoints)).toEqual([codePoints(CHAD_SHAPED)]);
  });
});

describe('untrusted tile text', () => {
  test('a long run of marks between a lam and its alef is shaped without overflowing the stack', () => {
    const marks = 'َ'.repeat(2_000_000);
    // The marks follow the lam-alef ligature.
    const shaped = applyArabicShaping(`ل${marks}ا`);
    expect(shaped.length).toBe(1 + marks.length);
  });

  test('a label of many paragraphs is reordered in one pass, each line at its own level', () => {
    // 120,000 paragraphs: matching each line to its paragraph by search would take 7e9 steps.
    const text = Array.from({length: 120_000}, (_, i) => (i % 2 ? 'تشاد' : 'Chad')).join('\n');
    const start = performance.now();
    const lines = processBidirectionalText(text, []);
    // About 0.5 s here; the search took 8 s.
    expect(performance.now() - start).toBeLessThan(3000);
    expect(lines).toHaveLength(120_000);
    expect(lines.slice(0, 3).map(line => line.trim())).toEqual(['Chad', 'داشت', 'Chad']);
  });
});
