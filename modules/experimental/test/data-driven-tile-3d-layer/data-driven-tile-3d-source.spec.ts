import {afterEach, describe, expect, it, vi} from 'vitest';
import {Tile3DLayer} from '@deck.gl/geo-layers';
import {DataDrivenTile3DLayer} from '../../src';

const mocks = vi.hoisted(() => ({
  createTileset: vi.fn(),
  createI3S: vi.fn(),
  create3DTiles: vi.fn()
}));
vi.mock('@loaders.gl/tiles-3d', async importOriginal => ({
  ...(await importOriginal<typeof import('@loaders.gl/tiles-3d')>()),
  Tileset3D: class {
    constructor(...args) {
      return mocks.createTileset(...args);
    }
  },
  I3SSource: class {
    constructor(...args) {
      return mocks.createI3S(...args);
    }
  },
  Tiles3DSource: class {
    constructor(...args) {
      return mocks.create3DTiles(...args);
    }
  }
}));
afterEach(() => vi.restoreAllMocks());

describe('DataDrivenTile3DLayer source initialization', () => {
  it.each([
    'i3s',
    '3d-tiles'
  ])('waits for the %s source before publishing its tileset', async id => {
    let initialize!: () => void;
    const tileset = {
      tilesetInitializationPromise: new Promise<void>(resolve => {
        initialize = resolve;
      })
    };
    const source = {};
    mocks.createTileset.mockReturnValue(tileset);
    mocks.createI3S.mockReturnValue(source);
    mocks.create3DTiles.mockReturnValue(source);
    const onTilesetLoad = vi.fn();
    const loader = {id};
    const layer = new DataDrivenTile3DLayer({
      id: 'source-test',
      loaders: [loader],
      onTilesetLoad,
      loadOptions: {tileset: {maximumMemoryUsage: 128}, fetch: {headers: {Authorization: 'test'}}}
    } as any);
    layer.state = {activeViewports: []} as any;
    const setState = vi
      .spyOn(layer, 'setState')
      .mockImplementation(state => Object.assign(layer.state, state));
    const update = vi
      .spyOn(Tile3DLayer.prototype as any, '_updateTileset')
      .mockImplementation(() => {});
    const loading = (layer as any)._loadTileset('https://example.com/tileset');
    expect(setState).not.toHaveBeenCalled();
    expect(onTilesetLoad).not.toHaveBeenCalled();
    expect(id === 'i3s' ? mocks.createI3S : mocks.create3DTiles).toHaveBeenCalledWith(
      expect.objectContaining({url: 'https://example.com/tileset', loader}),
      {fetch: {headers: {Authorization: 'test'}}}
    );
    expect(mocks.createTileset).toHaveBeenCalledWith(
      source,
      expect.objectContaining({maximumMemoryUsage: 128})
    );
    initialize();
    await loading;
    expect(layer.state.tileset3d).toBe(tileset);
    expect(update).toHaveBeenCalledWith([]);
    expect(onTilesetLoad).toHaveBeenCalledWith(tileset);
  });
});
