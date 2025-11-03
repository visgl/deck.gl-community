import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../graph-viewer/app';

const container = document.body.appendChild(document.createElement('div'));
container.style.margin = '0';
container.style.height = '100vh';
container.style.width = '100vw';

createRoot(container).render(<App />);
