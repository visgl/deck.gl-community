import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './app';

const container = document.body.appendChild(document.createElement('div'));
container.style.position = 'fixed';
container.style.top = '0';
container.style.left = '0';
container.style.width = '100vw';
container.style.height = '100vh';
container.style.margin = '0';

const root = createRoot(container);
root.render(<App />);
