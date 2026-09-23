// deck.gl-community
// SPDX-License-Identifier: MIT
import {Deck, type Layer} from '@deck.gl/core';
import {JunctionScatterplotLayer} from '@deck.gl-community/editable-layers';
import {afterEach, expect, test, vi} from 'vitest';
import {mountPlaygroundExample} from './app';
import {mountStandalonePlayground} from './standalone';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

test('gallery and standalone hosts render a registered community layer in the same canvas', async () => {
  const {editor} = await import('monaco-editor');
  for (const mount of [mountPlaygroundExample, mountStandalonePlayground]) {
    const host = document.createElement('div');
    host.style.cssText = 'width:800px;height:500px;position:relative';
    document.body.append(host);
    cleanups.push(() => host.remove());
    const originalModels = new Set(editor.getModels());
    const setProps = vi.spyOn(Deck.prototype, 'setProps');
    const unmount = mount(host, {enableTools: false});
    cleanups.push(unmount);
    await vi.waitFor(() => expect(setProps.mock.contexts.length).toBeGreaterThan(0), {
      timeout: 10_000
    });
    const deck = setProps.mock.contexts[0] as Deck;
    const onError = vi.fn();
    deck.setProps({onError});
    await vi.waitFor(
      () => {
        expect(editor.getModels().filter(model => !originalModels.has(model))).toHaveLength(1);
      },
      {timeout: 10_000}
    );
    const model = editor.getModels().find(model => !originalModels.has(model))!;
    const canvas = host.querySelector('canvas');
    model.setValue(
      JSON.stringify({
        views: {'@@type': 'OrthographicView'},
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: [
          {
            id: 'junctions',
            '@@type': 'JunctionScatterplotLayer',
            data: [{position: [0, 0], label: '@@#ordinary-row-text'}],
            getPosition: '@@=position',
            getRadius: 18,
            getInnerRadius: 8,
            getFillColor: [10, 120, 200],
            getStrokeColor: [255, 255, 255],
            radiusUnits: 'pixels',
            coordinateSystem: 0
          }
        ]
      })
    );
    await vi.waitFor(
      () => {
        const layer = (deck.props.layers as Layer[])[0];
        expect(layer).toBeInstanceOf(JunctionScatterplotLayer);
        const sublayers = (layer as JunctionScatterplotLayer).getSubLayers();
        expect(sublayers).toHaveLength(2);
        expect(sublayers.every(sublayer => sublayer.isLoaded)).toBe(true);
        expect(sublayers.every(sublayer => sublayer.state.model)).toBe(true);
      },
      {timeout: 10_000}
    );
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(onError).not.toHaveBeenCalled();
    unmount();
    cleanups.pop();
    expect(canvas?.isConnected).toBe(false);
    expect(editor.getModels().filter(model => !originalModels.has(model))).toHaveLength(0);
    setProps.mockRestore();
  }
}, 30_000);
