// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type DeckProps, type ViewStateChangeParameters} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {EdgeMarkerLayer, EdgeMarkerState} from '@deck.gl-community/layers';
import {SettingsPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {EXAMPLE_PANEL_STYLE} from '../../utils/panel-theme';
import {
  type CameraState,
  type ExampleView,
  INITIAL_CAMERAS,
  type Target,
  VIEWS,
  type ViewMode,
  createContextLayers,
  createTargets
} from './scene';
import {
  MAX_DISTANCE,
  clampCount,
  createSettingsSchema,
  getInitialSettings,
  isViewMode
} from './settings';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

type MountOptions = Pick<DeckProps<ExampleView>, 'device' | 'widgets'> & {
  initialViewState?: CameraState;
  onViewStateChange?: (params: ViewStateChangeParameters<CameraState>) => CameraState | null | void;
  onDeckInitialized?: (deck: Deck<ExampleView>) => void;
};

type EdgeMarkersBench = {
  deck: Deck<ExampleView>;
  getLayer: () => EdgeMarkerLayer<Target> | undefined;
  setView: (view: ViewMode) => void;
  setCount: (count: number) => void;
};

declare global {
  interface Window {
    __edgeMarkersBench?: EdgeMarkersBench;
  }
}

const LAYER_ID = 'edge-markers';
const STATE_LABELS = [
  [EdgeMarkerState.ON_SCREEN, 'On screen'],
  [EdgeMarkerState.OFF_SCREEN, 'Off screen'],
  [EdgeMarkerState.BEHIND_CAMERA, 'Behind camera'],
  [EdgeMarkerState.BEYOND_HORIZON, 'Beyond horizon'],
  [EdgeMarkerState.HIDDEN, 'Hidden']
] as const;

function getReadout(layer: EdgeMarkerLayer<Target>): string {
  const {frame, lastComputeMs} = layer.state;
  if (!frame) return '';
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < frame.count; i++) counts[frame.states[i]]++;
  const states = STATE_LABELS.map(([state, label]) => `${label} ${counts[state]}`);
  return [`${frame.count} targets`, ...states, `CPU ${lastComputeMs.toFixed(2)} ms`].join(' · ');
}

export function mountEdgeMarkersExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const params = new URLSearchParams(window.location.search);
  const restoredView = options.initialViewState?.exampleView;
  let settings = getInitialSettings(params, restoredView);
  let camera = options.initialViewState ?? INITIAL_CAMERAS[settings.view];
  let frame = 0;
  let previousTime: number | undefined;
  const startTime = performance.now();
  let contextLayers = createContextLayers(settings.view);
  const freeze = params.get('freeze') === '1';
  let frozen: {view: ViewMode; count: number; data: Target[]} | undefined;

  const root = container.ownerDocument.createElement('div');
  root.className = 'edge-markers-demo';
  root.setAttribute('aria-label', 'Moving targets and edge markers');
  const readout = container.ownerDocument.createElement('div');
  readout.className = 'edge-markers-readout';
  root.append(readout);
  container.append(root);

  const panel = SettingsPanel.createSectionPanels({
    schema: createSettingsSchema(settings.view),
    settings,
    onSettingsChange: next => applySettings(next as typeof settings)
  })[0];
  const controls = new BoxPanelWidget({
    style: EXAMPLE_PANEL_STYLE,
    id: 'edge-markers-controls',
    title: 'EdgeMarkerLayer',
    placement: 'top-left',
    widthPx: 310,
    collapsible: true,
    panel
  });

  const deck = new Deck<ExampleView>({
    device: options.device,
    parent: root,
    views: VIEWS[settings.view],
    viewState: camera,
    widgets: [...(options.widgets ?? []), controls],
    onViewStateChange: change => setCamera(change),
    onAfterRender: () => {
      const layer = getLayer();
      if (layer?.state) readout.textContent = getReadout(layer);
    }
  });
  options.onDeckInitialized?.(deck);

  function getLayer(): EdgeMarkerLayer<Target> | undefined {
    return deck['layerManager']
      ?.getLayers()
      .find(
        (layer): layer is EdgeMarkerLayer<Target> =>
          layer.id === LAYER_ID && layer instanceof EdgeMarkerLayer
      );
  }

  function setCamera(change: ViewStateChangeParameters<CameraState>) {
    const viewState = {...change.viewState, exampleView: settings.view};
    camera = options.onViewStateChange?.({...change, viewState}) || viewState;
  }

  function applySettings(next: typeof settings) {
    const previousView = settings.view;
    settings = next;
    if (settings.view === previousView) return;

    const previousLimit = MAX_DISTANCE[previousView];
    const maxDistance = MAX_DISTANCE[settings.view];
    settings = {
      ...settings,
      maxDistance:
        settings.maxDistance === previousLimit
          ? maxDistance
          : Math.min(settings.maxDistance, maxDistance - 1)
    };
    contextLayers = createContextLayers(settings.view);
    setCamera({
      viewId: settings.view,
      viewState: INITIAL_CAMERAS[settings.view],
      interactionState: {}
    });
    const section = createSettingsSchema(settings.view).sections[0];
    queueMicrotask(() => panel.setProps({section, settings}));
  }

  function animate(now: number) {
    if (settings.autoPan && previousTime !== undefined) {
      const bearing = (((camera.bearing ?? 0) + (now - previousTime) * 0.002 + 180) % 360) - 180;
      setCamera({viewId: settings.view, viewState: {...camera, bearing}, interactionState: {}});
    }
    previousTime = now;

    // `freeze=1` keeps the targets still, so that only the camera changes between frames.
    const data =
      freeze && frozen?.view === settings.view && frozen.count === settings.count
        ? frozen.data
        : createTargets(settings.view, camera, settings.count, (now - startTime) / 1000);
    if (freeze) frozen = {view: settings.view, count: settings.count, data};
    const dots =
      settings.view !== 'first-person' &&
      new ScatterplotLayer<Target>({
        id: 'target-positions',
        data,
        billboard: true,
        radiusUnits: 'pixels',
        getRadius: 2.5,
        getPosition: target => target.position,
        getFillColor: target => target.color,
        opacity: 0.45
      });
    const markers = new EdgeMarkerLayer<Target>({
      id: LAYER_ID,
      data,
      getColor: target => target.color,
      getLabel: settings.labels ? target => target.label : null,
      margins: settings.margins,
      minDistance: settings.minDistance,
      maxDistance:
        settings.maxDistance === MAX_DISTANCE[settings.view] ? Infinity : settings.maxDistance,
      yStretch: settings.yStretch,
      integerCoordinates: settings.integerCoordinates,
      behindCamera: settings.behindCamera,
      beyondHorizon: settings.beyondHorizon,
      showOnScreen: settings.showOnScreen
    });
    deck.setProps({
      views: VIEWS[settings.view],
      viewState: camera,
      layers: [...contextLayers, dots, markers]
    });
    frame = requestAnimationFrame(animate);
  }

  const bench: EdgeMarkersBench = {
    deck,
    getLayer,
    setView: view => {
      if (isViewMode(view)) applySettings({...settings, view});
    },
    setCount: count => {
      settings = {...settings, count: clampCount(count)};
      panel.setProps({settings});
    }
  };
  if (params.get('bench') === '1') window.__edgeMarkersBench = bench;

  frame = requestAnimationFrame(animate);
  return () => {
    cancelAnimationFrame(frame);
    if (window.__edgeMarkersBench === bench) delete window.__edgeMarkersBench;
    deck.finalize();
    root.remove();
  };
}
