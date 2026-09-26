// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type Layer} from '@deck.gl/core';
import {SkyboxLayer} from '@deck.gl-community/layers';
import {afterEach, expect, test, vi} from 'vitest';
import {mountStandalonePlayground} from './standalone';
import {TEMPLATES} from './templates';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

// Exercise the real layers and resource loaders without depending on remote tile/image services.
async function mockGalleryResources(): Promise<void> {
  const face = document.createElement('canvas');
  face.width = face.height = 2;
  const context = face.getContext('2d')!;
  context.fillStyle = '#124678';
  context.fillRect(0, 0, 2, 2);
  const image = await new Promise<Blob>(resolve => face.toBlob(blob => resolve(blob!)));
  const cubemapUrls = new Set<string>();
  for (const template of Object.values(TEMPLATES)) {
    const configuration = typeof template === 'string' ? JSON.parse(template) : template;
    for (const layer of configuration.layers) {
      if (layer['@@type'] === 'SkyboxLayer') {
        for (const url of Object.values(layer.cubemap.faces)) cubemapUrls.add(url as string);
      }
    }
  }
  const fetchLocalResource = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('data:') || url.startsWith('blob:')) return fetchLocalResource(input, init);
    if (url === 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json') {
      return Response.json({
        version: 8,
        sources: {},
        layers: [{id: 'background', type: 'background', paint: {'background-color': '#e2e8f0'}}]
      });
    }
    if (cubemapUrls.has(url)) {
      return new Response(image, {headers: {'content-type': 'image/png'}});
    }
    throw new Error(`Unexpected gallery resource request: ${url}`);
  });
}

test('renders every gallery example when selected in sequence', async () => {
  await mockGalleryResources();
  const host = document.createElement('div');
  host.style.cssText = 'width:1200px;height:800px';
  document.body.append(host);
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const unmount = mountStandalonePlayground(host, {enableTools: false});
  cleanup = () => {
    unmount();
    host.remove();
  };

  const tabs = host.querySelector('[data-panel-tabs]')!;
  Array.from(tabs.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent === 'Examples')!
    .click();
  await vi.waitFor(() => expect(setProps.mock.contexts.length).toBeGreaterThan(0));
  const deck = setProps.mock.contexts[0] as Deck;
  const canvas = host.querySelector('canvas');
  const errorOutput = host.querySelector<HTMLOutputElement>('[data-error]')!;

  for (const [name, template] of Object.entries(TEMPLATES)) {
    const configuration = typeof template === 'string' ? JSON.parse(template) : template;
    host.querySelector<HTMLButtonElement>(`[data-template="${name}"]`)!.click();
    await vi.waitFor(
      () => {
        expect(errorOutput.hidden, `${name}: ${errorOutput.textContent}`).toBe(true);
        const layers = deck.props.layers as Layer[];
        for (const definition of configuration.layers) {
          const layer = layers.find(candidate => candidate.id === definition.id);
          expect(layer?.isLoaded, `${name}: ${definition.id} loaded`).toBe(true);
          if (layer instanceof SkyboxLayer) {
            expect(layer.state?.cubemapTexture?.isReady, `${name}: cubemap uploaded`).toBe(true);
          }
        }
      },
      {timeout: 30_000}
    );

    // Force a frame after async resources settle so draw-time failures reach the error banner.
    deck.redraw(true);
    expect(errorOutput.hidden, `${name}: ${errorOutput.textContent}`).toBe(true);
    expect(host.querySelector('canvas'), name).toBe(canvas);
    const viewport = deck.getViewports()[0];
    for (const property of ['longitude', 'latitude', 'zoom'] as const) {
      if (property in configuration.initialViewState) {
        expect(viewport[property], `${name}: ${property}`).toEqual(
          configuration.initialViewState[property]
        );
      }
    }
  }
}, 180_000);
