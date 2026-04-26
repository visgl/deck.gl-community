// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createRoot} from 'react-dom/client';
import {Example} from './example';

/**
 * Mounts the editable-layers 3D tiles example.
 */
export function mountEditableLayers3DTilesExample(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(<Example />);
  return () => {
    root.unmount();
  };
}
