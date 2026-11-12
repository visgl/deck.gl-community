// @vitest-environment jsdom
// A .ts file, so the headless browser project, which runs .tsx tests, skips it: the test root
// has no WebGL canvas.
import {LightingEffect, MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {act, createElement, createRef, Fragment} from 'react';
import {afterEach, describe, expect, it} from 'vitest';

import {roots, unmountAtNode} from '../../reconciler/index';
import {createTestRoot} from '../../reconciler/__tests__/test-renderer';
import {TestWidget} from '../../reconciler/__tests__/test-widget';
import {createDeckGL, DeckGL} from '../index';
import {DeckGL as MapboxDeckGL} from '../mapbox';
import {DeckGL as MapLibreDeckGL} from '../maplibre';

describe('DeckGL element components', () => {
  afterEach(() => {
    for (const node of [...roots.keys()]) {
      unmountAtNode(node);
    }
  });

  it('are the same components on every root', () => {
    const CustomDeckGL = createDeckGL({createExternalOverlay: () => ({}) as never});
    for (const root of [MapboxDeckGL, MapLibreDeckGL, CustomDeckGL]) {
      expect(root.Layer).toBe(DeckGL.Layer);
      expect(root.View).toBe(DeckGL.View);
      expect(root.Widget).toBe(DeckGL.Widget);
      expect(root.Effect).toBe(DeckGL.Effect);
    }
    expect(DeckGL.Layer.displayName).toBe('DeckGL.Layer');
  });

  it('render the native elements, with refs to their instances', async () => {
    const {root, deck} = createTestRoot();
    const view = new MapView({id: 'main'});
    const layer = new ScatterplotLayer({data: [], id: 'points'});
    const widget = new TestWidget({id: 'widget'});
    const effect = new LightingEffect();
    const layerRef = createRef<ScatterplotLayer>();
    const viewRef = createRef<MapView>();

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(
            DeckGL.View,
            {ref: viewRef, view},
            createElement(DeckGL.Layer, {layer, ref: layerRef})
          ),
          createElement(DeckGL.Widget, {widget}),
          createElement(DeckGL.Effect, {effect})
        )
      );
    });

    expect(deck.views).toStrictEqual([view]);
    expect(deck.layers).toStrictEqual([layer]);
    expect(deck.widgets).toStrictEqual([widget]);
    expect(deck.effects).toStrictEqual([effect]);
    expect(layerRef.current).toBe(layer);
    expect(viewRef.current).toBe(view);
  });

  it('mix with the native elements', async () => {
    const {root, deck} = createTestRoot();

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement('deckLayer', {layer: new ScatterplotLayer({data: [], id: 'a'})}),
          createElement(DeckGL.Layer, {layer: new ScatterplotLayer({data: [], id: 'b'})})
        )
      );
    });

    expect(deck.getLayerIds()).toStrictEqual(['a', 'b']);
  });
});
