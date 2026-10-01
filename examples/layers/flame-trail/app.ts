// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, type Color, type DeckProps, type OrbitViewState} from '@deck.gl/core';
import {SettingsPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {createSceneLayers, fitSceneView, TRIP_DURATION} from './scene';
import {SETTINGS_SCHEMA} from './settings';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

const COLORS: Record<string, Color> = {
  Natural: [255, 255, 255],
  Ember: [255, 100, 32],
  Violet: [135, 100, 255]
};

type MountOptions = Pick<
  DeckProps<OrbitView>,
  'device' | 'initialViewState' | 'widgets' | 'onViewStateChange'
> & {
  onDeckInitialized?: (deck: Deck<OrbitView>) => void;
};

/** Mount two continuously moving flame trails with length, width, and color controls. */
export function mountFlameTrailExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'flame-trail-demo';
  root.setAttribute('aria-label', 'Two flame trails over a terrain mesh');
  container.appendChild(root);
  let settings = {trailLength: 80, width: 24, color: 'Natural'};
  let currentTime = 195;
  let frame = 0;
  let previousTime = 0;
  let viewState =
    (options.initialViewState as OrbitViewState) ??
    fitSceneView(root.clientWidth, root.clientHeight);
  const backend = options.device?.type === 'webgpu' ? 'webgpu' : 'webgl';
  const controls = new BoxPanelWidget({
    id: 'flame-trail-controls',
    title: 'FlameTrailLayer',
    placement: 'top-left',
    widthPx: 300,
    collapsible: true
  });
  const deck = new Deck<OrbitView>({
    device: options.device,
    parent: root,
    views: new OrbitView({id: 'fire', orbitAxis: 'Z', orthographic: true}),
    initialViewState: viewState,
    controller: true,
    widgets: [...(options.widgets ?? []), controls],
    useDevicePixels: Math.min(window.devicePixelRatio, 2),
    deviceProps: {webgl: {antialias: true}},
    onViewStateChange: params => {
      viewState = params.viewState as OrbitViewState;
      return options.onViewStateChange?.(params);
    }
  });
  options.onDeckInitialized?.(deck);
  const renderFrame = () =>
    deck.setProps({
      layers: createSceneLayers({...settings, currentTime, color: COLORS[settings.color]}, backend)
    });
  controls.setProps({
    panel: SettingsPanel.createSectionPanels({
      schema: SETTINGS_SCHEMA,
      settings,
      onSettingsChange: next => {
        settings = next as typeof settings;
        renderFrame();
      }
    })[0]
  });
  function animate(now: number) {
    const seconds = previousTime ? Math.min(now - previousTime, 100) / 1000 : 0;
    currentTime = (currentTime + seconds * 18) % TRIP_DURATION;
    renderFrame();
    previousTime = now;
    frame = requestAnimationFrame(animate);
  }
  const resizeObserver = new ResizeObserver(() => {
    viewState = {
      ...fitSceneView(root.clientWidth, root.clientHeight),
      rotationX: viewState.rotationX,
      rotationOrbit: viewState.rotationOrbit
    };
    deck.setProps({initialViewState: viewState});
  });
  resizeObserver.observe(root);
  renderFrame();
  frame = requestAnimationFrame(animate);
  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    deck.finalize();
    root.remove();
  };
}
