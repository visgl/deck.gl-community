/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {BasemapLayer, getBasemapLayers, getGlobeBaseLayers} from '../src/index.ts';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';
import {getLabelFont} from '../src/text-font.ts';

describe('getLabelFont', () => {
  test('strips the style words into the weight and keeps the family', () => {
    expect(getLabelFont(['Noto Sans Regular'])).toEqual({
      fontFamily: '"Noto Sans", sans-serif',
      fontWeight: 400,
      fontStyle: 'normal'
    });
  });

  test('lists every font of the stack in order, then the generic family', () => {
    expect(getLabelFont(['Open Sans Bold', 'Arial Unicode MS Bold'])).toEqual({
      fontFamily: '"Open Sans", "Arial Unicode MS", sans-serif',
      fontWeight: 700,
      fontStyle: 'normal'
    });
  });

  test('lists a family once', () => {
    expect(getLabelFont(['Noto Sans Bold', 'Noto Sans Regular']).fontFamily).toBe(
      '"Noto Sans", sans-serif'
    );
  });

  test.each([
    ['Roboto Thin', 100],
    ['Roboto Hairline', 100],
    ['Roboto ExtraLight', 200],
    ['Roboto Extra Light', 200],
    ['Roboto UltraLight', 200],
    ['Roboto Light', 300],
    ['Roboto Book', 400],
    ['Roboto Normal', 400],
    ['Roboto Medium', 500],
    ['Roboto Semibold', 600],
    ['Roboto SemiBold', 600],
    ['Roboto Semi Bold', 600],
    ['Roboto DemiBold', 600],
    ['Roboto Bold', 700],
    ['Roboto ExtraBold', 800],
    ['Roboto Extra Bold', 800],
    ['Roboto UltraBold', 800],
    ['Roboto Black', 900],
    ['Roboto Heavy', 900],
    ['Roboto', 400]
  ])('%s has weight %d and family Roboto', (name, weight) => {
    const font = getLabelFont([name]);
    expect(font.fontWeight).toBe(weight);
    expect(font.fontFamily).toBe('"Roboto", sans-serif');
  });

  test.each([
    ['Noto Sans Italic', 400],
    ['Open Sans Semibold Italic', 600],
    ['Roboto Bold Italic', 700],
    ['Roboto BoldItalic', 700],
    ['Roboto Light Oblique', 300]
  ])('%s is italic with weight %d', (name, weight) => {
    const font = getLabelFont([name]);
    expect(font.fontStyle).toBe('italic');
    expect(font.fontWeight).toBe(weight);
    expect(font.fontFamily).not.toMatch(/Italic|Oblique|Bold|Light|Semibold/);
  });

  test('takes the weight and style from the first font of the stack', () => {
    expect(getLabelFont(['Noto Sans Italic', 'Arial Unicode MS Bold'])).toMatchObject({
      fontWeight: 400,
      fontStyle: 'italic'
    });
  });

  test('strips only trailing style words', () => {
    expect(getLabelFont(['Black Han Sans Regular']).fontFamily).toBe(
      '"Black Han Sans", sans-serif'
    );
  });

  test('keeps a name that is only a style word', () => {
    expect(getLabelFont(['Italic'])).toMatchObject({
      fontFamily: '"Italic", sans-serif',
      fontStyle: 'normal'
    });
    expect(getLabelFont(['Bold'])).toMatchObject({fontFamily: '"Bold", sans-serif'});
  });

  test('falls back to serif or monospace when the name says so', () => {
    expect(getLabelFont(['Noto Serif Bold']).fontFamily).toBe('"Noto Serif", serif');
    expect(getLabelFont(['Roboto Mono Regular']).fontFamily).toBe('"Roboto Mono", monospace');
    expect(getLabelFont(['PT Sans Regular']).fontFamily).toBe('"PT Sans", sans-serif');
    expect(getLabelFont(['Microsoft Sans Serif']).fontFamily).toBe(
      '"Microsoft Sans Serif", sans-serif'
    );
  });

  test('escapes quotes in a family name', () => {
    expect(getLabelFont(['My "Font" Regular']).fontFamily).toBe('"My \\"Font\\"", sans-serif');
  });

  test('an empty stack is the generic family alone', () => {
    expect(getLabelFont([])).toEqual({
      fontFamily: 'sans-serif',
      fontWeight: 400,
      fontStyle: 'normal'
    });
  });
});

function feature(properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [0, 0]},
    properties: {layerName: 'place', ...properties}
  };
}

function labelLayer(
  layout: Record<string, unknown>,
  {
    zoom = 7.6,
    fontFamily,
    features = [feature()]
  }: {zoom?: number; fontFamily?: unknown; features?: any[]} = {}
): any {
  const layer: any = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout: {'text-field': 'Label', ...layout}, paint: {}},
    zoom,
    ...(fontFamily === undefined ? {} : {fontFamily})
  } as any);
  layer.state = {
    labelData: features.map((f, index) => layer.getSubLayerRow({position: [0, 0]}, f, index))
  };
  layer.context = {} as any;
  layer.internalState = {subLayers: []} as any;
  return layer;
}

function textSubLayer(layer: any): any {
  return layer.renderLayers().find((sublayer: any) => sublayer.id.endsWith('text'));
}

describe('MVTLabelLayer text-font', () => {
  test('the text sublayer takes its font from text-font', () => {
    const text = textSubLayer(
      labelLayer({'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']})
    );
    expect(text.props.fontFamily).toBe('"Open Sans", "Arial Unicode MS", sans-serif');
    expect(text.props.fontWeight).toBe(700);
  });

  test('without text-font, labels use the style spec default font', () => {
    const text = textSubLayer(labelLayer({}));
    expect(text.props.fontFamily).toBe('"Open Sans", "Arial Unicode MS", sans-serif');
    expect(text.props.fontWeight).toBe(400);
  });

  test('an italic font puts the style in front of the weight', () => {
    const text = textSubLayer(labelLayer({'text-font': ['Noto Sans Italic']}));
    expect(text.props.fontFamily).toBe('"Noto Sans", sans-serif');
    expect(text.props.fontWeight).toBe('italic 400');
  });

  test('a zoom-dependent text-font is evaluated at the zoom step', () => {
    const layout = {
      'text-font': [
        'step',
        ['zoom'],
        ['literal', ['Noto Sans Regular']],
        8,
        ['literal', ['Noto Sans Bold']]
      ]
    };
    expect(textSubLayer(labelLayer(layout, {zoom: 7.6})).props.fontWeight).toBe(400);
    expect(textSubLayer(labelLayer(layout, {zoom: 8.1})).props.fontWeight).toBe(700);
  });

  test('a data-driven text-font uses the first label feature', () => {
    const layout = {
      'text-font': [
        'match',
        ['get', 'class'],
        'city',
        ['literal', ['Noto Sans Bold']],
        ['literal', ['Noto Sans Italic']]
      ]
    };
    const cityFirst = labelLayer(layout, {features: [feature({class: 'city'}), feature()]});
    expect(textSubLayer(cityFirst).props.fontWeight).toBe(700);
    const villageFirst = labelLayer(layout, {features: [feature(), feature({class: 'city'})]});
    expect(textSubLayer(villageFirst).props.fontWeight).toBe('italic 400');
  });

  test('a fontFamily string replaces the family and keeps the weight', () => {
    const text = textSubLayer(
      labelLayer({'text-font': ['Noto Sans Bold']}, {fontFamily: 'Monaco, monospace'})
    );
    expect(text.props.fontFamily).toBe('Monaco, monospace');
    expect(text.props.fontWeight).toBe(700);
  });

  test('a fontFamily function receives the font stack and returns the family', () => {
    const stacks: string[][] = [];
    const text = textSubLayer(
      labelLayer(
        {'text-font': ['Noto Sans Bold', 'Arial Unicode MS Bold']},
        {
          fontFamily: (fontStack: string[]) => {
            stacks.push(fontStack);
            return 'Inter, sans-serif';
          }
        }
      )
    );
    expect(stacks).toEqual([['Noto Sans Bold', 'Arial Unicode MS Bold']]);
    expect(text.props.fontFamily).toBe('Inter, sans-serif');
    expect(text.props.fontWeight).toBe(700);
  });

  test('a fontFamily function can set the weight and style too', () => {
    const text = textSubLayer(
      labelLayer(
        {'text-font': ['Noto Sans Bold']},
        {fontFamily: () => ({fontFamily: '"Noto Sans Bold Web"', fontWeight: 400})}
      )
    );
    expect(text.props.fontFamily).toBe('"Noto Sans Bold Web"');
    expect(text.props.fontWeight).toBe(400);
  });

  test('fields a fontFamily function leaves unset keep the mapped values', () => {
    const text = textSubLayer(
      labelLayer(
        {'text-font': ['Noto Sans Bold']},
        {fontFamily: () => ({fontFamily: undefined, fontStyle: 'italic'})}
      )
    );
    expect(text.props.fontFamily).toBe('"Noto Sans", sans-serif');
    expect(text.props.fontWeight).toBe('italic 700');
  });

  test('a fontFamily function returning nothing keeps the mapped font', () => {
    const text = textSubLayer(
      labelLayer({'text-font': ['Noto Sans Bold']}, {fontFamily: () => null})
    );
    expect(text.props.fontFamily).toBe('"Noto Sans", sans-serif');
    expect(text.props.fontWeight).toBe(700);
  });
});

describe('fontFamily plumbing', () => {
  const style = {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {
        id: 'places',
        type: 'symbol',
        source: 'tiles',
        'source-layer': 'place',
        layout: {'text-field': '{name}', 'text-font': ['Noto Sans Regular']}
      }
    ]
  } as any;

  function render(fontFamily?: string) {
    return getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 7,
      styleDefinition: style,
      fontFamily
    } as any).find(layer => layer.id === 'test-tiles') as any;
  }

  test('symbol sublayers receive fontFamily from getBasemapLayers', () => {
    const [labels] = render('Monaco, monospace').props.renderSubLayers({
      id: 'test-tiles-tile',
      data: [feature({name: 'A'})],
      tile: {index: {x: 0, y: 0, z: 7}}
    });
    expect(labels.props.fontFamily).toBe('Monaco, monospace');
  });

  test('tiles regenerate when fontFamily changes', () => {
    expect(render().props.updateTriggers.renderSubLayers).not.toEqual(
      render('Monaco, monospace').props.updateTriggers.renderSubLayers
    );
  });

  test('getGlobeBaseLayers passes fontFamily on', () => {
    const vectorLayer = getGlobeBaseLayers({
      idPrefix: 'test',
      zoom: 7,
      styleDefinition: style,
      fontFamily: 'Monaco, monospace'
    }).find(layer => layer.id === 'test-tiles') as any;
    const [labels] = vectorLayer.props.renderSubLayers({
      id: 'test-tiles-tile',
      data: [feature({name: 'A'})],
      tile: {index: {x: 0, y: 0, z: 7}}
    });
    expect(labels.props.fontFamily).toBe('Monaco, monospace');
  });

  test('BasemapLayer passes its fontFamily prop to getBasemapLayers', () => {
    const layer: any = new BasemapLayer({
      id: 'test',
      style,
      fontFamily: 'Monaco, monospace'
    } as any);
    layer.state = {resolvedStyle: style, spriteAtlases: null, zoomKey: null};
    layer.context = {viewport: {zoom: 7}} as any;
    const vectorLayer = layer.renderLayers().find((sublayer: any) => sublayer.id === 'test-tiles');
    const [labels] = vectorLayer.props.renderSubLayers({
      id: 'test-tiles-tile',
      data: [feature({name: 'A'})],
      tile: {index: {x: 0, y: 0, z: 7}}
    });
    expect(labels.props.fontFamily).toBe('Monaco, monospace');
  });
});
