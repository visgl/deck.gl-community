import {mountMapToStacksExample} from './src/app';
const cleanup = mountMapToStacksExample(document.getElementById('app')!);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
