// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import * as ReactDOM from 'react-dom';

import ExampleNoMap from './example-no-map';

const root = document.createElement('div');

if (document.body) {
  document.body.style.margin = '0';

  document.body.appendChild(root);
  ReactDOM.render(<ExampleNoMap />, root);
}
