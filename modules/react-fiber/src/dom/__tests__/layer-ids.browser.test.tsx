import {type Deck, type Layer, log} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {act, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, expect, test, vi} from 'vitest';

import {DeckGL} from '../index';

const webglTest = navigator.userAgent.includes('jsdom') ? test.skip : test;

/** Counts how often deck.gl initializes and finalizes layers of this class. */
const lifecycle = {finalized: 0, initialized: 0};

class CountingLayer extends ScatterplotLayer<[number, number]> {
  static layerName = 'CountingLayer';

  initializeState() {
    lifecycle.initialized++;
    super.initializeState();
  }

  finalizeState(context: Parameters<ScatterplotLayer['finalizeState']>[0]) {
    lifecycle.finalized++;
    super.finalizeState(context);
  }
}

/** A layer with no `id`, so deck.gl gives it the default, its class's `layerName`. */
function createLayer(radius: number) {
  return new CountingLayer({data: [[0, 0]], getPosition: d => d, getRadius: radius});
}

function Points({radius}: {radius: number}) {
  return <deckLayer layer={createLayer(radius)} />;
}

/** Three ways to render two layers that have no `id`. */
const LAYOUTS: Record<string, (radius: number) => ReactNode> = {
  'two <deckLayer> siblings': radius => (
    <>
      <deckLayer layer={createLayer(radius)} />
      <deckLayer layer={createLayer(radius)} />
    </>
  ),
  'keyed <deckLayer> elements from an array': radius =>
    ['a', 'b'].map(key => <deckLayer key={key} layer={createLayer(radius)} />),
  'a keyed component per layer': radius => (
    <>
      <Points key="a" radius={radius} />
      <Points key="b" radius={radius} />
    </>
  )
};

async function waitFor(condition: () => boolean): Promise<void> {
  for (let frame = 0; frame < 120 && !condition(); frame++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  expect(condition()).toBe(true);
}

/** The layers deck.gl has matched, which can lag `deck.props.layers` by a frame. */
function getLayers(deck: Deck | null): Layer[] {
  const layerManager = (deck as unknown as {layerManager?: {getLayers(): Layer[]}} | null)
    ?.layerManager;
  return layerManager?.getLayers() ?? [];
}

function getLayerIds(deck: Deck | null): string[] {
  return getLayers(deck).map(layer => layer.id);
}

afterEach(() => {
  vi.restoreAllMocks();
  lifecycle.finalized = 0;
  lifecycle.initialized = 0;
});

webglTest.each(Object.keys(LAYOUTS))(
  'layers without an id collide on the default id, whatever their keys: %s',
  async layout => {
    const container = document.createElement('div');
    Object.assign(container.style, {height: '300px', position: 'relative', width: '400px'});
    document.body.append(container);
    const reactRoot = createRoot(container);
    const warnSpy = vi.spyOn(log, 'warn');
    let deck: Deck | null = null;

    const render = (radius: number) =>
      reactRoot.render(
        <DeckGL
          initialViewState={{latitude: 0, longitude: 0, zoom: 1}}
          onDeckChange={instance => {
            deck = instance as Deck | null;
          }}
        >
          {LAYOUTS[layout](radius)}
        </DeckGL>
      );
    const warnings = () => warnSpy.mock.calls.map(([message]) => String(message));

    try {
      await act(async () => render(1e5));
      await waitFor(() => getLayerIds(deck).length === 2);

      // Both layers draw, under one id. React keys do not reach the layer.
      expect(getLayerIds(deck)).toEqual(['CountingLayer', 'CountingLayer']);
      expect(warnings()).toContain('Multiple new layers with same id CountingLayer');
      // The reconciler's own warning only knows about the id 'unknown', so it stays silent.
      expect(warnings().some(message => message.includes('needs a stable id'))).toBe(false);
      expect(lifecycle).toEqual({finalized: 0, initialized: 2});

      for (const radius of [2e5, 3e5, 4e5]) {
        await act(async () => render(radius));
        await waitFor(() =>
          getLayers(deck).every(layer => (layer.props as {getRadius: number}).getRadius === radius)
        );
      }

      // On every update the second layer has no old layer to match, so deck.gl initializes it
      // again from scratch, and never finalizes the one it replaced.
      expect(getLayerIds(deck)).toEqual(['CountingLayer', 'CountingLayer']);
      expect(warnings()).toContain('Multiple old layers with same id CountingLayer');
      expect(lifecycle).toEqual({finalized: 0, initialized: 5});
    } finally {
      act(() => reactRoot.unmount());
      container.remove();
    }
  }
);
