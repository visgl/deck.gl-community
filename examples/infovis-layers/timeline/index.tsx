// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './app';

const root = createRoot(document.getElementById('app')!);
root.render(<App />);