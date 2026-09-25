import {mountFlameTrailExample} from './app';

const container = document.getElementById('app');
if (!container) throw new Error('Expected #app container');
const cleanup = mountFlameTrailExample(container);
import.meta.hot?.dispose(cleanup);
