// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {Deck, OrthographicView, type DeckProps} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {registerDeckPanel, setDeckPropsWithPanels} from '../src/panel-widgets/deck-panel-scene';

function canvas(id: string): HTMLCanvasElement {
  return {id} as HTMLCanvasElement;
}
function scene(id: string) {
  return {
    view: new OrthographicView({id, controller: true}),
    layers: [new ScatterplotLayer({id: `${id}-points`, data: []})],
    viewState: {target: [0, 0, 0], zoom: 0}
  };
}
function mockDeck() {
  const props: DeckProps<any> = {
    _canvases: [canvas('root')],
    views: [new OrthographicView({id: 'root'})],
    layers: scene('root').layers,
    layerFilter: vi.fn(() => true),
    onViewStateChange: vi.fn()
  };
  return {
    props,
    isInitialized: true,
    setProps: vi.fn((next: DeckProps<any>) => Object.assign(props, next)),
    finalize: vi.fn()
  } as unknown as Deck<any>;
}

describe('DeckPanel scene composition', () => {
  it('isolates root and panel layers, composite descendants, filters and camera callbacks', async () => {
    const deck = mockDeck();
    const root = {...deck.props};
    const panelScene = {
      ...scene('detail'),
      onViewStateChange: vi.fn(),
      layerFilter: vi.fn(() => true)
    };
    const registration = registerDeckPanel(deck, canvas('detail-canvas'), panelScene);
    await Promise.resolve();
    const second = registerDeckPanel(deck, canvas('other-canvas'), scene('other'));
    await Promise.resolve();
    const filter = deck.props.layerFilter!;
    const context = (id: string, viewport: string) =>
      ({
        layer: {root: {id}},
        viewport: {id: viewport},
        isPicking: true,
        renderPass: 'picking:query'
      }) as any;
    expect(filter(context('root-points', 'root'))).toBe(true);
    expect(filter(context('detail-points', 'root'))).toBe(false);
    expect(filter(context('root-points', 'detail'))).toBe(false);
    expect(filter(context('detail-points', 'detail'))).toBe(true);
    expect(filter(context('other-points', 'detail'))).toBe(false);
    expect(panelScene.layerFilter).toHaveBeenCalledTimes(1);
    expect(root.layerFilter).toHaveBeenCalledTimes(1);
    const params = {viewId: 'detail', viewState: {zoom: 1}, interactionState: {}} as any;
    deck.props.onViewStateChange!(params);
    expect(panelScene.onViewStateChange).toHaveBeenCalledWith(params);
    expect(root.onViewStateChange).not.toHaveBeenCalled();
    deck.props.onViewStateChange!({...params, viewId: 'root'});
    expect(root.onViewStateChange).toHaveBeenCalledTimes(1);
    registration.remove();
    await Promise.resolve();
    expect((deck.props.views as any[]).map(view => view.id)).toEqual(['root', 'other']);
    second.remove();
    await Promise.resolve();
    expect(deck.props.views).toBe(root.views);
    expect(deck.props.layerFilter).toBe(root.layerFilter);
    expect(deck.props._canvases).toBe(root._canvases);
    expect(deck.finalize).not.toHaveBeenCalled();
  });

  it('preserves panels during root updates and restores the latest root on removal', async () => {
    const deck = mockDeck();
    const setProps = deck.setProps;
    const registration = registerDeckPanel(deck, canvas('detail-canvas'), scene('detail'));
    await Promise.resolve();
    const layers = scene('new-root').layers;
    const callback = vi.fn();
    setDeckPropsWithPanels(deck, {layers, onViewStateChange: callback, pickingRadius: 7});
    expect(deck.props.pickingRadius).toBe(7);
    expect((deck.props.layers as any[]).flat().map(layer => layer.id)).toEqual([
      'new-root-points',
      'detail-points'
    ]);
    registration.update({...scene('detail'), viewState: {zoom: 5}});
    await Promise.resolve();
    expect((deck.props.views as any[])[1].props.viewState).toEqual({zoom: 5});
    registration.remove();
    await Promise.resolve();
    expect(deck.props.layers).toBe(layers);
    expect(deck.props.onViewStateChange).toBe(callback);
    expect(deck.setProps).toBe(setProps);
    setDeckPropsWithPanels(deck, {pickingRadius: 9});
    expect(deck.props.pickingRadius).toBe(9);
  });

  it('rejects unsupported roots and colliding ids without changing the active scene', async () => {
    const deck = mockDeck();
    const element = canvas('detail-canvas');
    expect(() =>
      registerDeckPanel({...deck, isInitialized: false} as Deck<any>, element, scene('detail'))
    ).toThrow('initialized');
    expect(() =>
      registerDeckPanel({...deck, props: {}} as Deck<any>, element, scene('detail'))
    ).toThrow('_canvases');
    expect(() => registerDeckPanel(deck, element, scene('root'))).toThrow('view ids');
    const registration = registerDeckPanel(deck, element, scene('detail'));
    await Promise.resolve();
    const views = deck.props.views;
    expect(() => registration.update({...scene('detail'), layers: scene('root').layers})).toThrow(
      'layer ids'
    );
    expect(() =>
      setDeckPropsWithPanels(deck, {views: [new OrthographicView({id: 'detail'})]})
    ).toThrow('view ids');
    expect(deck.props.views).toBe(views);
    registration.remove();
    await Promise.resolve();
  });

  it('does not recreate presentation targets while Deck is finalizing', async () => {
    const deck = mockDeck();
    const registration = registerDeckPanel(deck, canvas('detail-canvas'), scene('detail'));
    await Promise.resolve();
    vi.mocked(deck.setProps).mockClear();
    Object.defineProperty(deck, 'isInitialized', {value: false});
    registration.remove();
    await Promise.resolve();
    expect(deck.setProps).not.toHaveBeenCalled();
  });
});

it('remounts within one transaction without treating outgoing panel props as root props', async () => {
  const deck = mockDeck();
  const first = registerDeckPanel(deck, canvas('first'), scene('detail'));
  await Promise.resolve();
  first.remove();
  const next = registerDeckPanel(deck, canvas('next'), scene('detail'));
  await Promise.resolve();
  expect((deck.props.views as any[]).map(view => view.id)).toEqual(['root', 'detail']);
  expect(deck.props._canvases).toHaveLength(2);
  next.remove();
  // A root update before the queued restoration must survive that restoration.
  const layers = scene('latest-root').layers;
  setDeckPropsWithPanels(deck, {layers});
  await Promise.resolve();
  expect(deck.props.layers).toBe(layers);
  expect((deck.props.views as any[]).map(view => view.id)).toEqual(['root']);
});

it('does not add an implicit root view when an empty-canvas Deck mounts a panel', async () => {
  const deck = mockDeck();
  deck.props._canvases = [];
  deck.props.views = null;
  deck.props.layers = [];
  const panel = registerDeckPanel(deck, canvas('only-panel'), scene('detail'));
  await Promise.resolve();
  expect((deck.props.views as any[]).map(view => view.id)).toEqual(['detail']);
  panel.remove();
  await Promise.resolve();
  expect(deck.props._canvases).toEqual([]);
  expect(deck.props.views).toBeNull();
});
