import {FullScreenComponent} from '../../src/components/full-screen-component';
const target = document.getElementById('target')!;
const component = new FullScreenComponent({
  target,
  style: {right: '8px', bottom: '8px'},
  onChange: mode => {
    target.dataset.mode = mode;
  },
  onError: error => {
    target.dataset.error = String(error);
  }
});
component.onRenderHTML(document.getElementById('control')!);
Object.assign(window, {
  originalCanvas: target.querySelector('canvas'),
  disposeFullscreen: () => component.onRemove()
});
