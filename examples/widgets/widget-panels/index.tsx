// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mountWidgetPanelsExample} from './app';

const container = document.getElementById('app');
if (!(container instanceof HTMLElement)) {
  throw new Error('Unable to find #app container');
}

document.documentElement.style.height = '100%';
document.body.style.margin = '0';
document.body.style.height = '100%';
container.style.width = '100vw';
container.style.height = '100vh';

mountWidgetPanelsExample(container);
