// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MapboxOverlay} from '@deck.gl/mapbox';
import maplibregl from 'maplibre-gl';
import {h} from 'preact';

import {
  BoxWidget,
  HtmlOverlayItem,
  HtmlOverlayWidget,
  MarkdownPanel,
  type HtmlOverlayWidgetProps
} from '@deck.gl-community/widgets';
import {INITIAL_COORDS, INITIAL_VIEW_STATE} from './constants';
import type {WikipediaEntry} from './types';

import '@deck.gl/widgets/stylesheet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

type WikipediaPage = WikipediaEntry & {
  title?: string;
};

type WikipediaApiResponse = {
  query?: {
    pages: Record<string, WikipediaPage>;
  };
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%'
} as const;

const MAP_CONTAINER_STYLE = {
  position: 'absolute',
  inset: '0'
} as const;

export function mountOverlaysExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_CONTAINER_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const overlayWidget = new HtmlOverlayWidget<HtmlOverlayWidgetProps>({id: 'wikipedia-overlay'});
  const infoWidget = new BoxWidget({
    id: 'wikipedia-overlays-info',
    placement: 'top-right',
    widthPx: 320,
    title: 'Overlays',
    collapsible: false,
    panel: new MarkdownPanel({
      id: 'summary',
      title: '',
      markdown: [
        'This example uses `HtmlOverlayWidget` to pin Wikipedia thumbnails directly over nearby locations.',
        '',
        '- Source: **Wikipedia geosearch API**',
        '- Overlay: **thumbnail image markers**',
        '- Interaction: **pan and zoom to keep DOM elements anchored**'
      ].join('\n')
    })
  });
  const deckOverlay = new MapboxOverlay({
    interleaved: false,
    widgets: [overlayWidget, infoWidget]
  });

  const map = new maplibregl.Map({
    container: mapElement,
    style: MAP_STYLE,
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    zoom: INITIAL_VIEW_STATE.zoom,
    pitch: INITIAL_VIEW_STATE.pitch,
    bearing: INITIAL_VIEW_STATE.bearing
  });
  map.addControl(deckOverlay);

  let isDisposed = false;

  getWikipediaEntriesNearby({lon: INITIAL_COORDS.lon, lat: INITIAL_COORDS.lat})
    .then((response) => {
      if (isDisposed) {
        return;
      }

      const pages = response.query?.pages ?? {};
      const data = Object.values(pages).filter((page) => page.thumbnail?.source);
      overlayWidget.setProps({
        items: data.map((entry) =>
          h(
            HtmlOverlayItem,
            {
              key: entry.pageid,
              coordinates: [entry.coordinates[0].lon, entry.coordinates[0].lat]
            },
            h('img', {
              src: entry.thumbnail.source,
              alt: entry.title ?? 'Wikipedia location',
              style: {
                display: 'block',
                width: '50px',
                height: '50px',
                borderRadius: '8px',
                objectFit: 'cover',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)'
              }
            })
          )
        )
      });
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Failed to load Wikipedia overlay data', error);
    });

  return () => {
    isDisposed = true;
    map.removeControl(deckOverlay);
    deckOverlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };
}

async function getWikipediaEntriesNearby({lon, lat}: {lon: number; lat: number}): Promise<WikipediaApiResponse> {
  const url = `https://en.wikipedia.org/w/api.php?origin=*&action=query&generator=geosearch&ggscoord=${lat}%7C${lon}&format=json&prop=coordinates|pageimages`;
  const response = await fetch(url);

  if (response.ok) {
    return (await response.json()) as WikipediaApiResponse;
  }

  // eslint-disable-next-line no-console
  console.error(`HTTP Error: ${response.status}`);
  return {query: {pages: {}}};
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
