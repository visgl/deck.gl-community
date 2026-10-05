// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {DeckPlayground} from '@deck.gl-community/playground';
import {createPlaygroundRegistry} from './registry';
import {TEMPLATES} from './templates';
import {createEditablePlaygroundControls} from './editable-controls';

/** Mounts the community gallery with the same layer catalog as the standalone app. */
export function mountPlaygroundExample(container: HTMLElement): () => void {
  const editing = createEditablePlaygroundControls();
  const playground = new DeckPlayground({
    parentElement: container,
    templates: TEMPLATES,
    registry: createPlaygroundRegistry(editing.constants),
    onChange: editing.onChange,
    onError(error) {
      editing.suspend();
      console.error(error);
    }
  });
  editing.connect(playground);
  return () => playground.finalize();
}
