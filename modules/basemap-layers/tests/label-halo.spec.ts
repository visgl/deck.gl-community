/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getOutlineWidth, MAX_HALO_SUBLAYERS, MVTLabelLayer} from '../src/mvt-label-layer.ts';

const feature = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {layerName: 'place', rank: 2}
};

const WHITE_HALO = {'text-halo-color': '#ffffff', 'text-halo-width': 1};

function haloLayer(
  paint: Record<string, unknown>,
  zoom = 7.6,
  data: unknown[] = [],
  layout: Record<string, unknown> = {}
): any {
  return new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout: {'text-field': 'Label', ...layout}, paint},
    zoom,
    data
  } as any);
}

/** Runs `updateState` outside deck.gl and returns the layer's text sublayers. */
function renderTextLayers(layer: any, dataChanged = true): any[] {
  layer.context = {} as any;
  layer.internalState = {subLayers: []} as any;
  layer.state = layer.state || {};
  layer.setState = (partial: Record<string, unknown>) => Object.assign(layer.state, partial);
  layer.updateState({changeFlags: {dataChanged}} as any);
  return layer.renderLayers().filter((sublayer: any) => /-text(-\d+)?$/.test(sublayer.id));
}

/** The label a text sublayer draws for each row. */
function drawnText(text: any, rows: unknown[]): unknown[] {
  return rows.map((row, index) => text.props.getText(row, {index, data: rows, target: []}));
}

describe('label halo opacity', () => {
  test('a hidden label leaves no halo', () => {
    const layer = haloLayer({...WHITE_HALO, 'text-opacity': 0});
    expect(layer.getLabelColor(feature)[3]).toBe(0);
    expect(layer.getLabelHalo(feature)).toBeNull();
  });

  test('the halo fades with a data-driven text-opacity', () => {
    const layer = haloLayer({...WHITE_HALO, 'text-opacity': ['/', ['get', 'rank'], 4]});
    expect(layer.getLabelHalo(feature).outlineColor).toEqual([255, 255, 255, 128]);
  });

  test('keeps a faint halo faint', () => {
    // `rgba(255,255,255,0.004)` keeps a 0-255 alpha of 1.
    const faint = {'text-halo-color': 'rgba(255,255,255,0.004)', 'text-halo-width': 1};
    expect(haloLayer(faint).getLabelHalo(feature).outlineColor).toEqual([255, 255, 255, 1]);
    const translucent = {'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1};
    expect(
      haloLayer({...translucent, 'text-opacity': 0.5}).getLabelHalo(feature).outlineColor
    ).toEqual([255, 255, 255, 102]);
  });
});

describe('label halo width', () => {
  test('converts text-halo-width pixels to a TextLayer outline width', () => {
    // A 1 px halo on 16 px text is 4 pixels of the 64 px atlas glyph, drawn at 0.75 per unit.
    expect(getOutlineWidth(1, 16)).toBeCloseTo(5.33, 2);
    // The same halo on text twice the size is half as wide relative to the glyph.
    expect(getOutlineWidth(1, 32)).toBeCloseTo(2.67, 2);
    expect(getOutlineWidth(2, 16)).toBeCloseTo(10.67, 2);
  });

  test('caps the halo at a quarter of the text size, as MapLibre does', () => {
    expect(getOutlineWidth(10, 16)).toEqual(getOutlineWidth(4, 16));
    expect(getOutlineWidth(4, 16)).toBeGreaterThan(getOutlineWidth(3, 16));
  });

  test('uses the text size of the feature', () => {
    const layer = haloLayer({...WHITE_HALO}, 7.6, [], {'text-size': 20});
    expect(layer.getLabelHalo(feature).outlineWidth).toEqual(getOutlineWidth(1, 20));
  });
});

describe('label halo wiring', () => {
  test('one halo draws one text sublayer with an outline', () => {
    const texts = renderTextLayers(haloLayer({...WHITE_HALO}, 7.6, [feature, feature]));
    expect(texts).toHaveLength(1);
    expect(texts[0].props.fontSettings.sdf).toBe(true);
    expect(texts[0].props.outlineWidth).toEqual(getOutlineWidth(1, 16));
    expect(texts[0].props.outlineColor).toEqual([255, 255, 255, 255]);
    // The background box is only for the collision pass, never a visible halo.
    expect(texts[0].props.getBackgroundColor).toEqual([0, 0, 0, 0]);
  });

  test('without a halo the text has no outline', () => {
    const texts = renderTextLayers(haloLayer({'text-halo-color': '#ffffff'}, 7.6, [feature]));
    expect(texts).toHaveLength(1);
    expect(texts[0].props.outlineWidth).toBe(0);
  });

  test('each distinct halo draws its own rows, keeping row indices', () => {
    const features = [1, 2, 0, 2].map(halo => ({
      ...feature,
      properties: {...feature.properties, halo}
    }));
    const layer = haloLayer(
      {'text-halo-color': '#ffffff', 'text-halo-width': ['get', 'halo']},
      7.6,
      features
    );
    const texts = renderTextLayers(layer);
    const rows = layer.state.labelData;
    expect(texts.map(text => text.props.outlineWidth)).toEqual([
      getOutlineWidth(1, 16),
      getOutlineWidth(2, 16),
      0
    ]);
    // Every sublayer gets all rows, so the collision filter sees the same row indices.
    expect(texts.every(text => text.props.data === rows)).toBe(true);
    expect(texts.map(text => drawnText(text, rows))).toEqual([
      ['Label', undefined, undefined, undefined],
      [undefined, 'Label', undefined, 'Label'],
      [undefined, undefined, 'Label', undefined]
    ]);
  });

  test('a zoom-dependent halo is re-evaluated at a new zoom step', () => {
    const paint = {'text-halo-color': '#ffffff', 'text-halo-width': ['step', ['zoom'], 0, 10, 2]};
    const layer = haloLayer(paint, 8, [feature]);
    expect(renderTextLayers(layer)[0].props.outlineWidth).toBe(0);
    const rows = layer.state.labelData;
    // deck.gl carries the state over to the layer with the new props; the tile data is unchanged.
    const zoomed = haloLayer(paint, 11, [feature]);
    zoomed.state = layer.state;
    expect(renderTextLayers(zoomed, false)[0].props.outlineWidth).toEqual(getOutlineWidth(2, 16));
    expect(zoomed.state.labelData).toBe(rows);
  });

  test('a tile where every label has its own halo draws a bounded number of sublayers', () => {
    // 1,000 labels with unique halo colors, except the last 20, which share the most common one.
    const features = Array.from({length: 1000}, (_, index) => ({
      ...feature,
      properties: {
        ...feature.properties,
        red: index % 256,
        green: index >> 8,
        blue: index < 980 ? 255 : 0
      }
    }));
    const layer = haloLayer(
      {
        'text-halo-color': [
          'case',
          ['==', ['get', 'blue'], 0],
          'black',
          ['rgb', ['get', 'red'], ['get', 'green'], ['get', 'blue']]
        ],
        'text-halo-width': 1
      },
      7.6,
      features
    );
    const texts = renderTextLayers(layer);
    const rows = layer.state.labelData;
    expect(texts).toHaveLength(MAX_HALO_SUBLAYERS);
    // Every label is still drawn, by exactly one sublayer.
    const drawn = texts.map(text => drawnText(text, rows));
    for (let index = 0; index < rows.length; index++) {
      expect(drawn.filter(labels => labels[index] === 'Label')).toHaveLength(1);
    }
    // A label whose halo did not get a sublayer is drawn with the most common halo.
    const common = texts.findIndex(text => text.props.outlineColor.join() === '0,0,0,255');
    expect(common).toBeGreaterThanOrEqual(0);
    expect(drawn[common][999]).toBe('Label');
    expect(drawn[common][500]).toBe('Label');
    // The other sublayers keep the halos of the first labels. The common halo's sublayer comes
    // last, and draws its first label at row 7, the first one whose halo was not kept.
    expect(common).toBe(MAX_HALO_SUBLAYERS - 1);
    expect(drawn.map(labels => labels.indexOf('Label'))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('halo widths are rounded to quarter pixels, so close widths share a sublayer', () => {
    const features = [1, 1.05, 1.1, 0.05].map(halo => ({
      ...feature,
      properties: {...feature.properties, halo}
    }));
    const layer = haloLayer(
      {'text-halo-color': '#ffffff', 'text-halo-width': ['get', 'halo']},
      7.6,
      features
    );
    expect(renderTextLayers(layer).map(text => text.props.outlineWidth)).toEqual([
      getOutlineWidth(1, 16),
      // A positive width keeps at least a quarter pixel.
      getOutlineWidth(0.25, 16)
    ]);
  });
});
