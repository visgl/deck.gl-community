// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createRoot} from 'react-dom/client';

import {App} from './tracevis-app';
import '@deck.gl/widgets/stylesheet.css';
// @ts-expect-error TypeScript does not resolve Vite CSS side-effect imports.
import './styles.css';

/** Mounts the Tracevis example into a supplied container. */
export function mountTracevisExample(container: HTMLElement): () => void {
  const root = createRoot(container);

  root.render(
    <div className="tracevis-example-root h-full w-full font-sans">
      <App />
    </div>
  );

  return () => {
    root.unmount();
    container.replaceChildren();
  };
}
