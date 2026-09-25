// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, type Color, type OrbitViewState} from '@deck.gl/core';
import {ColumnPanel, CustomPanel, SettingsPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {createSceneLayers, fitSceneView, type SceneOptions} from './scene';
import {SETTINGS_SCHEMA} from './settings';
import {recordScene} from './recording';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

const TINTS: Record<string, Color> = {
  Natural: [255, 255, 255],
  Ember: [255, 100, 32],
  Violet: [135, 100, 255]
};

/** Mount the layer example with standard settings and an optional local recorder. */
export function mountFlameTrailExample(container: HTMLElement): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'flame-trail-demo';
  root.tabIndex = -1;
  root.innerHTML = `<div class="ft-stage" aria-label="Interactive burning path visualization"></div>
    <div class="ft-recording-status" hidden><span role="status"></span><button type="button">Cancel</button></div>`;
  container.appendChild(root);
  const stage = root.querySelector<HTMLDivElement>('.ft-stage')!;
  const status = root.querySelector<HTMLDivElement>('.ft-recording-status')!;
  let settings = {
    currentTime: 195,
    trailLength: 160,
    width: 18,
    fadeTrail: true,
    grid: false,
    mode: (window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'trips'
      : 'fire') as SceneOptions['mode'],
    tint: 'Natural',
    surface: 'terrain' as SceneOptions['surface'],
    followSurface: true,
    playing: false,
    speed: 1,
    orbit: true
  };
  let frame = 0;
  let previousTime = 0;
  let panelTime = 0;
  let disposed = false;
  let recording: ReturnType<typeof recordScene> | undefined;
  let downloadUrl: string | undefined;
  let viewState = fitSceneView(stage.clientWidth, stage.clientHeight, settings.surface);
  const controls = new BoxPanelWidget({
    id: 'flame-trail-controls',
    title: 'FlameTrailLayer',
    placement: 'top-right',
    widthPx: 340,
    collapsible: true,
    className: 'ft-controls'
  });
  const deck = new Deck({
    parent: stage,
    views: new OrbitView({id: 'fire', orbitAxis: 'Z', orthographic: true}),
    initialViewState: viewState,
    controller: true,
    widgets: [controls],
    useDevicePixels: Math.min(window.devicePixelRatio, 2),
    deviceProps: {webgl: {antialias: true}},
    onViewStateChange: ({viewState: next}) => {
      viewState = next as OrbitViewState;
    }
  });
  const scene = (): SceneOptions => ({...settings, tint: TINTS[settings.tint]});
  const renderFrame = () => deck.setProps({layers: createSceneLayers(scene())});
  function resetView(low = false) {
    viewState = fitSceneView(stage.clientWidth, stage.clientHeight, settings.surface);
    if (low) viewState.rotationX = 18;
    deck.setProps({initialViewState: viewState});
  }
  function setClean(clean: boolean) {
    root.classList.toggle('ft-clean', clean);
    if (clean) root.focus();
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') setClean(false);
    else if (event.key.toLowerCase() === 'h' && !(event.target instanceof HTMLInputElement)) {
      setClean(!root.classList.contains('ft-clean'));
    }
  });
  const actions = new CustomPanel({
    id: 'actions',
    title: '',
    onRenderHTML: element => {
      element.className = 'ft-actions';
      element.innerHTML = `<p>Drag to orbit. Scroll to zoom.</p>
        <button type="button">Overview</button> <button type="button">Low angle</button>
        <button type="button">Hide UI (H)</button> <button type="button">Record 12s</button>
        <p role="status"></p>`;
      const buttons = element.querySelectorAll('button');
      buttons[0].onclick = () => resetView();
      buttons[1].onclick = () => resetView(true);
      buttons[2].onclick = () => setClean(true);
      buttons[3].onclick = () => startRecording(element.querySelector('[role="status"]')!);
    }
  });
  function syncPanel() {
    const displayed = {...settings, currentTime: Number(settings.currentTime.toFixed(1))};
    controls.setProps({
      panel: new ColumnPanel({
        id: 'flame-trail-panel',
        panels: [
          new SettingsPanel({
            id: 'settings',
            schema: SETTINGS_SCHEMA,
            settings: displayed,
            onSettingsChange: next => {
              const oldSurface = settings.surface;
              // Keep the live playhead when another control changes between panel refreshes.
              for (const name of Object.keys(displayed)) {
                if (next[name] === displayed[name]) continue;
                settings = {...settings, [name]: next[name]};
                // Scrubbing pauses only the trip; the flame keeps burning.
                if (name === 'currentTime') {
                  settings.playing = false;
                  next.playing = false;
                }
              }
              if (oldSurface !== settings.surface) resetView();
              renderFrame();
              syncPanel();
            }
          }),
          actions
        ]
      })
    });
  }
  status.querySelector('button')!.onclick = () => recording?.cancel();
  async function startRecording(message: Element) {
    if (recording) return;
    message.textContent = '';
    status.hidden = false;
    status.querySelector('span')!.textContent = 'Preparing recording…';
    root.classList.add('ft-recording');
    recording = recordScene(root, {
      scene: scene(),
      viewState: {...viewState},
      orbit: settings.orbit,
      playTrip: settings.playing,
      speed: settings.speed,
      onProgress: seconds => {
        status.querySelector('span')!.textContent = `Recording ${seconds.toFixed(1)} / 12s`;
      }
    });
    try {
      const video = await recording.result;
      if (disposed) return;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(video);
      const download = document.createElement('a');
      download.href = downloadUrl;
      download.download = `flame-trail-1080p-${Date.now()}.${video.type.includes('mp4') ? 'mp4' : 'webm'}`;
      download.textContent = 'Download 1080p video';
      message.replaceChildren(download);
      download.click();
    } catch (error) {
      if (!disposed) message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      recording = undefined;
      status.hidden = true;
      root.classList.remove('ft-recording');
      previousTime = 0;
    }
  }
  function animate(now: number) {
    const seconds = previousTime ? Math.min(now - previousTime, 100) / 1000 : 0;
    if (!recording && settings.playing) {
      settings.currentTime = (settings.currentTime + seconds * 18 * settings.speed) % 300;
      renderFrame();
      if (now - panelTime > 200) {
        syncPanel();
        panelTime = now;
      }
    }
    previousTime = now;
    frame = requestAnimationFrame(animate);
  }
  const resizeObserver = new ResizeObserver(() => {
    viewState = {
      ...fitSceneView(stage.clientWidth, stage.clientHeight, settings.surface),
      rotationX: viewState.rotationX,
      rotationOrbit: viewState.rotationOrbit
    };
    deck.setProps({initialViewState: viewState});
  });
  resizeObserver.observe(stage);
  syncPanel();
  renderFrame();
  frame = requestAnimationFrame(animate);
  return () => {
    disposed = true;
    recording?.cancel();
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    deck.finalize();
    root.remove();
  };
}
