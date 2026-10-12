// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test} from 'vitest';
import {spaceParagraph} from '../src/label-text-layer';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {allowsLetterSpacing} from '../src/text-layout';

/** Creates a point feature with expression inputs. */
function feature(properties: Record<string, unknown> = {}) {
  return {geometry: {type: 'Point', coordinates: [0, 0]}, properties};
}

/** Creates a label layer, with empty label state, for accessor tests. */
function labelLayer(layout: Record<string, unknown> = {}, zoom = 7.6) {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout},
    zoom
  } as any);
  layer.state = {labelData: []};
  return layer;
}

/** The `TextLayer` layout of 'AB\nC', 10 atlas pixels per character, as `transformParagraph`. */
function twoLineLayout() {
  return {
    x: [5, 15, 0, 5],
    y: [10, 10, 0, 30],
    rowWidth: [20, 20, 0, 10],
    size: [20, 40] as [number, number]
  };
}

describe('spaceParagraph', () => {
  test('adds the spacing after every character of a line but the last', () => {
    const layout = spaceParagraph(twoLineLayout(), 'AB\nC', 4, 0.5, 0.5);
    expect(layout.x).toEqual([5, 19, 0, 5]);
    expect(layout.rowWidth).toEqual([24, 24, 0, 10]);
    expect(layout.size).toEqual([24, 40]);
    expect(layout.y).toEqual([10, 10, 0, 30]);
  });

  test('moves each line from the anchor position to the justified position in the box', () => {
    // Centered anchor: TextLayer centers each line; left justification moves the short line by
    // half the space it leaves, right justification the other way.
    expect(spaceParagraph(twoLineLayout(), 'AB\nC', 0, 0, 0.5).x).toEqual([5, 15, 0, 0]);
    expect(spaceParagraph(twoLineLayout(), 'AB\nC', 0, 1, 0.5).x).toEqual([5, 15, 0, 10]);
    // Left anchor (TextLayer aligns lines left): centered and right-justified lines.
    expect(spaceParagraph(twoLineLayout(), 'AB\nC', 0, 0.5, 0).x).toEqual([5, 15, 0, 10]);
    expect(spaceParagraph(twoLineLayout(), 'AB\nC', 0, 1, 0).x).toEqual([5, 15, 0, 15]);
    // Spacing and justification together: the box is 24 wide, the short line 10.
    expect(spaceParagraph(twoLineLayout(), 'AB\nC', 4, 1, 0).x).toEqual([5, 19, 0, 19]);
  });

  test('returns the layout as is when neither spacing nor justification changes it', () => {
    const layout = twoLineLayout();
    expect(spaceParagraph(layout, 'AB\nC', 0, 0.5, 0.5)).toBe(layout);
    expect(spaceParagraph(layout, 'AB\nC', 0, 1, 1)).toBe(layout);
  });

  test('indexes characters by code point', () => {
    const layout = {
      x: [5, 15],
      y: [10, 10],
      rowWidth: [20, 20],
      size: [20, 20] as [number, number]
    };
    expect(spaceParagraph(layout, '\u{20000}A', 4, 0.5, 0.5).x).toEqual([5, 19]);
  });
});

describe('text-letter-spacing', () => {
  test('is evaluated per feature, in ems, defaulting to 0', () => {
    expect(labelLayer({'text-field': 'A'}).getLetterSpacing(feature(), 'A')).toBe(0);
    const layer = labelLayer({'text-field': 'A', 'text-letter-spacing': ['get', 'spacing']});
    expect(layer.getLetterSpacing(feature({spacing: 0.2}), 'A')).toBe(0.2);
    expect(layer.getLetterSpacing(feature({spacing: 0}), 'A')).toBe(0);
    const zoomed = labelLayer({
      'text-field': 'A',
      'text-letter-spacing': {
        stops: [
          [14, 0],
          [16, 0.2]
        ]
      }
    });
    expect(zoomed.getLetterSpacing(feature(), 'A')).toBe(0);
    expect(labelLayer(zoomed.props.styleLayer!.layout, 16).getLetterSpacing(feature(), 'A')).toBe(
      0.2
    );
  });

  test('does not space cursive scripts, as MapLibre', () => {
    expect(allowsLetterSpacing('Gulf of Mexico')).toBe(true);
    expect(allowsLetterSpacing('東京')).toBe(true);
    expect(allowsLetterSpacing('القاهرة')).toBe(false);
    expect(allowsLetterSpacing('Cairo القاهرة')).toBe(false);
    const layer = labelLayer({'text-field': '{name}', 'text-letter-spacing': 0.2});
    expect(layer.getLetterSpacing(feature(), 'القاهرة')).toBe(0);
  });

  test('widens every character when wrapping', () => {
    // Without a canvas every character is half an em: 4.5 ems fit in 5, 9 ems do not.
    const layout = {'text-field': 'aaaa bbbb', 'text-max-width': 5};
    expect(labelLayer(layout).getLabel(feature())).toBe('aaaa bbbb');
    expect(labelLayer({...layout, 'text-letter-spacing': 0.5}).getLabel(feature())).toBe(
      'aaaa\nbbbb'
    );
  });

  test('is passed to the text sublayer, as a constant where the style layer does not set it', () => {
    const textLayer = (layer: MVTLabelLayer) =>
      (layer.renderLayers() as any[]).find(sublayer => sublayer.id.endsWith('-text'));
    expect(textLayer(labelLayer({'text-field': 'A'})).props.getLetterSpacing).toBe(0);
    const layer = labelLayer({'text-field': 'A', 'text-letter-spacing': 0.25});
    const row = {__source: {object: feature(), index: 0}};
    layer.state.labelData = [row as any];
    const getLetterSpacing = textLayer(layer).props.getLetterSpacing;
    expect(getLetterSpacing(row, {index: 0, data: [row], target: []})).toBe(0.25);
  });

  test('re-lays out and re-wraps text, and re-places line labels, when it changes', () => {
    const layout: Record<string, unknown> = {'text-field': 'A', 'symbol-placement': 'line'};
    const layer = labelLayer(layout);
    const text = layer.getLabelUpdateTriggers().getText;
    const anchors = layer.getAnchorKey(false);
    layout['text-letter-spacing'] = 0.1;
    expect(layer.getLabelUpdateTriggers().getText).not.toBe(text);
    expect(layer.getAnchorKey(false)).not.toBe(anchors);
  });

  test('re-places line labels at a new zoom step when it depends on zoom', () => {
    const layout = {
      'text-field': 'A',
      'symbol-placement': 'line',
      'text-letter-spacing': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1]
    };
    const layer = labelLayer(layout, 14);
    const anchors = layer.getAnchorKey(false);
    // The same layer, updated across a fractional zoom step: the spacing it draws changes.
    (layer as any).props = {...layer.props, zoom: 14.5};
    expect(layer.getAnchorKey(false)).not.toBe(anchors);
    // A constant spacing keeps the placements across the same step.
    const constant = labelLayer({...layout, 'text-letter-spacing': 0.2}, 14);
    const constantAnchors = constant.getAnchorKey(false);
    (constant as any).props = {...constant.props, zoom: 14.5};
    expect(constant.getAnchorKey(false)).toBe(constantAnchors);
  });

  test('lengthens labels along lines by the spacing between characters', () => {
    // 'Main' is estimated at 2.4 ems without a canvas: 24 px at size 10, 54 px spaced by 1 em.
    const line = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.4, 0.5],
          [0.4 + 40 / 512, 0.5]
        ]
      },
      properties: {name: 'Main'}
    };
    const lineLayer = (layout: Record<string, unknown>) =>
      new MVTLabelLayer({
        id: 'line-labels',
        config: {labels: true},
        zoom: 14,
        tileZoom: 14,
        tileSize: 512,
        styleLayer: {
          layout: {
            'text-field': '{name}',
            'symbol-placement': 'line-center',
            'text-size': 10,
            ...layout
          }
        }
      } as any);
    expect(lineLayer({}).getLineLabelPlacements(line as any, false, 'line-center')).toHaveLength(1);
    expect(
      lineLayer({'text-letter-spacing': 1}).getLineLabelPlacements(
        line as any,
        false,
        'line-center'
      )
    ).toEqual([]);
  });
});

describe('text-justify', () => {
  test('is evaluated per feature and defaults to center', () => {
    expect(labelLayer({'text-field': 'A'}).getTextJustify(feature())).toBe('center');
    const layer = labelLayer({'text-field': 'A', 'text-justify': ['get', 'justify']});
    for (const justify of ['auto', 'left', 'center', 'right']) {
      expect(layer.getTextJustify(feature({justify}))).toBe(justify);
    }
  });

  test('centers labels along lines, as MapLibre', () => {
    const layer = labelLayer({
      'text-field': 'A',
      'text-justify': 'left',
      'symbol-placement': 'line'
    });
    expect(layer.getTextJustify(feature())).toBe('center');
  });

  test('is passed to the text sublayer, and re-lays out the text when it changes', () => {
    const layout: Record<string, unknown> = {'text-field': 'A'};
    const layer = labelLayer(layout);
    const textLayer = () =>
      (layer.renderLayers() as any[]).find(sublayer => sublayer.id.endsWith('-text'));
    expect(textLayer().props.getTextJustify).toBe('center');
    const trigger = layer.getLabelUpdateTriggers().getTextAnchor;
    layout['text-justify'] = 'left';
    expect(layer.getLabelUpdateTriggers().getTextAnchor).not.toBe(trigger);
    expect(typeof textLayer().props.getTextJustify).toBe('function');
  });
});
