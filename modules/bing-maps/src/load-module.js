/* global document, window */
import getDeckOverlay from './deck-overlay';

const BING_MAPS_API_URL = 'https://www.bing.com/api/maps/mapcontrol?callback=__loadBingMaps';

export default function loadModule(moduleNames) {
  return new Promise((resolve) => {
    // Callback
    window.__loadBingMaps = () => {
      /* global Microsoft */
      const namespace = Microsoft.Maps;
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

function awaitCallback(func, ...args) {
  return new Promise((resolve) => {
    func(...args, resolve);
  });
}
