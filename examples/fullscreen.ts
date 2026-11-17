// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {FullScreenComponent} from '@deck.gl-community/panels';

// A sibling of the application's mount root survives scene replacement and device switches.
const controls = document.createElement('div');
controls.setAttribute('data-example-fullscreen-control', '');
document.body.append(controls);
const fullscreen = new FullScreenComponent({
  target: document.body,
  style: {
    position: 'fixed',
    right: 'max(12px, env(safe-area-inset-right))',
    bottom: 'max(12px, env(safe-area-inset-bottom))',
    zIndex: '2147483646'
  }
});
fullscreen.onRenderHTML(controls);
import.meta.hot?.dispose(() => {
  fullscreen.onRemove();
  controls.remove();
});
