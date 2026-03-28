// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import {createRoot} from 'react-dom/client';

import {Example} from './index';

/**
 * Mounts the editable H3 cluster example.
 */
export function mountEditableH3ClusterLayerExample(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(<Example />);
  return () => {
    root.unmount();
    container.replaceChildren();
  };
}
