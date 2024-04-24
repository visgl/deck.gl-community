// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import getDeckOverlay from './deck-overlay';

const BING_MAPS_API_URL = 'https://www.bing.com/api/maps/mapcontrol?callback=__loadBingMaps';

declare global {
  interface Window {
    __loadBingMaps: (() => void) | undefined;
    Microsoft: {Maps: any};
  }
}

export default function loadModule(moduleNames?: string[]) {
  return new Promise((resolve) => {
    // Callback
    window.__loadBingMaps = () => {
      const namespace: any = window.Microsoft.Maps;
      namespace.DeckOverlay = getDeckOverlay(namespace);
      delete window.__loadBingMaps;

      if (moduleNames) {
        Promise.all(moduleNames.map((m) => awaitCallback(namespace.loadModule, m))).then(() =>
          resolve(namespace)
        );
      } else {
        resolve(namespace);
      }
    };

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = BING_MAPS_API_URL;
    const head = document.querySelector('head');
    head.appendChild(script);
  });
}

function awaitCallback(func: Function, ...args: unknown[]) {
  return new Promise((resolve) => {
    func(...args, resolve);
  });
}
