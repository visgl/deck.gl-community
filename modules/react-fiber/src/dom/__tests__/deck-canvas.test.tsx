import {StrictMode} from 'react';
import {cleanup, render} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {MapView} from '@deck.gl/core';
import type {Deck, DeckProps, Widget} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {DeckCanvas} from '../deck-canvas';
import {getCanvasRegistry} from '../deck-canvas-registry';

vi.mock('client-only', () => ({}));
afterEach(cleanup);

function createDeck() {
  const deck = {
    props: {_canvases: [], views: [], layers: [], widgets: [], layerFilter: null} as DeckProps,
    setProps: vi.fn(function (this: {props: DeckProps}, props: DeckProps) {
      Object.assign(this.props, props);
    }),
    finalize: vi.fn()
  };
  return deck as unknown as Deck;
}
const createLayer = (id: string) => new ScatterplotLayer({id, data: []});
const createView = (id: string) => new MapView({id});
function createCanvas(id: string) {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  return canvas;
}

describe('DeckCanvas', () => {
  it('mounts two panels, updates local props and restores the latest baseline on unmount', () => {
    const deck = createDeck();
    const original = deck.setProps;
    const global = createLayer('global');
    deck.setProps({layers: [global]});
    const a = createView('a');
    const b = createView('b');
    const first = createLayer('first');
    const second = createLayer('second');
    const panelA = render(<DeckCanvas deck={deck} views={a} layers={[first]} id="canvas-a" />);
    const panelB = render(<DeckCanvas deck={deck} views={b} layers={[second]} id="canvas-b" />);
    expect(deck.props._canvases).toHaveLength(2);
    expect(a.props.canvasId).toBeUndefined();
    expect((deck.props.views as MapView[]).map(view => view.props.canvasId)).toEqual([
      'canvas-a',
      'canvas-b'
    ]);
    const replacement = createLayer('replacement');
    panelA.rerender(<DeckCanvas deck={deck} views={a} layers={[replacement]} id="canvas-a" />);
    expect(deck.props.layers).toEqual([global, replacement, second]);
    const updatedGlobal = createLayer('updated-global');
    deck.setProps({layers: [updatedGlobal]});
    expect(deck.props.layers).toEqual([updatedGlobal, replacement, second]);
    panelA.unmount();
    expect(deck.props.layers).toEqual([updatedGlobal, second]);
    panelB.unmount();
    expect(deck.props.layers).toEqual([updatedGlobal]);
    expect(deck.props._canvases).toEqual([]);
    expect(deck.setProps).toBe(original);
    expect(deck.finalize).not.toHaveBeenCalled();
  });

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

  it('attaches external canvases, survives StrictMode and never finalizes the Deck', () => {
    const deck = createDeck();
    const canvas = createCanvas('external');
    document.body.append(canvas);
    const panel = render(
      <StrictMode>
        <DeckCanvas deck={deck} canvas="external" views={createView('external-view')} />
      </StrictMode>
    );
    expect(panel.container.children).toHaveLength(0);
    expect(deck.props._canvases).toEqual([canvas]);
    panel.unmount();
    expect(deck.props._canvases).toEqual([]);
    expect(deck.finalize).not.toHaveBeenCalled();
    canvas.remove();
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
  it('preserves baseline canvases, views and widgets while panels move between decks', () => {
    const first = createDeck();
    const second = createDeck();
    const baselineCanvas = createCanvas('baseline');
    const baselineView = createView('baseline-view');
    const baselineWidget = {id: 'baseline-widget', viewId: 'baseline-view'} as Widget;
    first.setProps({_canvases: [baselineCanvas], views: [baselineView], widgets: [baselineWidget]});
    const external = createCanvas('panel');
    const view = createView('panel-view');
    const widget = {id: 'panel-widget', viewId: 'panel-view'} as Widget;
    const panel = render(
      <DeckCanvas deck={first} canvas={external} views={view} widgets={[widget]} />
    );
    expect(first.props.widgets).toEqual([baselineWidget, widget]);
    expect(first.props._canvases).toEqual([baselineCanvas, external]);
    panel.rerender(<DeckCanvas deck={second} canvas={external} views={view} widgets={[widget]} />);
    expect(first.props._canvases).toEqual([baselineCanvas]);
    expect(first.props.views).toEqual([baselineView]);
    expect(first.props.widgets).toEqual([baselineWidget]);
    expect(second.props._canvases).toEqual([external]);
    panel.unmount();
    expect(second.props.widgets).toEqual([]);
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
});
