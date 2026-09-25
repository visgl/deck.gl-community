import type {OrbitViewState} from '@deck.gl/core';
import {DeviceManagerController, DeviceTabsWidget} from '@deck.gl-community/widgets';
import {mountFlameTrailExample} from './app';

const container = document.getElementById('app');
if (!container) throw new Error('Expected #app container');
const manager = new DeviceManagerController();
let cleanup: (() => void) | undefined;
let currentView: OrbitViewState | undefined;
let activeDevice;
const unsubscribe = manager.subscribe(({device}) => {
  if (!device || device === activeDevice) return;
  activeDevice = device;
  cleanup?.();
  manager.reparentCanvas(container, device);
  cleanup = mountFlameTrailExample(container, {
    device,
    initialViewState: currentView,
    widgets: [new DeviceTabsWidget({manager, placement: 'top-left'})],
    onViewStateChange: params => {
      currentView = params.viewState as OrbitViewState;
      return params.viewState;
    },
    onDeckInitialized: deck => manager.reparentCanvas(deck.props.parent as HTMLElement, device)
  });
});
void manager.initialize();
import.meta.hot?.dispose(() => {
  unsubscribe();
  cleanup?.();
  manager.reset();
});
