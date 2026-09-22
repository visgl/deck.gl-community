// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {DeckPlayground} from '@deck.gl-community/playground';
import {createPlaygroundRegistry} from './registry';
import {TEMPLATES} from './templates';

/** Mounts the community gallery with the same layer catalog as the standalone app. */
export function mountPlaygroundExample(container: HTMLElement): () => void {
  const playground = new DeckPlayground({
    parentElement: container,
    templates: TEMPLATES,
    registry: createPlaygroundRegistry()
  });
  return () => playground.finalize();
}
