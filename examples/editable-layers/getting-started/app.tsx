// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';
import {createRoot} from 'react-dom/client';
import {Example} from './example';

/**
 * Mounts the editable-layers getting-started example.
 */
export function mountGettingStartedExample(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(<Example />);
  return () => {
    root.unmount();
    container.replaceChildren();
  };
}
