import {mountGeospatialExample} from './src/app';
const cleanup = mountGeospatialExample(document.getElementById('app')!);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
