// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mountHtmlOverlaysExample} from './app';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Unable to find #app container');
}

document.body.style.margin = '0';
container.style.width = '100vw';
container.style.height = '100vh';

mountHtmlOverlaysExample(container);
