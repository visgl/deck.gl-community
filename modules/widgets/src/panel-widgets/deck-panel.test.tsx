/** @jsxImportSource preact */
import {afterEach, expect, it, vi} from 'vitest';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {Deck, OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {AccordionPanel, TabbedPanel} from '@deck.gl-community/panels';
import {DeckPanel} from './deck-panel';
import {BoxPanelWidget} from './panel-widget';
import {setDeckPropsWithPanels} from './deck-panel-scene';
import type {DeckProps} from '@deck.gl/core';

const roots: HTMLElement[] = [];
function host() {
  const element = document.createElement('div');
  element.style.cssText = 'width:200px;height:200px;position:relative';
  document.body.append(element);
  roots.push(element);
  return element;
}
function canvas(id: string) {
  const element = document.createElement('canvas');
  element.id = id;
  host().append(element);
  return element;
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

afterEach(async () => {
  for (const element of roots) {
    act(() => render(null, element));
    await Promise.resolve();
    element.remove();
  }
  roots.length = 0;
});

it('updates a mounted canvas and preserves scenes across tab activation', async () => {
  const deck = mockDeck();
  const first = new DeckPanel({id: 'first', deck, sceneProps: scene('first')});
  const second = new DeckPanel({
    id: 'second',
    deck,
    sceneProps: scene('second'),
    keepMounted: true
  });
  const tabs = new TabbedPanel({panels: [first, second], activePanelId: 'first'});
  const element = host();
  act(() => render(tabs.content, element));
  await Promise.resolve();
  const firstCanvas = element.querySelector('canvas');
  act(() => first.setProps({sceneProps: {...scene('first'), viewState: {zoom: 2}}, height: 180}));
  await Promise.resolve();
  expect(element.querySelector('canvas')).toBe(firstCanvas);
  expect(firstCanvas?.parentElement?.style.height).toBe('180px');
  act(() => tabs.setProps({activePanelId: 'second'}));
  await Promise.resolve();
  expect((deck.props.views as any[]).some(view => view.id === 'first')).toBe(true);
  expect(element.querySelector('canvas')).toBe(firstCanvas);
  act(() => tabs.setProps({activePanelId: 'first'}));
  await Promise.resolve();
  expect((deck.props.views as any[]).map(view => view.id)).toContain('second');
  act(() => render(null, element));
  await Promise.resolve();
  expect(deck.props._canvases).toHaveLength(1);
});

it('renders and picks independent scenes on a single real Deck and resizes the panel canvas', async () => {
  const rootCanvas = canvas('gpu-root');
  rootCanvas.style.cssText = 'width:200px;height:200px';
  const errors: Error[] = [];
  const points = (id: string, color: [number, number, number]) =>
    new ScatterplotLayer({
      id,
      data: [{position: [0, 0], name: id}],
      getPosition: (d: any) => d.position,
      getFillColor: color,
      getRadius: 40,
      radiusUnits: 'pixels',
      pickable: true
    });
  const deck = new Deck({
    _canvases: [rootCanvas],
    views: [new OrthographicView({id: 'root', canvasId: rootCanvas.id})],
    viewState: {root: {target: [0, 0, 0], zoom: 0}},
    layers: [points('red', [255, 0, 0])],
    onError: error => errors.push(error)
  });
  const element = host();
  try {
    await vi.waitFor(() => expect(deck.isInitialized).toBe(true));
    const panel = new DeckPanel({
      deck,
      height: 160,
      sceneProps: {
        ...scene('detail'),
        layers: [points('green', [0, 255, 0])]
      }
    });
    act(() => render(panel.content, element));
    await Promise.resolve();
    const panelCanvas = element.querySelector('canvas')!;
    await vi.waitFor(() => {
      deck.redraw('test');
      expect(deck.getViewports({x: 0, y: 0, canvasId: panelCanvas.id})[0]?.height).toBe(160);
      expect(deck.pickObject({x: 100, y: 80, canvasId: panelCanvas.id})?.object?.name).toBe(
        'green'
      );
      expect(deck.pickObject({x: 100, y: 100, canvasId: rootCanvas.id})?.object?.name).toBe('red');
    });
    act(() => panel.setProps({height: 120}));
    await Promise.resolve();
    await vi.waitFor(() =>
      expect(deck.getViewports({x: 0, y: 0, canvasId: panelCanvas.id})[0]?.height).toBe(120)
    );
    expect(deck.getCanvasContext('detail')).not.toBe(deck.getCanvasContext('root'));
    const sample = (source: HTMLCanvasElement) => {
      const output = document.createElement('canvas');
      output.width = source.width;
      output.height = source.height;
      const context = output.getContext('2d')!;
      context.drawImage(source, 0, 0);
      return Array.from(context.getImageData(output.width / 2, output.height / 2, 1, 1).data);
    };
    await vi.waitFor(() => {
      deck.redraw('test');
      expect(sample(rootCanvas)).toEqual([255, 0, 0, 255]);
      expect(sample(panelCanvas)).toEqual([0, 255, 0, 255]);
    });
    act(() => render(null, element));
    await Promise.resolve();
    expect(deck.props._canvases).toEqual([rootCanvas]);
    expect(deck.getViews().map(view => view.id)).toEqual(['root']);
    // Exercise registration within Deck's own widget reconciliation, including removal.
    setDeckPropsWithPanels(deck, {widgets: [new BoxPanelWidget({id: 'box', panel})]});
    await vi.waitFor(() =>
      expect(deck.getViews().map(view => view.id)).toEqual(['root', 'detail'])
    );
    setDeckPropsWithPanels(deck, {widgets: []});
    await vi.waitFor(() => expect(deck.getViews().map(view => view.id)).toEqual(['root']));
    setDeckPropsWithPanels(deck, {widgets: [new BoxPanelWidget({id: 'box', panel})]});
    await vi.waitFor(() => expect(deck.getViews()).toHaveLength(2));
    deck.finalize();
    await Promise.resolve();
    expect(deck.isInitialized).toBe(false);
    expect(deck.getCanvas()).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    act(() => render(null, element));
    await Promise.resolve();
    deck.finalize();
  }
}, 15000);

it('unregisters collapsed accordion scenes except when keepMounted is set', async () => {
  const deck = mockDeck();
  const first = new DeckPanel({id: 'first', deck, sceneProps: scene('first')});
  const second = new DeckPanel({
    id: 'second',
    deck,
    sceneProps: scene('second'),
    keepMounted: true
  });
  const accordion = new AccordionPanel({
    panels: [first, second],
    expandedPanelIds: ['first', 'second']
  });
  const element = host();
  act(() => render(accordion.content, element));
  await Promise.resolve();
  expect(deck.props._canvases).toHaveLength(3);
  act(() => accordion.setProps({expandedPanelIds: []}));
  await Promise.resolve();
  expect((deck.props.views as any[]).map(view => view.id)).toEqual(['root', 'second']);
  act(() => render(null, element));
  await Promise.resolve();
  expect(deck.props._canvases).toHaveLength(1);
});

it('shares a Deck with no root canvas across panels and survives removing every canvas', async () => {
  const errors: Error[] = [];
  const deck = new Deck({
    _canvases: [],
    views: [],
    layers: [],
    onError: error => errors.push(error)
  });
  const left = host();
  const right = host();
  try {
    await vi.waitFor(() => expect(deck.isInitialized).toBe(true));
    const makePanel = (id: string, color: [number, number, number]) =>
      new DeckPanel({
        id,
        deck,
        height: 200,
        sceneProps: {
          ...scene(id),
          layers: [
            new ScatterplotLayer({
              id: `${id}-points`,
              data: [{position: [0, 0], name: id}],
              getPosition: (d: any) => d.position,
              getFillColor: color,
              getRadius: 30,
              radiusUnits: 'pixels',
              pickable: true
            })
          ]
        }
      });
    const first = makePanel('left', [255, 0, 0]);
    const second = makePanel('right', [0, 255, 0]);
    act(() => {
      render(first.content, left);
      render(second.content, right);
    });
    await vi.waitFor(() => {
      deck.redraw('test');
      expect(deck.getViews().map(view => view.id)).toEqual(['left', 'right']);
      expect(
        deck.pickObject({x: 100, y: 100, canvasId: left.querySelector('canvas')!.id})?.object?.name
      ).toBe('left');
      expect(
        deck.pickObject({x: 100, y: 100, canvasId: right.querySelector('canvas')!.id})?.object?.name
      ).toBe('right');
    });
    act(() => {
      render(null, left);
      render(null, right);
    });
    await Promise.resolve();
    expect(deck.props._canvases).toEqual([]);
    expect(deck.getViews()).toEqual([]);
    deck.redraw('empty');
    act(() => render(second.content, right));
    await vi.waitFor(() => {
      deck.redraw('remounted');
      expect(
        deck.pickObject({x: 100, y: 100, canvasId: right.querySelector('canvas')!.id})?.object?.name
      ).toBe('right');
    });
    expect(errors).toEqual([]);
  } finally {
    act(() => {
      render(null, left);
      render(null, right);
    });
    deck.finalize();
  }
}, 15000);
