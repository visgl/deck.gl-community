// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type DeckProps} from '@deck.gl/core';
import {SourceLayer} from '@deck.gl-community/layers/source-layers';
import {PMTilesLoaderWithParser} from '@loaders.gl/tiles/pmtiles';

const ARCHIVE_URL = new URL('./mount-whitney.pmtiles', import.meta.url).href;
const TILE_LOADERS = [PMTilesLoaderWithParser];

type MountOptions = Pick<
  DeckProps,
  'device' | 'initialViewState' | 'widgets' | 'onViewStateChange'
> & {
  onDeckInitialized?: (deck: Deck) => void;
};

/** Explore the USGS Mount Whitney raster tile archive with the same source API as loaders.gl. */
export function mountSourceLayersExample(container: HTMLDivElement, options: MountOptions = {}) {
  const label = document.createElement('output');
  label.textContent = 'Loading Mount Whitney…';
  Object.assign(label.style, {
    position: 'absolute',
    bottom: '12px',
    left: '12px',
    zIndex: '1',
    background: '#172328',
    color: 'white',
    padding: '6px 10px',
    borderRadius: '4px',
    font: '14px system-ui'
  });
  container.append(label);
  const deck = new Deck({
    parent: container,
    device: options.device,
    widgets: options.widgets,
    controller: true,
    initialViewState: options.initialViewState ?? {
      longitude: -118.2903,
      latitude: 36.577,
      zoom: 13.5,
      minZoom: 8,
      maxZoom: 15
    },
    onViewStateChange: options.onViewStateChange,
    layers: [
      new SourceLayer({
        id: 'mount-whitney',
        data: ARCHIVE_URL,
        loaders: TILE_LOADERS,
        sourceOptions: {core: {type: 'pmtiles'}},
        showTileBorders: false,
        onSourceLoad: ({sourceType}) => {
          label.textContent = `Mount Whitney · USGS · ${sourceType}`;
        },
        onSourceError: error => {
          label.textContent = error.message;
        }
      })
    ]
  });
  options.onDeckInitialized?.(deck);
  return () => {
    deck.finalize();
    label.remove();
  };
}
