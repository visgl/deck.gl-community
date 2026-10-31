import {mountDeckPanelExample} from './app';

const container = document.getElementById('app')!;
document.body.style.cssText = 'margin:0;height:100vh';
container.style.height = '100%';
const cleanup = mountDeckPanelExample(container);
window.addEventListener('pagehide', cleanup, {once: true});
