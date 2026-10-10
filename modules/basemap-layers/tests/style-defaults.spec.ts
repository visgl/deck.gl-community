/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';

const SOURCES = {
  tiles: {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
  }
};

const polygon = {
  type: 'Feature',
  geometry: {type: 'Polygon', coordinates: []},
  properties: {layerName: 'land'}
};

const point = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {layerName: 'land', name: 'Label'}
};

function getLayers(styleLayers: Record<string, unknown>[], zoom = 7.6): any[] {
  return getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {version: 8, sources: SOURCES, layers: styleLayers} as any
  });
}

/** Renders one vector style layer for one tile and returns its sublayer. */
function renderSubLayer(styleLayer: Record<string, unknown>, features: unknown[]): any {
  const layers = getLayers([{source: 'tiles', 'source-layer': 'land', ...styleLayer}]);
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  const [sublayer] = vectorLayer.props.renderSubLayers({
    id: 'test-tiles-tile',
    data: features,
    tile: {index: {x: 0, y: 0, z: 7}}
  });
  return sublayer;
}

function labelLayer(layout: Record<string, unknown>): any {
  return new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout: {'text-field': 'Label', ...layout}},
    zoom: 7.6
  } as any);
}

describe('style specification defaults', () => {
  test('a fill without fill-color is black', () => {
    const sublayer = renderSubLayer({id: 'land', type: 'fill'}, [polygon]);
    expect(sublayer.props.getFillColor).toEqual([0, 0, 0, 255]);
  });

  test('a background without background-color is black', () => {
    const [background] = getLayers([{id: 'background', type: 'background'}]);
    expect(background.props.getFillColor).toEqual([0, 0, 0, 255]);
  });

  test('a label without text-size is 16 px', () => {
    expect(labelLayer({}).getLabelSize(point)).toBe(16);
  });

  test('text-offset is in ems of the default text-size', () => {
    expect(labelLayer({'text-offset': [0, 1]}).getLabelPixelOffset(point)).toEqual([0, 16]);
  });

  test('a text-size of 0 hides the label', () => {
    const layer = labelLayer({'text-size': 0});
    expect(layer.getLabelSize(point)).toBe(0);
    expect(layer.getLabel(point)).toBeUndefined();
  });

  test('a zoom-dependent text-size that reaches 0 hides the label at that zoom', () => {
    const layer = labelLayer({'text-size': ['step', ['zoom'], 0, 8, 12]});
    expect(layer.getLabel(point)).toBeUndefined();
    expect(layer.getLabelUpdateTriggers().getText).not.toEqual(
      labelLayer({'text-size': ['step', ['zoom'], 12, 8, 0]}).getLabelUpdateTriggers().getText
    );
  });
});

describe('patterns disable colors', () => {
  test('a fill-pattern fill without fill-color draws nothing, not black', () => {
    const sublayer = renderSubLayer(
      {id: 'land', type: 'fill', paint: {'fill-pattern': 'wetland'}},
      [polygon]
    );
    expect(sublayer.props.getFillColor).toEqual([0, 0, 0, 0]);
  });

  test('a fill-pattern disables an explicit fill-color', () => {
    const sublayer = renderSubLayer(
      {id: 'land', type: 'fill', paint: {'fill-pattern': 'wetland', 'fill-color': '#00ff00'}},
      [polygon]
    );
    expect(sublayer.props.getFillColor).toEqual([0, 0, 0, 0]);
  });

  test('a background-pattern background without background-color draws nothing, not black', () => {
    const [background] = getLayers([
      {id: 'background', type: 'background', paint: {'background-pattern': 'paper'}}
    ]);
    expect(background.props.getFillColor).toEqual([0, 0, 0, 0]);
  });

  test('a background-pattern disables an explicit background-color', () => {
    const [background] = getLayers([
      {
        id: 'background',
        type: 'background',
        paint: {'background-pattern': 'paper', 'background-color': '#ff0000'}
      }
    ]);
    expect(background.props.getFillColor).toEqual([0, 0, 0, 0]);
  });
});

describe('text halo width', () => {
  const symbol = {id: 'land', type: 'symbol', layout: {'text-field': '{name}'}};

  test('no halo is drawn without a text-halo-width', () => {
    const sublayer = renderSubLayer({...symbol, paint: {'text-halo-color': '#ffffff'}}, [point]);
    expect(sublayer.getLabelHalo(point)).toBeNull();
  });

  test('no halo is drawn with a text-halo-width of 0', () => {
    const sublayer = renderSubLayer(
      {...symbol, paint: {'text-halo-color': '#ffffff', 'text-halo-width': 0}},
      [point]
    );
    expect(sublayer.getLabelHalo(point)).toBeNull();
  });

  test('no halo is drawn without a text-halo-color', () => {
    // The default `text-halo-color` is transparent.
    const sublayer = renderSubLayer({...symbol, paint: {'text-halo-width': 1}}, [point]);
    expect(sublayer.getLabelHalo(point)).toBeNull();
  });

  test('a data-driven text-halo-width is evaluated per feature', () => {
    const sublayer = renderSubLayer(
      {...symbol, paint: {'text-halo-color': '#ffffff', 'text-halo-width': ['get', 'halo']}},
      [point]
    );
    const withHalo = (halo: number) => ({...point, properties: {...point.properties, halo}});
    expect(sublayer.getLabelHalo(withHalo(0))).toBeNull();
    expect(sublayer.getLabelHalo(withHalo(2))?.outlineColor).toEqual([255, 255, 255, 255]);
  });

  test('a zoom-dependent text-halo-width of 0 at this zoom hides the halo', () => {
    const sublayer = renderSubLayer(
      {
        ...symbol,
        paint: {
          'text-halo-color': '#ffffff',
          'text-halo-width': ['step', ['zoom'], 0, 10, 2]
        }
      },
      [point]
    );
    expect(sublayer.getLabelHalo(point)).toBeNull();
  });

  test('a halo is drawn with a positive text-halo-width', () => {
    const sublayer = renderSubLayer(
      {...symbol, paint: {'text-halo-color': '#ffffff', 'text-halo-width': 1}},
      [point]
    );
    expect(sublayer.getLabelHalo(point)?.outlineColor).toEqual([255, 255, 255, 255]);
  });
});
