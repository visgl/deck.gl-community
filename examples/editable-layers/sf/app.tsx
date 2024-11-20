// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import {createRoot} from 'react-dom/client';

import Example from './example';

const container = document.createElement('div');

if (document.body) {
  document.body.style.margin = '0';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(<Example />);
}
