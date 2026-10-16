/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {testLayerAsync} from '@deck.gl/test-utils/vitest';
import {BasemapLayer} from '../src/basemap-layer';

const STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'bg',
      type: 'background',
      paint: {'background-color': ['interpolate', ['linear'], ['zoom'], 7, '#ff0000', 8, '#0000ff']}
    },
    {id: 'bg-late', type: 'background', minzoom: 7.5, paint: {'background-color': '#00ff00'}}
  ]
};

/** BasemapLayer counts as loaded only once its style has resolved. */
class LoadedBasemapLayer extends BasemapLayer {
  static layerName = 'LoadedBasemapLayer';

  get isLoaded(): boolean {
    return super.isLoaded && Boolean(this.state?.resolvedStyle);
  }
}

function viewportAt(zoom: number) {
  return new WebMercatorViewport({width: 100, height: 100, longitude: 0, latitude: 0, zoom});
}

function backgroundIds(subLayers: {id: string}[]): string[] {
  return subLayers.map(layer => layer.id.replace('basemap-', '')).sort();
}

function fillColorOf(subLayers: any[], id: string) {
  return subLayers.find(layer => layer.id === `basemap-${id}`)?.props.getFillColor;
}

describe('BasemapLayer zoom lifecycle', () => {
  test('regenerates sublayers at zoom steps and at fractional minzoom, not in between', async () => {
    const renderCounts: number[] = [];
    await testLayerAsync({
      Layer: LoadedBasemapLayer as any,
      createSpy: (obj: any, method: string) => vi.spyOn(obj, method),
      resetSpy: spy => spy.mockClear(),
      onError: error => {
        throw error;
      },
      spies: ['renderLayers'],
      testCases: [
        {
          title: 'z7.2: below the 7.5 minzoom; color evaluated at zoom 7',
          props: {id: 'basemap', style: STYLE},
          viewport: viewportAt(7.2),
          onAfterUpdate: ({layer, subLayers}) => {
            if (!layer.isLoaded) return;
            expect(backgroundIds(subLayers)).toEqual(['bg']);
            expect(fillColorOf(subLayers, 'bg')).toEqual([255, 0, 0, 255]);
          }
        },
        {
          title: 'z7.9: crossing the fractional minzoom regenerates; color evaluated at 7.75',
          viewport: viewportAt(7.9),
          onAfterUpdate: ({subLayers}) => {
            expect(backgroundIds(subLayers)).toEqual(['bg', 'bg-late']);
            const [red, , blue] = fillColorOf(subLayers, 'bg');
            expect(red).toBeLessThan(255);
            expect(blue).toBeGreaterThan(0);
          }
        },
        {
          title: 'z8.05: crossing an integer zoom re-evaluates at zoom 8',
          viewport: viewportAt(8.05),
          onAfterUpdate: ({subLayers}) => {
            expect(fillColorOf(subLayers, 'bg')).toEqual([0, 0, 255, 255]);
          }
        },
        {
          title: 'z8.2: same zoom step, no regeneration',
          viewport: viewportAt(8.2),
          onAfterUpdate: ({spies}) => {
            renderCounts.push(spies.renderLayers.mock.calls.length);
          }
        }
      ]
    });
    expect(renderCounts).toEqual([0]);
  });
});
