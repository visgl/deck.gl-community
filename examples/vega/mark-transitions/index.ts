import {mountMarkTransitionsExample} from './src/app';
const cleanup = mountMarkTransitionsExample(document.getElementById('app')!);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
