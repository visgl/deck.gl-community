import {mountSourceLayersExample} from './app';

const container = document.querySelector<HTMLDivElement>('#app');
if (!container) throw new Error('Expected #app container');
const cleanup = mountSourceLayersExample(container);
import.meta.hot?.dispose(cleanup);
