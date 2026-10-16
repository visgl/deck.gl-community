/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {mergeStyleAccessors, sortTileSubLayers} from '../src/globe-layers';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

function feature(type: string, properties: Record<string, unknown> = {}) {
  const coordinates =
    type === 'Polygon'
      ? [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      : [
          [0, 0],
          [1, 1]
        ];
  return {
    type: 'Feature',
    geometry: {type, coordinates},
    properties: {layerName: 'land', ...properties}
  };
}

function makeStyle(styleLayers: Record<string, unknown>[]): any {
  return {
    version: 8,
    sources: SOURCES,
    layers: styleLayers.map(layer => ({source: 'tiles', 'source-layer': 'land', ...layer}))
  };
}

/**
 * Renders the style layers (or a style) for one tile and returns the tile's sublayers of each
 * tile layer of the source: a layer after a label layer starts another one (see
 * `getStyleLayerRuns`), whose style layer indices start again at 0.
 */
function renderRuns(
  style: Record<string, unknown>[] | any,
  features: unknown[],
  zoom = 12,
  mode: 'map' | 'globe' = 'map',
  tileProps: Record<string, unknown> = {}
): any[][] {
  return getBasemapLayers({
    idPrefix: 'test',
    mode,
    zoom,
    styleDefinition: Array.isArray(style) ? makeStyle(style) : style
  })
    .filter((layer: any) => layer.id.startsWith('test-tiles'))
    .map((vectorLayer: any) =>
      vectorLayer.props
        .renderSubLayers({
          id: 'tile',
          data: features,
          tile: {index: {x: 0, y: 0, z: 12}},
          ...tileProps
        })
        .flat()
    );
}

/** The sublayers of one tile over all of the source's tile layers, in style order. */
function renderTile(
  style: Record<string, unknown>[] | any,
  features: unknown[],
  zoom = 12,
  mode: 'map' | 'globe' = 'map',
  tileProps: Record<string, unknown> = {}
): any[] {
  return renderRuns(style, features, zoom, mode, tileProps).flat();
}

/** The style layer ids each sublayer is named after: one id, or the ids of a batch. */
function idsOf(layers: any[]): (string | string[])[] {
  return layers.map(layer => JSON.parse(layer.id.replace(/^tile-/, '')));
}

/** An accessor's value for each of a sublayer's features. */
function valuesOf(layer: any, accessor: string): unknown[] {
  const value = layer.props[accessor];
  return layer.props.data.map((object: any, index: number) =>
    typeof value === 'function' ? value(object, {index}) : value
  );
}

const fill = (id: string, color: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'fill',
  paint: {'fill-color': color},
  ...extra
});
const line = (
  id: string,
  paint: Record<string, unknown>,
  layout: Record<string, unknown> = {}
) => ({
  id,
  type: 'line',
  paint,
  layout
});

describe('consecutive style layers share a sublayer', () => {
  test('fills draw as one sublayer, each feature in its own style layer color', () => {
    const park = feature('Polygon', {class: 'park'});
    const wood = feature('Polygon', {class: 'wood'});
    const layers = renderTile(
      [
        fill('park', '#00ff00', {filter: ['==', 'class', 'park']}),
        fill('wood', '#008000', {filter: ['==', 'class', 'wood']})
      ],
      [wood, park]
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('tile-["park","wood"]');
    // The first style layer's features draw first.
    expect(layers[0].props.data).toEqual([park, wood]);
    expect(valuesOf(layers[0], 'getFillColor')).toEqual([
      [0, 255, 0, 255],
      [0, 128, 0, 255]
    ]);
  });

  test('a feature in two line style layers draws twice, casing first', () => {
    const road = feature('LineString');
    const layers = renderTile(
      [
        line('casing', {'line-color': '#000000', 'line-width': 6}),
        line('road', {'line-color': '#ffffff', 'line-width': 4})
      ],
      [road]
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].props.data).toEqual([road, road]);
    expect(valuesOf(layers[0], 'getLineWidth')).toEqual([6, 4]);
    expect(valuesOf(layers[0], 'getLineColor')).toEqual([
      [0, 0, 0, 255],
      [255, 255, 255, 255]
    ]);
  });

  test('evaluates data-driven values with their own style layer', () => {
    const a = feature('LineString', {w: 2});
    const layers = renderTile(
      [
        line('first', {'line-width': ['get', 'w']}),
        line('second', {'line-width': ['*', 3, ['get', 'w']]})
      ],
      [a]
    );
    expect(layers).toHaveLength(1);
    expect(valuesOf(layers[0], 'getLineWidth')).toEqual([2, 6]);
  });

  test('keeps a constant when every style layer has the same value', () => {
    const layers = renderTile(
      [line('a', {'line-width': 2}), line('b', {'line-width': 2, 'line-color': '#ff0000'})],
      [feature('LineString')]
    );
    expect(layers[0].props.getLineWidth).toBe(2);
    expect(typeof layers[0].props.getLineColor).toBe('function');
  });

  test('solid and dashed lines share a sublayer; the solid ones have no gaps', () => {
    const rail = feature('LineString');
    const layers = renderTile(
      [line('rail', {}), line('hatching', {'line-dasharray': [0.5, 4]}), line('next', {})],
      [rail]
    );
    expect(idsOf(layers)).toEqual([['rail', 'hatching', 'next']]);
    // The dashes, and the fade of every line (see LineBlurExtension).
    expect(layers[0].props.extensions.map((extension: any) => extension.constructor.name)).toEqual([
      'PathStyleExtension',
      'LineBlurExtension'
    ]);
    expect(valuesOf(layers[0], 'getDashArray')).toEqual([
      [0, 0],
      [1, 8],
      [0, 0]
    ]);
  });

  test('a fill or line without features in the tile does not separate its neighbours', () => {
    const layers = renderTile(
      [fill('a', '#ff0000'), {...line('road', {}), 'source-layer': 'other'}, fill('b', '#0000ff')],
      [feature('Polygon')]
    );
    expect(idsOf(layers)).toEqual([['a', 'b']]);
  });

  test('a fill or line that draws nothing does not separate its neighbours', () => {
    const layers = renderTile(
      [fill('a', '#ff0000'), line('hidden', {'line-opacity': 0}), fill('b', '#0000ff')],
      [feature('Polygon')]
    );
    expect(idsOf(layers)).toEqual([['a', 'b']]);
  });

  test('a batch draws at the index of its first style layer among all tiles', () => {
    const layers = renderTile(
      [
        {id: 'dots', type: 'circle', 'source-layer': 'other'},
        fill('a', '#ff0000'),
        fill('b', '#0000ff')
      ],
      [feature('Polygon')]
    );
    expect(idsOf(layers)).toEqual([['a', 'b']]);
    expect(layers[0].props.styleLayerIndex).toBe(1);
  });

  test('tile content edited in place is batched again', () => {
    // Without a source layer or filter, each style layer draws the tile content array itself.
    const layers = [
      {...fill('a', '#ff0000'), 'source-layer': undefined},
      {...fill('b', '#0000ff'), 'source-layer': undefined}
    ];
    const style = makeStyle(layers);
    const content = [feature('Polygon')];
    expect(renderTile(style, content)[0].props.data).toHaveLength(2);
    content.push(feature('Polygon'));
    const [batch] = renderTile(style, content);
    expect(batch.props.data).toHaveLength(4);
    expect(valuesOf(batch, 'getFillColor')).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255]
    ]);
  });

  test("a polygon added in place to an earlier line's content keeps the lines apart", () => {
    const layers = [
      {...line('a', {}), 'source-layer': undefined},
      {...line('b', {}), 'source-layer': undefined}
    ];
    const style = makeStyle(layers);
    const content = [feature('LineString')];
    expect(idsOf(renderTile(style, content))).toEqual([['a', 'b']]);
    // 'b' would draw its polygon outlines before 'a''s line strings in one sublayer.
    content.push(feature('Polygon'));
    expect(idsOf(renderTile(style, content))).toEqual(['a', 'b']);
  });

  test('reuses the batched features across zoom steps', () => {
    const features = [feature('LineString')];
    const style = makeStyle([
      line('a', {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 5]}),
      line('b', {'line-width': 1})
    ]);
    const [early] = renderTile(style, features, 12);
    const [late] = renderTile(style, features, 12.5);
    expect(late.props.data).toBe(early.props.data);
    expect(late.props.updateTriggers.getLineWidth).not.toEqual(
      early.props.updateTriggers.getLineWidth
    );
  });
});

describe('batches among all tiles', () => {
  test('draw after the earlier style layers of every tile, and before the later ones', () => {
    const style = makeStyle([
      fill('a', '#ff0000'),
      fill('b', '#0000ff'),
      {id: 'label', type: 'symbol', layout: {'text-field': 'x'}},
      fill('c', '#00ff00', {'source-layer': 'other'})
    ]);
    const polygon = feature('Polygon', {name: 'x'});
    const other = {...feature('Polygon'), properties: {layerName: 'other'}};
    // Each tile layer draws its tiles' sublayers sorted, after the tile layers before it.
    const sortRuns = (...tiles: any[][][]) =>
      tiles[0].flatMap((_, run) => sortTileSubLayers(tiles.map(runs => runs[run])));
    // The first tile has no 'other' features, the second no 'land' ones.
    const tile1 = renderRuns(style, [polygon]);
    const tile2 = renderRuns(style, [other]);
    expect(idsOf(sortRuns(tile1, tile2))).toEqual([['a', 'b'], 'label', 'c']);
    const tile3 = renderRuns(style, [polygon, other]);
    expect(
      sortRuns(tile3, tile1).map(layer => [
        JSON.parse(layer.id.replace(/^tile-/, '')),
        layer.props.styleLayerIndex
      ])
    ).toEqual([
      [['a', 'b'], 0],
      [['a', 'b'], 0],
      ['label', 2],
      ['label', 2],
      // 'c' follows the label layer, so it starts the next tile layer.
      ['c', 0]
    ]);
  });
});

describe('style layers that draw alone', () => {
  const road = feature('LineString');

  test.each([
    ['a different line-cap', {}, {'line-cap': 'round'}],
    ['an offset', {'line-offset': 2}, {}],
    ['a gap', {'line-gap-width': 2}, {}]
  ])('a line with %s', (_, paint, layout) => {
    const layers = renderTile([line('a', {}), line('b', paint, layout)], [road]);
    expect(idsOf(layers.filter(layer => !layer.id.endsWith('-gap')))).toEqual(['a', 'b']);
  });

  test('every style layer on the globe, where each sublayer gets its own depth offset', () => {
    const layers = renderTile(
      [fill('a', '#ff0000'), fill('b', '#0000ff')],
      [feature('Polygon')],
      12,
      'globe'
    );
    expect(idsOf(layers)).toEqual(['a', 'b']);
  });

  test('a fill with an outline', () => {
    const layers = renderTile(
      [fill('a', '#ff0000', {paint: {'fill-outline-color': '#000000'}}), fill('b', '#0000ff')],
      [feature('Polygon')]
    );
    expect(idsOf(layers)).toEqual(['a', 'b']);
  });

  test('a fill with a translation', () => {
    const layers = renderTile(
      [
        fill('a', '#ff0000', {paint: {'fill-color': '#ff0000', 'fill-translate': [2, 2]}}),
        fill('b', '#0000ff')
      ],
      [feature('Polygon')]
    );
    expect(idsOf(layers)).toEqual(['a', 'b']);
  });

  test('a line with a blur', () => {
    const layers = renderTile(
      [line('a', {'line-blur': 2}), line('b', {})],
      [feature('LineString')]
    );
    expect(idsOf(layers)).toEqual(['a', 'b']);
  });

  test.each([
    ['autoHighlight', {autoHighlight: true}],
    ['a highlighted feature', {highlightedFeatureId: 7}]
  ])('every style layer with %s, which colors one object per sublayer', (_, layerProps) => {
    const road = {...feature('LineString'), id: 7};
    // Through the vector tile layer, which turns autoHighlight off for its tile sublayers.
    const vectorLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 12,
      styleDefinition: makeStyle([line('casing', {}), line('road', {})])
    }).find(layer => layer.id === 'test-tiles');
    const layer = vectorLayer.clone(layerProps);
    layer.context = {viewport: {zoom: 12}};
    layer.state = {tilesetViews: new Map(), tileLayers: new Map()};
    const layers = [
      layer.renderSubLayers({
        ...layer.props,
        id: 'tile',
        data: [road],
        tile: {id: '0-0-12', index: {x: 0, y: 0, z: 12}}
      })
    ]
      .flat(Infinity)
      .filter(Boolean);
    expect(idsOf(layers)).toEqual(['casing', 'road']);
  });

  test('a fill and a line', () => {
    const layers = renderTile([fill('a', '#ff0000'), line('b', {})], [feature('Polygon')]);
    expect(idsOf(layers)).toEqual(['a', 'b']);
  });

  test('style layers separated by a label layer', () => {
    const layers = renderTile(
      [line('a', {}), {id: 'label', type: 'symbol', layout: {'text-field': 'x'}}, line('b', {})],
      [feature('LineString', {name: 'x'})]
    );
    expect(idsOf(layers)).toEqual(['a', 'label', 'b']);
  });

  test('style layers separated by a label layer without features in the tile', () => {
    // The label layer may draw in a neighbouring tile, which all tiles' 'b' must draw over.
    const layers = renderTile(
      [
        fill('a', '#ff0000'),
        {id: 'label', type: 'symbol', 'source-layer': 'other', layout: {'text-field': 'x'}},
        fill('b', '#0000ff')
      ],
      [feature('Polygon')]
    );
    expect(idsOf(layers)).toEqual(['a', 'b']);
    // 'b' follows the label layer, so it starts the next tile layer, drawn after this one.
    expect(layers.map(layer => layer.props.styleLayerIndex)).toEqual([0, 0]);
  });

  test("a line's polygon outlines after an earlier line's line strings", () => {
    // Polygon outlines draw before line strings in a sublayer, so 'b' would draw under 'a'.
    const lines = feature('LineString', {kind: 'line'});
    const rings = feature('Polygon', {kind: 'ring'});
    const layers = renderTile(
      [
        {...line('a', {}), filter: ['==', 'kind', 'line']},
        {...line('b', {}), filter: ['==', 'kind', 'ring']}
      ],
      [lines, rings]
    );
    expect(idsOf(layers)).toEqual(['a', 'b']);
  });

  test("a line's line strings after an earlier line's polygon outlines share a sublayer", () => {
    const lines = feature('LineString', {kind: 'line'});
    const rings = feature('Polygon', {kind: 'ring'});
    const layers = renderTile(
      [
        {...line('a', {}), filter: ['==', 'kind', 'ring']},
        {...line('b', {}), filter: ['==', 'kind', 'line']}
      ],
      [lines, rings]
    );
    expect(idsOf(layers)).toEqual([['a', 'b']]);
  });
});

describe('mergeStyleAccessors', () => {
  test('returns a single accessor as it is', () => {
    const accessor = {value: 3, updateTrigger: 12};
    expect(mergeStyleAccessors([accessor], [])).toBe(accessor);
  });

  test("changes its trigger when one style layer's constant changes", () => {
    const at = (width: number) =>
      mergeStyleAccessors([{value: 1}, {value: width}], [0, 1]).updateTrigger;
    expect(at(2)).toBe(at(2));
    expect(at(2)).not.toBe(at(3));
  });

  test('tells a constant from a per-feature trigger of the same text', () => {
    const indices = [0, 1];
    const constant = mergeStyleAccessors([{value: 12}, {value: 4}], indices);
    const perFeature = mergeStyleAccessors(
      [{value: () => 8, updateTrigger: 12}, {value: 4}],
      indices
    );
    expect(perFeature.updateTrigger).not.toEqual(constant.updateTrigger);
  });

  test("changes its trigger with a style layer's own trigger", () => {
    const perFeature = () => 1;
    const at = (trigger: number) =>
      mergeStyleAccessors([{value: perFeature, updateTrigger: trigger}, {value: 1}], [0, 1])
        .updateTrigger;
    expect(at(12)).not.toBe(at(12.25));
  });
});
