/* eslint-disable import/no-extraneous-dependencies */
import {LayerExtension} from '@deck.gl/core';
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

function point(properties = {}, coordinates = [1, 2]): any {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates},
    properties: {layerName: 'poi', ...properties}
  };
}

function circle(paint = {}, layout = {}): any {
  return {id: 'circles', type: 'circle', source: 'tiles', 'source-layer': 'poi', paint, layout};
}

function render(layers = [circle()], features = [point()], zoom = 12): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {version: 8, sources: SOURCES, layers} as any
  }).find(layer => layer.id === 'test-tiles');
  return (
    vectorLayer?.props
      .renderSubLayers({
        id: 'test-tiles-tile',
        data: features,
        tile: {index: {x: 0, y: 0, z: 12}}
      })
      .filter(Boolean) ?? []
  );
}

function props(paint = {}, layout = {}): any {
  return render([circle(paint, layout)])[0].props;
}

describe('circle layers', () => {
  test('creates a CircleStyleLayer with pixel units', () => {
    const [layer] = render();
    expect(layer.constructor.layerName).toBe('CircleStyleLayer');
    expect(layer.props.radiusUnits).toBe('pixels');
    expect(layer.props.lineWidthUnits).toBe('pixels');
  });

  test('uses style specification defaults', () => {
    const p = props();
    expect(p.getRadius).toBe(5);
    expect(p.getFillColor).toEqual([0, 0, 0, 255]);
    expect(p.getLineColor).toEqual([0, 0, 0, 255]);
    expect(p.getLineWidth).toBe(0);
    expect(p.stroked).toBe(false);
    expect(p.getBlur).toBe(0);
  });

  test('evaluates constant paint and places the stroke outside the radius', () => {
    const p = props({
      'circle-radius': 8,
      'circle-color': '#ff0000',
      'circle-opacity': 0.5,
      'circle-stroke-width': 4,
      'circle-stroke-color': '#00ff00',
      'circle-stroke-opacity': 0.25
    });
    expect(p.getRadius).toBe(10);
    expect(p.getLineWidth).toBe(4);
    expect(p.getFillColor).toEqual([255, 0, 0, 128]);
    expect(p.getLineColor).toEqual([0, 255, 0, 64]);
    expect(p.stroked).toBe(true);
  });

  test('evaluates data-driven paint per feature', () => {
    const p = props({
      'circle-radius': ['get', 'size'],
      'circle-color': ['match', ['get', 'kind'], 'a', '#ff0000', '#0000ff'],
      'circle-stroke-width': ['get', 'width']
    });
    expect(p.getRadius(point({size: 7, width: 2}))).toBe(8);
    expect(p.getRadius(point({size: 3, width: 0}))).toBe(3);
    expect(p.getLineWidth(point({width: 2}))).toBe(2);
    expect(p.getFillColor(point({kind: 'a'}))).toEqual([255, 0, 0, 255]);
    expect(p.getFillColor(point({kind: 'b'}))).toEqual([0, 0, 255, 255]);
  });

  test('evaluates zoom-dependent radius', () => {
    expect(
      props({'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 10]}).getRadius
    ).toBe(6);
  });

  test('keeps fill and stroke opacity independent', () => {
    const fill = props({'circle-opacity': 0.25, 'circle-stroke-width': 2});
    expect(fill.getFillColor[3]).toBe(64);
    expect(fill.getLineColor[3]).toBe(255);
    const stroke = props({'circle-stroke-opacity': 0.25, 'circle-stroke-width': 2});
    expect(stroke.getFillColor[3]).toBe(255);
    expect(stroke.getLineColor[3]).toBe(64);
  });

  test('clamps data-driven blur', () => {
    const p = props({'circle-blur': ['get', 'blur']});
    expect(p.getBlur(point({blur: -1}))).toBe(0);
    expect(p.getBlur(point({blur: 0.4}))).toBe(0.4);
    expect(p.getBlur(point({blur: 2}))).toBe(1);
  });

  test('expands MultiPoints, preserving parent geometry and properties, and skips other geometry', () => {
    const single = point();
    const multi = {
      ...point({size: 9}),
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [3, 4],
          [5, 6]
        ]
      }
    };
    const other = ['LineString', 'Polygon'].map(type => ({
      ...point(),
      geometry: {type, coordinates: []}
    }));
    const p = render([circle()], [single, multi, ...other])[0].props;
    expect(p.data).toHaveLength(3);
    expect(p.data[0]).toBe(single);
    expect(p.data.slice(1).map(p.getPosition)).toEqual([
      [3, 4],
      [5, 6]
    ]);
    expect(p.getPosition(single)).toEqual([1, 2]);
    for (const datum of p.data.slice(1)) {
      expect(datum.properties).toBe(multi.properties);
      expect(datum.geometry).toBe(multi.geometry);
    }
    expect(render([circle()], other)).toEqual([]);
  });

  test.each(['Point', 'MultiPoint'])('reuses %s data across zoom steps', type => {
    const features = [
      type === 'Point'
        ? point()
        : {
            ...point(),
            geometry: {
              type,
              coordinates: [
                [1, 2],
                [3, 4]
              ]
            }
          }
    ];
    const layers = [circle()];
    const first = render(layers, features, 12)[0].props.data;
    expect(render(layers, features, 12.5)[0].props.data).toBe(first);
    if (type === 'Point') expect(first[0]).toBe(features[0]);
    const unfiltered = {...circle(), 'source-layer': undefined};
    if (type === 'Point') expect(render([unfiltered], features)[0].props.data).toBe(features);
  });

  test('sorts ascending with stable ties and caches the sorted array', () => {
    const features = [point({key: 2}), point({key: 1}), point({key: 2})];
    const layers = [circle({}, {'circle-sort-key': ['get', 'key']})];
    const data = render(layers, features)[0].props.data;
    expect(data).toEqual([features[1], features[0], features[2]]);
    expect(render(layers, features, 12.5)[0].props.data).toBe(data);
    layers[0].layout['circle-sort-key'] = ['-', 0, ['get', 'key']];
    expect(render(layers, features)[0].props.data).toEqual([features[0], features[2], features[1]]);
    expect(features[0].properties.key).toBe(2);
  });

  test('invalidates sorted data when a zoom-dependent sort key changes', () => {
    const features = [point({a: 1, b: 2}), point({a: 2, b: 1})];
    const layers = [
      circle(
        {},
        {
          'circle-sort-key': ['step', ['zoom'], ['get', 'a'], 13, ['get', 'b']]
        }
      )
    ];
    const first = render(layers, features, 12)[0].props.data;
    expect(first).toEqual(features);
    expect(render(layers, features, 13)[0].props.data).toEqual([features[1], features[0]]);
  });

  test('keeps tile order without a sort key', () => {
    const features = [point({key: 2}), point({key: 1})];
    expect(render([circle()], features)[0].props.data).toEqual(features);
  });

  test('applies filters', () => {
    const features = [point({keep: true}), point({keep: false})];
    expect(
      render([{...circle(), filter: ['==', ['get', 'keep'], true]}], features)[0].props.data
    ).toEqual([features[0]]);
  });

  test('applies minzoom and exclusive maxzoom', () => {
    const layers = [{...circle(), minzoom: 11, maxzoom: 13}];
    expect(render(layers, [point()], 10)).toEqual([]);
    expect(render(layers, [point()], 11)).toHaveLength(1);
    expect(render(layers, [point()], 13)).toEqual([]);
  });

  test('applies layout visibility', () => {
    expect(render([circle({}, {visibility: 'none'})])).toEqual([]);
  });

  test('translates pixels with positive style y downward in both alignments', () => {
    for (const alignment of ['viewport', 'map']) {
      expect(
        props({'circle-translate': [3, 4], 'circle-pitch-alignment': alignment}).getPixelOffset
      ).toEqual([3, -4]);
    }
  });

  test('uses map pitch alignment or billboards by default', () => {
    expect(props({'circle-pitch-alignment': 'map'}).billboard).toBe(false);
    expect(props().billboard).toBe(true);
  });

  test('preserves draw order between fill and line layers', () => {
    const layers = [
      {...circle(), id: 'fill', type: 'fill'},
      circle(),
      {...circle(), id: 'line', type: 'line'}
    ];
    expect(render(layers).map(layer => layer.id)).toEqual([
      'test-tiles-tile-fill',
      'test-tiles-tile-circles',
      'test-tiles-tile-line'
    ]);
  });

  test('disables a constant zero stroke at the evaluation zoom', () => {
    expect(props({'circle-stroke-width': 0}).stroked).toBe(false);
    const layers = [circle({'circle-stroke-width': ['step', ['zoom'], 0, 13, 2]})];
    expect(render(layers, [point()], 12)[0].props.stroked).toBe(false);
    expect(render(layers, [point()], 13)[0].props.stroked).toBe(true);
  });

  test('passes zoom-dependent feature accessor update triggers', () => {
    const expression = ['interpolate', ['linear'], ['zoom'], 10, ['get', 'a'], 14, ['get', 'b']];
    const p = props({
      'circle-radius': expression,
      'circle-stroke-width': expression,
      'circle-opacity': expression,
      'circle-stroke-opacity': expression,
      'circle-blur': expression
    });
    for (const name of ['getRadius', 'getLineWidth', 'getFillColor', 'getLineColor', 'getBlur']) {
      expect(p.updateTriggers[name]).toBe(12);
    }
  });

  test('keeps the shader injections of extensions, such as the tile clip', () => {
    const HOOKS = ['vs:#decl', 'vs:#main-end', 'fs:#decl', 'fs:DECKGL_FILTER_COLOR'];
    class InjectingExtension extends LayerExtension {
      getShaders() {
        return {modules: [], inject: Object.fromEntries(HOOKS.map(hook => [hook, '// extension']))};
      }
    }
    const [layer] = render();
    const extended = layer.clone({extensions: [new InjectingExtension()]});
    extended.context = {device: {type: 'webgl'}, defaultShaderModules: []};
    const {inject} = extended.getShaders();
    for (const hook of HOOKS) {
      expect(inject[hook]).toContain('// extension');
      expect(inject[hook]).toContain('CircleBlur');
    }
  });
});
