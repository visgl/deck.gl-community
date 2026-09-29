import {BitmapLayer} from '@deck.gl/layers';
import type {MapLibreOverlay} from '@deck.gl/maplibre';
import {Map as MapLibreMap} from 'maplibre-gl';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {expect, test, vi} from 'vitest';

import {DeckGL} from '../maplibre';

const webglTest = navigator.userAgent.includes('jsdom') ? test.skip : test;

function waitForMapLoad(map: MapLibreMap): Promise<void> {
  return new Promise(resolve => map.once('load', resolve));
}

function getDeck(overlay: MapLibreOverlay) {
  return (
    overlay as unknown as {
      _deck?: {isInitialized: boolean; props: {layers: unknown[]; viewState: {zoom: number}}};
    }
  )._deck;
}

webglTest(
  'MapLibre v6 provider root attaches, orders, and cleans up an interleaved control',
  async () => {
    const container = document.createElement('div');
    Object.assign(container.style, {height: '300px', width: '400px'});
    Object.defineProperties(container, {
      clientHeight: {value: 300},
      clientWidth: {value: 400}
    });
    document.body.append(container);

    const image = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const onDeckglChange = vi.fn();
    const reactRoot = createRoot(container);
    let overlay: MapLibreOverlay | null = null;
    const layer = new BitmapLayer({
      beforeId: 'labels',
      bounds: [-122.46, 37.77, -122.44, 37.79],
      id: 'points',
      image,
      pickable: true
    });

    try {
      await act(async () => {
        reactRoot.render(
          <DeckGL
            interleaved
            onDeckglChange={deckgl => {
              overlay = deckgl;
              onDeckglChange(deckgl);
            }}
          >
            <layer layer={layer} />
          </DeckGL>
        );
      });

      if (!overlay) {
        throw new Error('Expected the provider root to create a MapLibreOverlay');
      }
      const mapOverlay = overlay;
      expect(container.childElementCount).toBe(0);

      const map = new MapLibreMap({
        attributionControl: false,
        canvasContextAttributes: {antialias: true},
        center: [-122.45, 37.78],
        container,
        pixelRatio: window.devicePixelRatio,
        style: {layers: [{id: 'labels', type: 'background'}], sources: {}, version: 8},
        zoom: 14
      });
      await waitForMapLoad(map);

      map.addControl(overlay);
      map.triggerRepaint();

      await vi.waitFor(() => {
        expect(map.getLayersOrder()).toEqual(['deck-maplibre-layer-group-before:labels', 'labels']);
        expect(getDeck(mapOverlay)?.isInitialized).toBe(true);
      });
      expect(mapOverlay.getCanvas()).toBe(map.getCanvas());

      map.jumpTo({center: [-122.4, 37.8], zoom: 12});
      map.triggerRepaint();
      await vi.waitFor(() => expect(getDeck(mapOverlay)?.props.viewState.zoom).toBe(12));

      const updatedLayer = new BitmapLayer({
        beforeId: 'labels',
        bounds: [-122.46, 37.77, -122.44, 37.79],
        id: 'updated-points',
        image,
        pickable: true
      });
      await act(async () => {
        reactRoot.render(
          <DeckGL interleaved onDeckglChange={onDeckglChange}>
            <layer layer={updatedLayer} />
          </DeckGL>
        );
      });
      await vi.waitFor(() => {
        expect(getDeck(mapOverlay)?.props.layers).toContain(updatedLayer);
      });

      map.removeControl(mapOverlay);
      expect(mapOverlay.getCanvas()).toBeNull();
      map.remove();

      await act(async () => reactRoot.unmount());
      expect(onDeckglChange).toHaveBeenLastCalledWith(null);
    } finally {
      reactRoot.unmount();
      container.remove();
    }
  }
);
