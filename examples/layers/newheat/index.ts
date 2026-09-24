import {mountNewHeatExample} from './app';

const container = document.getElementById('app');
if (!container) throw new Error('Expected #app container');
const cleanup = mountNewHeatExample(container);
import.meta.hot?.dispose(cleanup);
