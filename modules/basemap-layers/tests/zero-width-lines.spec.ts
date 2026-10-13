/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {ZoomPaintContext} from '../src/globe-layers';
import {getZoomBucket} from '../src/style-accessor';
import {ZOOM_PAINT_WIDTH_ROW, getZoomPaintOffset} from '../src/zoom-paint-extension';

// A line whose width is 0 at one zoom step and not at the next keeps its sublayer at that step,
// hidden or in its batch, so the step that gives it a width does not make the sublayer, or its
// batch, again.

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

const road = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1]
    ]
  },
  properties: {layerName: 'land'}
};

/** The tile's content, the same array at every render, as a tile keeps its content. */
const TILE_CONTENT = [road];

/** The style of `styleLayers`, the same object for the same array, as a basemap keeps its style. */
const styles = new WeakMap<object, any>();
function makeStyle(styleLayers: Record<string, unknown>[]): any {
  let style = styles.get(styleLayers);
  if (!style) {
    style = {
      version: 8,
      sources: SOURCES,
      layers: styleLayers.map(layer => ({source: 'tiles', 'source-layer': 'land', ...layer}))
    };
    styles.set(styleLayers, style);
  }
  return style;
}

const context = new ZoomPaintContext();

/** One tile's sublayers, with paint from `ZoomPaintExtension` as on WebGL, or without it. */
function renderTile(
  styleLayers: Record<string, unknown>[],
  zoom: number,
  {
    webgl = true,
    mode = 'map',
    tileProps = {}
  }: {webgl?: boolean; mode?: 'map' | 'globe'; tileProps?: Record<string, unknown>} = {}
): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode,
    zoom,
    styleDefinition: makeStyle(styleLayers)
  }).find(layer => layer.id === 'test-tiles');
  context.zoom = getZoomBucket(zoom);
  return vectorLayer.props
    .renderSubLayers({
      id: 'tile',
      data: TILE_CONTENT,
      tile: {index: {x: 0, y: 0, z: 12}},
      zoomPaintContext: webgl ? context : null,
      ...tileProps
    })
    .flat()
    .filter(Boolean);
}

/** The style layer ids each sublayer is named after, with `hidden:` before hidden ones. */
function idsOf(layers: any[]): string[] {
  return layers.map(
    layer => `${layer.props.visible === false ? 'hidden:' : ''}${layer.id.replace(/^tile-/, '')}`
  );
}

const line = (
  id: string,
  paint: Record<string, unknown>,
  layout: Record<string, unknown> = {}
) => ({
  id,
  type: 'line',
  paint: {'line-color': '#000000', ...paint},
  layout
});

/** 0 up to zoom 5, then wider: it starts drawing at the 5.25 step. */
const STARTS_AT_5 = ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 4];
/** 1 at zoom 5, 0 from 5.25: it stops drawing at the 5.25 step. */
const STOPS_AT_5 = ['interpolate', ['linear'], ['zoom'], 5, 1, 5.25, 0];
/** 0 below zoom 13.5, so over many steps from zoom 12. */
const STARTS_AT_13 = ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14, 2];

/** The zoom paint width of part `part` of a sublayer at `zoom`. */
function widthOf(layer: any, part: number, zoom: number): number {
  context.zoom = getZoomBucket(zoom);
  return layer.props.zoomPaint.getValues()[getZoomPaintOffset(ZOOM_PAINT_WIDTH_ROW, part)];
}

describe('a line at width 0 for one zoom step', () => {
  test('that starts drawing at the next step keeps its sublayer, hidden', () => {
    const style = [line('road', {'line-width': STARTS_AT_5})];
    const [before] = renderTile(style, 5);
    const [after] = renderTile(style, 5.25);
    expect(idsOf([before])).toEqual(['hidden:"road"']);
    expect(before.props.pickable).toBe(false);
    expect(idsOf([after])).toEqual(['"road"']);
    expect(after.props.data).toBe(before.props.data);
    expect(widthOf(before, 0, 5)).toBe(0);
    expect(widthOf(after, 0, 5.25)).toBeGreaterThan(0);
  });

  test('that stopped drawing at the previous step keeps its sublayer, hidden, for one step', () => {
    const style = [line('road', {'line-width': STOPS_AT_5})];
    const [drawn] = renderTile(style, 5);
    const [kept] = renderTile(style, 5.25);
    expect(idsOf([drawn])).toEqual(['"road"']);
    expect(idsOf([kept])).toEqual(['hidden:"road"']);
    expect(kept.props.data).toBe(drawn.props.data);
    // Two steps on, the width is 0 on both sides: the line is left out.
    expect(renderTile(style, 5.5)).toEqual([]);
  });

  test('transparent at this step only, it is kept for the step where it draws', () => {
    const appears = ['step', ['zoom'], 0, 5.25, 1];
    const style = [line('road', {'line-width': STARTS_AT_5, 'line-opacity': appears})];
    const [before] = renderTile(style, 5);
    const [after] = renderTile(style, 5.25);
    expect(idsOf([before])).toEqual(['hidden:"road"']);
    expect(idsOf([after])).toEqual(['"road"']);
    expect(after.props.data).toBe(before.props.data);
  });

  test('a line at width 0 over several steps is left out', () => {
    expect(renderTile([line('road', {'line-width': STARTS_AT_13})], 12)).toEqual([]);
  });

  test('stays in its batch, which keeps its name and data across the step', () => {
    const style = [line('casing', {'line-width': 3}), line('road', {'line-width': STARTS_AT_5})];
    const [before] = renderTile(style, 5);
    const [after] = renderTile(style, 5.25);
    expect(idsOf([before])).toEqual(['["casing","road"]']);
    expect(idsOf([after])).toEqual(['["casing","road"]']);
    expect(after.props.data).toBe(before.props.data);
    // The batch draws its lines; the kept line has width 0 from the texture.
    expect(before.props.stroked).toBe(true);
    expect(widthOf(before, 0, 5)).toBe(3);
    expect(widthOf(before, 1, 5)).toBe(0);
  });

  test('starting a batch, still draws the batch', () => {
    const style = [line('road', {'line-width': STARTS_AT_5}), line('casing', {'line-width': 3})];
    const [batch] = renderTile(style, 5);
    expect(idsOf([batch])).toEqual(['["road","casing"]']);
    expect(batch.props.stroked).toBe(true);
    expect(batch.props.drawsLineStrings).toBe(true);
  });

  test('separates its neighbours as at the step that gives it a width', () => {
    const style = [
      line('a', {'line-width': 3}, {'line-cap': 'round'}),
      line('kept', {'line-width': STARTS_AT_5}),
      line('c', {'line-width': 3}, {'line-cap': 'round'})
    ];
    expect(idsOf(renderTile(style, 5))).toEqual(['"a"', 'hidden:"kept"', '"c"']);
    expect(idsOf(renderTile(style, 5.25))).toEqual(['"a"', '"kept"', '"c"']);
  });

  test('a batch of lines all at width 0 is hidden, and adds no draw', () => {
    const style = [line('a', {'line-width': STARTS_AT_5}), line('b', {'line-width': STARTS_AT_5})];
    expect(idsOf(renderTile(style, 5))).toEqual(['hidden:["a","b"]']);
  });

  test('on a globe, and with highlighting, draws alone and hidden', () => {
    const style = [line('casing', {'line-width': 3}), line('road', {'line-width': STARTS_AT_5})];
    expect(idsOf(renderTile(style, 5, {mode: 'globe'}))).toEqual(['"casing"', 'hidden:"road"']);
    const highlighted = renderTile(style, 5, {tileProps: {highlightedFeatureId: 1}});
    expect(idsOf(highlighted)).toEqual(['"casing"', 'hidden:"road"']);
    expect(highlighted[1].props.pickable).toBe(false);
  });
});

describe('a line that draws nothing is left out, as before', () => {
  test('without the zoom paint texture, which would put its width in attributes', () => {
    const style = [line('casing', {'line-width': 3}), line('road', {'line-width': STARTS_AT_5})];
    expect(idsOf(renderTile(style, 5, {webgl: false}))).toEqual(['"casing"']);
  });

  test('without the texture, it does not separate its neighbours', () => {
    const style = [
      line('a', {'line-width': 3}, {'line-cap': 'round'}),
      line('kept', {'line-width': STARTS_AT_5}),
      line('c', {'line-width': 3}, {'line-cap': 'round'})
    ];
    expect(idsOf(renderTile(style, 5, {webgl: false}))).toEqual(['["a","c"]']);
  });

  test('in a batch of more style layers than the texture holds', () => {
    const style = [
      ...Array.from({length: 65}, (_, i) => line(`l${i}`, {'line-width': 1})),
      line('kept', {'line-width': STARTS_AT_5})
    ];
    const [batch] = renderTile(style, 5);
    expect(batch.props.zoomPaint).toBeUndefined();
    expect(JSON.parse(batch.id.replace(/^tile-/, ''))).not.toContain('kept');
  });

  test.each([
    ['an offset', {'line-offset': 2}],
    ['a gap', {'line-gap-width': 2}],
    ['a blur', {'line-blur': 1}]
  ])('with %s, which takes its width in attributes, and does not separate its neighbours', (_, paint) => {
    expect(renderTile([line('road', {'line-width': STARTS_AT_5, ...paint})], 5)).toEqual([]);
    const style = [
      line('a', {'line-width': 3}),
      line('road', {'line-width': STARTS_AT_5, ...paint}),
      line('c', {'line-width': 3})
    ];
    expect(idsOf(renderTile(style, 5))).toEqual(['["a","c"]']);
  });

  test('when it is transparent', () => {
    const fadesIn = ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 1];
    const style = [
      line('casing', {'line-width': 3}),
      line('road', {'line-width': 2, 'line-opacity': fadesIn})
    ];
    expect(idsOf(renderTile(style, 5))).toEqual(['"casing"']);
    // At width 0 too: it would draw nothing at the next step either.
    const invisible = [
      line('a', {'line-width': 3}),
      line('road', {'line-width': STARTS_AT_5, 'line-opacity': 0}),
      line('c', {'line-width': 3})
    ];
    expect(idsOf(renderTile(invisible, 5))).toEqual(['["a","c"]']);
    expect(idsOf(renderTile(invisible, 5.25))).toEqual(['["a","c"]']);
  });
});
