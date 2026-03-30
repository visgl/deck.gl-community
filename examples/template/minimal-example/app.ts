// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {add} from '@deck.gl-community/template';

/**
 * Mounts the minimal example into a supplied container.
 */
export function mountMinimalExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  rootElement.style.display = 'grid';
  rootElement.style.placeItems = 'center';
  rootElement.style.width = '100%';
  rootElement.style.height = '100%';
  rootElement.style.fontFamily = 'sans-serif';
  rootElement.style.fontSize = '20px';
  rootElement.textContent = `1 + 2 = ${add(1, 2)}`;

  container.replaceChildren(rootElement);

  return () => {
    rootElement.remove();
    container.replaceChildren();
  };
}
