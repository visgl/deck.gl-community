/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

function styleWithRoadColor(color: string) {
  return {
    version: 8,
    sources: {carto: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {
        id: 'road',
        type: 'line',
        source: 'carto',
        'source-layer': 'transportation',
        paint: {'line-color': color}
      }
    ]
  };
}

function vectorLayerFor(styleDefinition: unknown): any {
  return getBasemapLayers({
    idPrefix: 'map',
    mode: 'map',
    zoom: 1.2,
    styleDefinition: styleDefinition as any
  }).find(layer => layer.id === 'map-carto');
}

describe('switching styles that share a source', () => {
  test('regenerates tile sublayers when the style changes', () => {
    const voyager = vectorLayerFor(styleWithRoadColor('#ff0000'));
    const positron = vectorLayerFor(styleWithRoadColor('#0000ff'));
    expect(voyager.id).toBe(positron.id);
    expect(positron.props.updateTriggers.renderSubLayers).not.toEqual(
      voyager.props.updateTriggers.renderSubLayers
    );
  });

  test('keeps the tile sublayers when the same style re-renders at the same zoom key', () => {
    const style = styleWithRoadColor('#ff0000');
    const first = vectorLayerFor(style).props.updateTriggers.renderSubLayers;
    const second = vectorLayerFor(style).props.updateTriggers.renderSubLayers;
    expect(second).toEqual(first);
  });
});
