// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import '@deck.gl-community/trace-layers';

/**
 * Mounts the Tracevis placeholder example into a supplied container.
 */
export function mountTracevisExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('main');
  rootElement.style.display = 'grid';
  rootElement.style.placeItems = 'center';
  rootElement.style.width = '100%';
  rootElement.style.height = '100%';
  rootElement.style.background = '#f8fafc';
  rootElement.style.color = '#0f172a';
  rootElement.style.fontFamily = 'system-ui, sans-serif';

  const contentElement = container.ownerDocument.createElement('section');
  contentElement.style.width = 'min(560px, calc(100vw - 32px))';
  contentElement.style.padding = '24px';
  contentElement.style.border = '1px solid #cbd5e1';
  contentElement.style.borderRadius = '8px';
  contentElement.style.background = '#ffffff';

  const titleElement = container.ownerDocument.createElement('h1');
  titleElement.style.margin = '0 0 8px';
  titleElement.style.fontSize = '24px';
  titleElement.textContent = 'Tracevis';

  const messageElement = container.ownerDocument.createElement('p');
  messageElement.style.margin = '0';
  messageElement.style.lineHeight = '1.5';
  messageElement.textContent =
    'The @deck.gl-community/trace-layers workspace is wired at its final package and example paths. The real Tracevis demo will land in follow-up work.';

  contentElement.append(titleElement, messageElement);
  rootElement.append(contentElement);
  container.replaceChildren(rootElement);

  return () => {
    rootElement.remove();
    container.replaceChildren();
  };
}
