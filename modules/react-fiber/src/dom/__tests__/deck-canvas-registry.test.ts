import {describe, expect, it, vi} from 'vitest';
import {MapView} from '@deck.gl/core';
import type {Deck, DeckProps, Widget} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {getCanvasRegistry} from '../deck-canvas-registry';

function createDeck(): Deck<any> {
  const deck = {
    props: {
      parent: {} as HTMLDivElement,
      _canvases: [],
      views: [],
      layers: [],
      widgets: [],
      layerFilter: null
    } as DeckProps<any>,
    setProps: vi.fn(function (this: {props: DeckProps<any>}, props: DeckProps<any>) {
      Object.assign(this.props, props);
    })
  };
  return deck as unknown as Deck<any>;
}
const createLayer = (id: string) => new ScatterplotLayer({id, data: []});
const createView = (id: string) => new MapView({id});
function createCanvas(id: string): HTMLCanvasElement {
  // Registry resolution only needs identity; actual DOM registration is tested by DeckCanvas.
  return {id} as HTMLCanvasElement;
}

describe('DeckCanvas registry', () => {
  it('composes filters and routes composite descendants by their top-level owner', () => {
    const deck = createDeck();
    const baselineFilter = vi.fn(() => true);
    const localFilter = vi.fn(() => true);
    const global = createLayer('global');
    const local = createLayer('local');
    deck.setProps({layers: [global], layerFilter: baselineFilter});
    const registry = getCanvasRegistry(deck);
    registry.setContribution(
      {},
      {
        canvas: createCanvas('a'),
        views: [createView('a')],
        layers: [local],
        layerFilter: localFilter
      }
    );
    registry.setContribution({}, {canvas: createCanvas('b'), views: [createView('b')]});
    const testFilter = (layer: unknown, id: string) =>
      deck.props.layerFilter!({
        layer,
        viewport: {id},
        isPicking: false,
        renderPass: 'draw'
      } as never);
    expect(testFilter(local, 'a')).toBe(true);
    expect(testFilter(local, 'b')).toBe(false);
    expect(testFilter({id: 'child', parent: local}, 'b')).toBe(false);
    expect(testFilter(global, 'b')).toBe(true);
    expect(testFilter(global, 'a')).toBe(true);
    expect(localFilter).toHaveBeenCalledTimes(2);
    baselineFilter.mockReturnValue(false);
    expect(testFilter(global, 'a')).toBe(false);
    expect(localFilter).toHaveBeenCalledTimes(2);
  });

  it('rejects collisions and invalid scopes without changing the committed contributions', () => {
    const deck = createDeck();
    const registry = getCanvasRegistry(deck);
    const token = {};
    const layer = createLayer('local');
    registry.setContribution(token, {
      canvas: createCanvas('a'),
      views: [createView('a')],
      layers: [layer]
    });
    const originalLayers = deck.props.layers;
    expect(() =>
      registry.setContribution({}, {canvas: createCanvas('a'), views: [createView('b')]})
    ).toThrow(/canvas id/);
    expect(() =>
      registry.setContribution({}, {canvas: createCanvas('b'), views: [createView('a')]})
    ).toThrow(/view id/);
    expect(() =>
      registry.setContribution(
        {},
        {canvas: createCanvas('b'), views: [new MapView({id: 'b', canvasId: 'wrong'})]}
      )
    ).toThrow(/canvasId/);
    expect(() =>
      registry.setContribution(
        {},
        {canvas: createCanvas('b'), views: [createView('b')], layers: [createLayer('local')]}
      )
    ).toThrow(/layer id/);
    expect(() => deck.setProps({layers: [createLayer('local')]})).toThrow(/layer id/);
    expect(() =>
      registry.setContribution(
        {},
        {
          canvas: createCanvas('b'),
          views: [createView('b')],
          widgets: [{id: 'widget', viewId: 'a'} as Widget]
        }
      )
    ).toThrow(/local viewId/);
    expect(deck.props.layers).toBe(originalLayers);
    registry.removeContribution(token);
    expect(deck.props.layers).toEqual([]);
  });

  it('replaces a contribution without duplication', () => {
    const deck = createDeck();
    const registry = getCanvasRegistry(deck);
    const token = {};
    registry.setContribution(token, {canvas: createCanvas('a'), views: [createView('a')]});
    registry.setContribution(token, {
      canvas: createCanvas('a'),
      views: [createView('a')],
      layers: [createLayer('new')]
    });
    expect(deck.props._canvases).toHaveLength(1);
    expect(deck.props.layers).toHaveLength(1);
  });
  it('rejects single-canvas Decks, empty views and duplicate widget ids', () => {
    const deck = createDeck();
    deck.props._canvases = null;
    expect(() => getCanvasRegistry(deck)).toThrow(/_canvases/);
    deck.props._canvases = [];
    const registry = getCanvasRegistry(deck);
    expect(() => registry.setContribution({}, {canvas: createCanvas('a'), views: []})).toThrow(
      /empty/
    );
    const widget = {id: 'duplicate', viewId: 'a'} as Widget;
    expect(() =>
      registry.setContribution(
        {},
        {canvas: createCanvas('a'), views: [createView('a')], widgets: [widget, widget]}
      )
    ).toThrow(/widget id/);
  });
  it('requires an explicit Deck parent for panel widgets instead of mounting detached containers', () => {
    const deck = createDeck();
    deck.props.parent = null;
    const registry = getCanvasRegistry(deck);
    expect(() =>
      registry.setContribution(
        {},
        {
          canvas: createCanvas('a'),
          views: [createView('a')],
          widgets: [{id: 'zoom', viewId: 'a'} as Widget]
        }
      )
    ).toThrow(/initialized with a parent/);
    expect(deck.props.widgets).toEqual([]);
    expect(deck.props._canvases).toEqual([]);
  });
});
