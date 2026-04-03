import {mountSkyboxMapViewExample} from './app';

const container = document.getElementById('app');

if (!container) {
  throw new Error('Expected #app container');
}

mountSkyboxMapViewExample(container);
