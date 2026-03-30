// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {Example} from './example';

/**
 * Mounts the editable-layers editor example.
 */
export function mountEditableLayersEditorExample(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(<Example />);
  return () => {
    root.unmount();
  };
}
