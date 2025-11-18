import React from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './example';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Unable to find #app container');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
