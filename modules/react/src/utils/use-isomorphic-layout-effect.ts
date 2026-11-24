// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useLayoutEffect} from 'react';

const isBrowserEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * `useLayoutEffect` when a DOM is available, and a no-op during server rendering.
 *
 * Avoids React's server-rendering warning for layout effects. `DeckCanvas` only touches
 * the DOM from effects, so skipping them on the server is safe.
 */
export const useIsomorphicLayoutEffect: typeof useLayoutEffect = isBrowserEnvironment
  ? useLayoutEffect
  : () => {};
