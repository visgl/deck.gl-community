// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, type Color, type OrbitViewState} from '@deck.gl/core';
import {createSceneLayers, fitSceneView, type SceneOptions} from './scene';
import {recordScene} from './recording';
import './style.css';

/** Mount the flame demo and its local video recorder. */
export function mountNewHeatExample(container: HTMLElement): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'newheat-demo';
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="nh-stage" aria-label="Interactive burning path visualization"></div>
    <header class="nh-header nh-ui"><h1>NewHeatLayer</h1><span data-label="surface">Synthetic terrain</span></header>
    <details class="nh-settings nh-ui">
      <summary>Settings</summary>
      <div class="nh-settings-body">
        <label>Surface <select name="surface" aria-label="Surface"><option value="terrain">Rugged terrain</option><option value="flat">Flat ground</option></select></label>
        <label class="nh-check"><input name="follow" type="checkbox" checked /> Follow surface</label>
        <div class="nh-view-controls"><button type="button" data-action="reset-view">Overview</button><button type="button" data-action="low-view">Low angle</button></div>
        <label>Layer <select name="mode" aria-label="Layer"><option value="fire">NewHeatLayer</option><option value="trips">TripsLayer</option></select></label>
        <label>Trail <output data-value="trail">160</output><input aria-label="Trail length" name="trail" type="range" min="10" max="240" value="160" /></label>
        <label>Width <output data-value="width">18 px</output><input aria-label="Flame width" name="width" type="range" min="4" max="100" value="18" /></label>
        <label>Speed <output data-value="speed">1×</output><input aria-label="Playback speed" name="speed" type="range" min="0.1" max="3" step="0.1" value="1" /></label>
        <label>Tint <select name="tint" aria-label="Flame tint"><option value="full">Natural</option><option value="ember">Ember</option><option value="violet">Violet</option></select></label>
        <label class="nh-check"><input name="fade" type="checkbox" checked /> Fade trail</label>
        <label class="nh-check"><input name="grid" type="checkbox" /> Show grid / mesh</label>
        <label class="nh-check"><input name="orbit" type="checkbox" checked /> Slow orbit in recording</label>
        <p>Drag to orbit. Scroll to zoom.<br />Record a 12-second clip at 1920 × 1080.</p>
      </div>
    </details>
    <footer class="nh-toolbar nh-ui">
      <button type="button" data-action="play" aria-label="Pause animation">Pause</button>
      <input class="nh-time" aria-label="Current time" name="time" type="range" min="0" max="300" step="0.1" value="195" />
      <output class="nh-clock" data-value="time">195.0</output>
      <button type="button" data-action="clean" title="Hide controls (H). Escape restores them.">Hide UI</button>
      <button type="button" data-action="record">Record 12s</button>
    </footer>
    <div class="nh-recording-status" hidden><span role="status"></span><button type="button" data-action="cancel">Cancel</button></div>
    <div class="nh-message nh-ui" role="status" hidden></div>
    <a class="nh-download nh-ui" hidden>Download video</a>`;
  container.appendChild(root);
  const stage = root.querySelector<HTMLDivElement>('.nh-stage')!;
  const timeInput = root.querySelector<HTMLInputElement>('[name="time"]')!;
  const timeOutput = root.querySelector<HTMLOutputElement>('[data-value="time"]')!;
  const playButton = root.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  const recordButton = root.querySelector<HTMLButtonElement>('[data-action="record"]')!;
  const recordStatus = root.querySelector<HTMLDivElement>('.nh-recording-status')!;
  const message = root.querySelector<HTMLDivElement>('.nh-message')!;
  const download = root.querySelector<HTMLAnchorElement>('.nh-download')!;
  const options: SceneOptions = {
    currentTime: 195,
    trailLength: 160,
    width: 18,
    fadeTrail: true,
    grid: false,
    mode: 'fire',
    tint: [255, 255, 255],
    surface: 'terrain',
    followSurface: true
  };
  let playing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let speed = 1;
  let orbit = true;
  let frame = 0;
  let previousTime = 0;
  let disposed = false;
  let recording: ReturnType<typeof recordScene> | undefined;
  let downloadUrl: string | undefined;
  let viewState = fitSceneView(stage.clientWidth, stage.clientHeight, options.surface);
  const deck = new Deck({
    parent: stage,
    views: new OrbitView({id: 'fire', orbitAxis: 'Z', orthographic: true}),
    initialViewState: viewState,
    controller: true,
    useDevicePixels: Math.min(window.devicePixelRatio, 2),
    deviceProps: {webgl: {antialias: true}},
    onViewStateChange: ({viewState: next}) => {
      viewState = next as OrbitViewState;
    }
  });

  function renderFrame() {
    deck.setProps({layers: createSceneLayers(options)});
    timeInput.value = String(options.currentTime);
    timeOutput.value = options.currentTime.toFixed(1);
  }
  function updatePlayback() {
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
  }
  function setClean(clean: boolean) {
    root.classList.toggle('nh-clean', clean);
    if (clean) root.focus();
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') setClean(false);
    else if (
      event.key.toLowerCase() === 'h' &&
      !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
    ) {
      setClean(!root.classList.contains('nh-clean'));
    }
  });
  root.querySelector<HTMLButtonElement>('[data-action="clean"]')!.onclick = () => setClean(true);
  function resetView(low = false) {
    viewState = fitSceneView(stage.clientWidth, stage.clientHeight, options.surface);
    if (low) viewState.rotationX = 18;
    deck.setProps({initialViewState: viewState});
  }
  root.querySelector<HTMLButtonElement>('[data-action="reset-view"]')!.onclick = () => resetView();
  root.querySelector<HTMLButtonElement>('[data-action="low-view"]')!.onclick = () =>
    resetView(true);
  playButton.onclick = () => {
    playing = !playing;
    updatePlayback();
  };
  root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.onclick = () =>
    recording?.cancel();
  root.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (input.name === 'trail') options.trailLength = value;
    if (input.name === 'width') options.width = value;
    if (input.name === 'speed') speed = value;
    if (input.name === 'fade') options.fadeTrail = input.checked;
    if (input.name === 'grid') options.grid = input.checked;
    if (input.name === 'orbit') orbit = input.checked;
    if (input.name === 'follow') options.followSurface = input.checked;
    if (input.name === 'surface') {
      options.surface = input.value as SceneOptions['surface'];
      root.querySelector('[data-label="surface"]')!.textContent =
        options.surface === 'terrain' ? 'Synthetic terrain' : 'deck.gl';
      resetView();
    }
    if (input.name === 'mode') options.mode = input.value as SceneOptions['mode'];
    if (input.name === 'tint') {
      const colors: Record<string, Color> = {
        full: [255, 255, 255],
        ember: [255, 100, 32],
        violet: [135, 100, 255]
      };
      options.tint = colors[input.value];
    }
    if (input.name === 'time') {
      options.currentTime = value;
      playing = false;
      updatePlayback();
    }
    const output = root.querySelector<HTMLOutputElement>(`[data-value="${input.name}"]`);
    if (output && input.name !== 'time') {
      output.value = `${value}${input.name === 'width' ? ' px' : input.name === 'speed' ? '×' : ''}`;
    }
    renderFrame();
  });

  recordButton.onclick = async () => {
    if (recording) return;
    message.hidden = true;
    download.hidden = true;
    recordButton.disabled = true;
    root.classList.add('nh-recording');
    recordStatus.hidden = false;
    recordStatus.querySelector('span')!.textContent = 'Preparing recording…';
    recording = recordScene(root, {
      scene: {...options},
      viewState: {...viewState},
      orbit,
      onProgress: seconds => {
        recordStatus.querySelector('span')!.textContent = `Recording ${seconds.toFixed(1)} / 12s`;
      }
    });
    try {
      const video = await recording.result;
      if (disposed) return;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(video);
      download.href = downloadUrl;
      download.download = `newheat-1080p-${Date.now()}.${video.type.includes('mp4') ? 'mp4' : 'webm'}`;
      download.textContent = 'Download video';
      download.hidden = false;
      message.textContent = 'Recording ready · 1920 × 1080';
      message.hidden = false;
      download.click();
    } catch (error) {
      if (!disposed) {
        message.textContent = error instanceof Error ? error.message : String(error);
        message.hidden = false;
      }
    } finally {
      recording = undefined;
      recordButton.disabled = false;
      recordStatus.hidden = true;
      root.classList.remove('nh-recording');
      previousTime = 0;
    }
  };

  function animate(now: number) {
    if (playing && previousTime && !recording) {
      options.currentTime =
        (options.currentTime + Math.min(now - previousTime, 100) * 0.018 * speed) % 300;
      renderFrame();
    }
    previousTime = now;
    frame = requestAnimationFrame(animate);
  }
  const resizeObserver = new ResizeObserver(() => {
    viewState = {
      ...fitSceneView(stage.clientWidth, stage.clientHeight, options.surface),
      rotationX: viewState.rotationX,
      rotationOrbit: viewState.rotationOrbit
    };
    deck.setProps({initialViewState: viewState});
  });
  resizeObserver.observe(stage);
  updatePlayback();
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
