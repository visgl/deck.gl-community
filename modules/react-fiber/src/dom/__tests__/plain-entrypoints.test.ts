import {afterEach, describe, expect, it, vi} from 'vitest';

afterEach(() => {
  vi.doUnmock('@deck.gl/mapbox');
  vi.doUnmock('@deck.gl/maplibre');
  vi.resetModules();
});

function blockProviderImports() {
  vi.doMock('@deck.gl/mapbox', () => {
    throw new Error('The plain entrypoint must not load @deck.gl/mapbox.');
  });
  vi.doMock('@deck.gl/maplibre', () => {
    throw new Error('The plain entrypoint must not load @deck.gl/maplibre.');
  });
}

describe('plain entrypoint provider isolation', () => {
  it('loads the native root without either provider package', async () => {
    blockProviderImports();

    const dom = await import('../index');

    expect(Object.keys(dom).sort()).toEqual(['DeckGL', 'createDeckGL']);
  });

  it('loads the compatibility root without either provider package', async () => {
    blockProviderImports();

    const compat = await import('../../compat');

    expect(Object.keys(compat).sort()).toEqual([
      'DeckGL',
      'FirstPersonView',
      'GlobeView',
      'MapView',
      'OrbitView',
      'OrthographicView'
    ]);
  });
});
