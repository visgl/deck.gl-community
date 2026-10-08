// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, Layer} from '@deck.gl/core';
import type {SolidPolygonLayer} from '@deck.gl/layers';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import {GraphLayer} from '@deck.gl-community/graph-layers';
import karateDot from '../../modules/graph-layers/test/data/__fixtures__/dot/karate.dot?raw';
import graphUrlExample from './examples/16-graph-url.json';
import {SkyboxLayer} from '@deck.gl-community/layers';
import {page} from 'vitest/browser';
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
    if (url === 'https://tiles.openfreemap.org/styles/positron') {
      return Response.json({
        version: 8,
        sources: {},
        layers: [{id: 'background', type: 'background', paint: {'background-color': '#e2e8f0'}}]
      });
    }
    if (url === graphUrlExample.layers[0].data) {
      return new Response(karateDot, {headers: {'content-type': 'text/vnd.graphviz'}});
    }
    if (cubemapUrls.has(url)) {
      return new Response(image, {headers: {'content-type': 'image/png'}});
    }
    throw new Error(`Unexpected gallery resource request: ${url}`);
  });
}

test('renders the gallery forward, backward, and across different view types', async () => {
  await page.viewport(1200, 850);
  await mockGalleryResources();
  const host = document.createElement('div');
  host.style.cssText = 'width:1200px;height:800px';
  document.body.append(host);
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const errors = vi.spyOn(Layer.prototype, 'raiseError');
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
  let deck = setProps.mock.contexts[0] as Deck;
  const canvasSelector = '.deckgl-playground-preview > canvas';
  const canvas = host.querySelector(canvasSelector);
  const errorOutput = host.querySelector<HTMLOutputElement>('[data-error]')!;

  const names = Object.keys(TEMPLATES);
  const selections = [
    ...names,
    ...[...names].reverse(),
    'skybox-first-person',
    'skybox-map',
    'skybox-globe',
    'skybox-map',
    'skybox-first-person',
    'skybox-globe',
    'infovis-blocks',
    'community-mix',
    'infovis-blocks'
  ];
  for (const name of selections) {
    const template = TEMPLATES[name];
    const configuration = typeof template === 'string' ? JSON.parse(template) : template;
    host.querySelector<HTMLButtonElement>(`[data-template="${name}"]`)!.click();
    deck = setProps.mock.contexts.at(-1) as Deck;
    await vi.waitFor(
      () => {
        expect(errorOutput.hidden, `${name}: ${errorOutput.textContent}`).toBe(true);
        const layers = deck.props.layers as Layer[];
        for (const definition of configuration.layers) {
          const layer = layers.find(candidate => candidate.id === definition.id);
          expect(layer?.isLoaded, `${name}: ${definition.id} loaded`).toBe(true);
        }
        // Include the automatically injected basemap as well as the document's own layers.
        for (const layer of layers) {
          if (layer instanceof GraphLayer && layer.id === 'karate-club') {
            expect(layer.state.graphEngine?.getNodes()).toHaveLength(8);
            expect(layer.state.graphEngine?.getEdges()).toHaveLength(12);
          }
          if (layer instanceof GraphLayer && layer.id === 'radial-graph') {
            const engine = layer.state.graphEngine!;
            expect(engine.getNodes()).toHaveLength(6);
            expect(engine.getEdges()).toHaveLength(6);
            const edgeLayers = layer
              .getSubLayers()
              .filter(child => (child.constructor as typeof Layer).layerName === 'EdgeLayer');
            expect(edgeLayers).toHaveLength(1);
            const renderedEdges = edgeLayers[0].state.typedEdgeData as Record<string, unknown[]>;
            expect(renderedEdges.line).toHaveLength(5);
            expect(renderedEdges['spline-curve']).toHaveLength(1);
            const positions = engine.getNodes().map(node => engine.getNodePosition(node)!);
            expect(positions.every(point => point.every(Number.isFinite))).toBe(true);
            expect(Math.max(...positions.map(point => Math.hypot(...point)))).toBeCloseTo(160);
          }
          if (layer instanceof SkyboxLayer) {
            expect(layer.state?.cubemapTexture?.isReady, `${name}: cubemap uploaded`).toBe(true);
          }
          if (layer instanceof BasemapLayer) {
            expect(layer.state?.resolvedStyle, `${name}: basemap style loaded`).toBeTruthy();
            const background = layer
              .getSubLayers()
              .find(candidate => candidate.id === `${layer.id}-background`) as
              | SolidPolygonLayer
              | undefined;
            const tessellator = background?.state?.polygonTesselator;
            expect(tessellator?.vertexCount, `${name}: background mesh`).toBeGreaterThan(0);
            // A flat map mesh can report loaded while rendering no globe at all.
            expect(tessellator?.opts.resolution, `${name}: projection tessellation`).toBe(
              deck.getViewports()[0].resolution
            );
          }
        }
      },
      {timeout: 30_000}
    );

    // Force a frame after async resources settle so draw-time failures reach the error banner.
    deck.redraw('gallery transition test');
    expect(
      errors.mock.calls.map(([error, context]) => `${context}: ${error.message}`),
      name
    ).toEqual([]);
    expect(errorOutput.hidden, `${name}: ${errorOutput.textContent}`).toBe(true);
    expect(host.querySelectorAll(canvasSelector), name).toHaveLength(1);
    expect(host.querySelector(canvasSelector), name).toBe(canvas);
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
