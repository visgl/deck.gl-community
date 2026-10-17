// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, type DeckProps, type OrbitViewState} from '@deck.gl/core';
import {SettingsPanel, type SettingsSchema} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {
  VolumetricVideoLayer,
  getVolumetricVideoHistoryBytes,
  type VolumetricVideoFrameInfo,
  type VolumetricVideoInfo
} from '@deck.gl-community/layers';
import {dampCamera, isCameraSettled} from './camera-utils';
import {getDemoHistory, MAX_DEMO_HISTORY_BYTES} from './history-utils';
import '@deck.gl/widgets/stylesheet.css';

const SAMPLE_VIDEO = new URL('./sample.mp4', import.meta.url).href;
const INITIAL_VIEW: OrbitViewState = {
  target: [0, 0, -0.75],
  rotationX: 22,
  rotationOrbit: -38,
  zoom: 7.2
};
const REQUESTED_BACKEND = new URLSearchParams(window.location.search).get('backend');
const PREFER_WEBGPU =
  REQUESTED_BACKEND !== 'webgl' && Boolean((navigator as Navigator & {gpu?: unknown}).gpu);
type WebGPUNavigator = Navigator & {gpu?: {requestAdapter: () => Promise<unknown>}};
type MountOptions = Pick<
  DeckProps<OrbitView>,
  'device' | 'initialViewState' | 'widgets' | 'onViewStateChange'
> & {
  embedded?: boolean;
  sampleVideo?: string;
  onDeckInitialized?: (deck: Deck<OrbitView>) => void;
};

function getSettingsSchema(frameCount: number): SettingsSchema {
  return {
    sections: [
      {
        name: 'Timeline',
        initiallyCollapsed: false,
        settings: [
          {
            name: 'currentFrame',
            label: 'Current frame',
            type: 'number',
            min: 0,
            max: frameCount - 1,
            step: 1
          },
          {
            name: 'frameTrail',
            label: 'Frame trail',
            type: 'number',
            min: 0,
            max: frameCount - 1,
            step: 1
          },
          {
            name: 'frameSpacing',
            label: 'Frame spacing',
            type: 'number',
            min: 0,
            max: 0.1,
            step: 0.001
          }
        ]
      },
      {
        name: 'Appearance',
        initiallyCollapsed: false,
        settings: [
          {
            name: 'staticPixelRemoval',
            label: 'Remove static pixels',
            type: 'number',
            min: 0,
            max: 1,
            step: 0.01
          },
          {
            name: 'frameOpacity',
            label: 'Frame opacity',
            type: 'number',
            min: 0.05,
            max: 1,
            step: 0.01
          },
          {
            name: 'luminanceThreshold',
            label: 'Remove dark pixels',
            type: 'number',
            min: 0,
            max: 0.4,
            step: 0.01
          }
        ]
      },
      {
        name: 'Sampling',
        settings: [
          {
            name: 'resolution',
            label: 'Resolution',
            type: 'select',
            options: [
              {label: 'Every source pixel', value: 0},
              {label: '128 pixels', value: 128},
              {label: '256 pixels', value: 256},
              {label: '512 pixels', value: 512}
            ]
          }
        ]
      }
    ]
  };
}

/** Mounts a file-driven video volume, with no framework or server upload. */
export function mountVolumetricVideoExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const root = document.createElement('div');
  root.className = options.embedded ? 'vv-demo vv-embedded' : 'vv-demo';
  root.innerHTML = `
    <style>
      .vv-demo {width:100%;height:100%;min-height:540px;display:grid;grid-template-columns:300px 1fr;background:#080c12;color:#e7edf6;font:16px/1.5 system-ui,sans-serif;overflow:hidden}
      .vv-demo * {box-sizing:border-box}
      .vv-demo.vv-embedded {grid-template-columns:1fr;min-height:0}
      .vv-demo.vv-embedded .vv-panel {display:none}
      .vv-demo.vv-embedded .vv-backend-toggle {display:none}
      .vv-demo.vv-embedded .vv-stage-top {display:none}
      .vv-panel {padding:32px 26px;display:flex;flex-direction:column;gap:24px;border-right:1px solid #ffffff12;background:#0d121b;overflow:auto;z-index:2}
      .vv-eyebrow {font:11px/1.4 ui-monospace,monospace;letter-spacing:.18em;color:#80a3c5;text-transform:uppercase}
      .vv-panel h1 {font-size:32px;line-height:1.12;letter-spacing:-.04em;font-weight:550;margin:12px 0}
      .vv-panel p {color:#8592a6;margin:0;font-size:16px}
      .vv-upload {display:block;padding:12px 16px;text-align:center;border:1px solid #6fffc046;border-radius:8px;color:#a7f8d5;background:#6fffc009;cursor:pointer;font-weight:500}
      .vv-upload input {position:absolute;opacity:0;width:1px;height:1px}
      .vv-upload:focus-within {outline:2px solid #a7f8d5;outline-offset:3px}
      .vv-control label {display:flex;justify-content:space-between;margin-bottom:9px;color:#c9d3e1;font-size:12px}
      .vv-control output {font-family:ui-monospace,monospace;color:#a7f8d5}
      .vv-control input {width:100%;accent-color:#a7f8d5;cursor:pointer}.vv-control select{width:100%;padding:7px 10px;background:#192332;color:#c9d3e1;border:1px solid #ffffff20;border-radius:6px;font:inherit}
      .vv-actions {display:flex;gap:8px}
      .vv-demo button {font:inherit;cursor:pointer;color:#bdcadd;background:#192332;border:1px solid #ffffff15;padding:9px 13px;border-radius:6px}
      .vv-demo button:hover {color:white;border-color:#a7f8d580}
      .vv-demo button:disabled {opacity:.4;cursor:wait}
      .vv-play {flex:1}
      .vv-demo details {font-size:12px;color:#9cacc1}
      .vv-demo summary {cursor:pointer;margin-bottom:16px}
      .vv-demo details .vv-control {margin-bottom:14px}
      .vv-stage {position:relative;min-width:0;background:radial-gradient(ellipse at 50% 48%,#152131,#080c12 68%)}
      .vv-canvas {position:absolute;inset:0}
      .vv-stage-top {position:absolute;top:28px;left:32px;right:32px;display:flex;align-items:center;justify-content:space-between;pointer-events:none;gap:12px}
      .vv-stage-top span:last-child {font:11px ui-monospace,monospace;color:#546c86}
      .vv-backend-toggle {display:flex;gap:4px;pointer-events:auto}
      .vv-backend-toggle button {padding:4px 8px;border-radius:5px;background:#0d121bbf;font:10px/1.2 ui-monospace,monospace;letter-spacing:.06em}
      .vv-backend-toggle button[aria-pressed="true"] {color:#a7f8d5;border-color:#6fffc080;background:#6fffc012}
      .vv-stage-meta {position:absolute;top:56px;right:32px;max-width:min(360px,calc(100% - 64px));padding:8px 10px;border:1px solid #ffffff14;border-radius:6px;background:#080c12b8;font:11px/1.6 ui-monospace,monospace;color:#9aafc6;pointer-events:none}
      .vv-stage-meta > *:empty {display:none}
      .vv-stage-meta .vv-error {margin:0;color:#ffae9a;overflow-wrap:anywhere}
      .vv-stage-meta .vv-limit {color:#e4c78b}
      .vv-source {position:absolute;bottom:28px;left:32px;width:170px;pointer-events:none}
      .vv-source video {display:block;width:100%;border-radius:6px;border:1px solid #ffffff20;margin-bottom:8px}
      .vv-source span {font:10px ui-monospace,monospace;color:#6c819b;letter-spacing:.12em;text-transform:uppercase}
      .vv-views {position:absolute;bottom:28px;right:32px;display:flex;gap:6px}
      .vv-views button {font-size:11px;background:#0d121bbf}
      @media(max-width:760px) {.vv-demo{grid-template-columns:1fr;grid-template-rows:minmax(300px,1fr) auto;min-height:0}.vv-stage{grid-row:1}.vv-panel{padding:16px;gap:12px;border-right:0;border-top:1px solid #ffffff12;display:grid;grid-template-columns:1fr 1fr}.vv-panel header,.vv-panel details{display:none}.vv-upload,.vv-static,.vv-sampling{grid-column:1/-1}.vv-upload{padding:8px 12px;font-size:12px}.vv-panel .vv-actions{align-items:center}.vv-source{width:100px;left:16px;bottom:16px}.vv-stage-top{top:16px;left:16px;right:16px}.vv-stage-meta{top:44px;right:16px;max-width:calc(100% - 32px)}.vv-views{bottom:16px;right:16px}}
    </style>
    <aside class="vv-panel">
      <header><div class="vv-eyebrow">deck.gl community / layer lab</div><h1>Video into<br>volume.</h1><p>Every frame becomes a plane of splats.<br>Stack time. Explore the shape.</p></header>
      <label class="vv-upload">Open MP4 / MOV<input id="vv-file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" aria-label="Open MP4 or MOV video"></label>
      <div class="vv-control"><label for="vv-frame">currentFrame <output id="vv-frame-value">88</output></label><input id="vv-frame" type="range" min="0" max="119" value="88" step="1"></div>
      <div class="vv-control"><label for="vv-trail">frameTrail <output id="vv-trail-value">48</output></label><input id="vv-trail" type="range" min="0" max="119" value="48" step="1"></div>
      <div class="vv-control"><label for="vv-spacing">Frame spacing <output id="vv-spacing-value">0.035</output></label><input id="vv-spacing" type="range" min="0" max="0.1" value="0.035" step="0.001"></div>
      <div class="vv-actions"><button class="vv-play" id="vv-play" disabled>Play</button><button id="vv-sample">Demo</button></div>
      <div class="vv-control vv-static"><label for="vv-static">Remove static pixels <output id="vv-static-value">0.00 · Off</output></label><input id="vv-static" type="range" min="0" max="1" value="0" step="0.01" aria-describedby="vv-static-help"><p id="vv-static-help" style="font-size:16px;margin-top:4px">0 shows all pixels · 1 aggressively removes similar pixels</p></div>
      <div class="vv-control vv-sampling"><label for="vv-resolution">Sampling</label><select id="vv-resolution" aria-label="Sampling resolution"><option value="0" selected>Every source pixel</option><option value="128">128 pixels</option><option value="256">256 pixels</option><option value="512">512 pixels</option></select></div>
      <details><summary>Appearance and history</summary>
        <div class="vv-control"><label for="vv-opacity">Frame opacity</label><input id="vv-opacity" type="range" min="0.05" max="1" value="0.65" step="0.01"></div>
        <div class="vv-control"><label for="vv-threshold">Remove dark pixels</label><input id="vv-threshold" type="range" min="0" max="0.4" value="0.08" step="0.01"></div>
        <div class="vv-control"><label for="vv-budget">History budget (MiB)</label><input id="vv-budget" type="number" min="1" max="1024" value="512" step="1"><p style="font-size:16px;margin-top:4px">Up to 1024 MiB in this demo. Lower sampling retains longer trails.</p></div>
      </details>
    </aside>
    <main class="vv-stage" aria-label="Interactive video frame volume">
      <div class="vv-canvas"></div>
      <div class="vv-stage-top"><span class="vv-eyebrow">VolumetricVideoLayer · <b id="vv-backend">${PREFER_WEBGPU ? 'CHECKING…' : 'WEBGL2'}</b></span><div class="vv-backend-toggle" role="group" aria-label="Graphics backend"><button type="button" data-backend-option="webgl" aria-pressed="${String(!PREFER_WEBGPU)}">WEBGL</button><button type="button" data-backend-option="webgpu" aria-pressed="${String(PREFER_WEBGPU)}">WEBGPU</button></div><span>DRAG TO ORBIT · SCROLL TO ZOOM</span></div>
      <div class="vv-stage-meta"><div id="vv-name">Synthetic motion demo · H.264 MP4</div><div id="vv-status" role="status" aria-live="polite">Indexing video frames…</div><div id="vv-stats"></div><div id="vv-history"></div><div id="vv-limit" class="vv-limit" role="status" aria-live="polite"></div><p id="vv-error" class="vv-error" role="alert"></p></div>
      <div class="vv-source"><video muted playsinline preload="auto" aria-label="Source video frame"></video><span>Source frame</span></div>
      <div class="vv-views"><button data-view="volume">Volume</button><button data-view="front">Front</button><button data-view="side">Side</button></div>
    </main>`;
  container.append(root);
  const getElement = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const frameInput = getElement<HTMLInputElement>('#vv-frame');
  const trailInput = getElement<HTMLInputElement>('#vv-trail');
  const preview = getElement<HTMLVideoElement>('video');
  const status = getElement('#vv-status');
  const errorOutput = getElement('#vv-error');
  const playButton = getElement<HTMLButtonElement>('#vv-play');
  const backendOutput = getElement('#vv-backend');
  const backendButtons = root.querySelectorAll<HTMLButtonElement>('[data-backend-option]');
  const sampleVideo = options.sampleVideo ?? SAMPLE_VIDEO;
  let video: string | File = sampleVideo;
  let previewUrl: string | null = null;
  let info: VolumetricVideoInfo | null = null;
  let currentFrame = 88;
  let frameTrail = 48;
  let requestedFrameTrail = 48;
  let maxArrayLayers = 256;
  let frameSpacing = 0.035;
  let frameOpacity = 0.65;
  let luminanceThreshold = 0.08;
  let resolution = 0;
  let maxTextureBytes = 512 * 1048576;
  let staticPixelRemoval = 0;
  let viewState = (options.initialViewState as OrbitViewState) ?? INITIAL_VIEW;
  let cameraTarget = viewState;
  let lastAnimationTime = performance.now();
  let playing = false;
  let pending = true;
  let animation = 0;
  let playbackStart = 0;
  let playbackTime = 0;
  let destroyed = false;
  let requestedBackend: 'webgl' | 'webgpu' =
    options.device?.type === 'webgpu' || (!options.device && PREFER_WEBGPU) ? 'webgpu' : 'webgl';
  let useWebGPU = requestedBackend === 'webgpu';
  let backendRequestGeneration = 0;
  let deckGeneration = 0;
  let backendSwitching = false;
  let preserveVideoState = false;
  let requestedVideo: string | File | null = null;
  let requestedFrame = -1;
  let requestedTrail = -1;
  let requestedResolution = -1;
  let requestedBudget = -1;

  let interacting = false;
  let deck: Deck | undefined;
  const standardPanel = options.embedded
    ? new BoxPanelWidget({
        id: 'volumetric-video-controls',
        title: 'VolumetricVideoLayer',
        placement: 'top-left',
        // Number controls combine a slider and a numeric input. Keep their minimum
        // widths inside the community site's standard panel so it never clips its
        // labels behind the documentation sidebar.
        widthPx: 368,
        collapsible: true
      })
    : undefined;

  function syncStandardPanel() {
    if (!standardPanel) return;
    const totalFrames = info?.frameCount ?? 120;
    standardPanel.setProps({
      panel: new SettingsPanel({
        id: 'volumetric-video-settings',
        schema: getSettingsSchema(totalFrames),
        settings: {
          currentFrame,
          frameTrail,
          frameSpacing,
          staticPixelRemoval,
          frameOpacity,
          luminanceThreshold,
          resolution
        },
        onSettingsChange: settings => {
          setPlaying(false);
          currentFrame = Math.max(0, Math.min(totalFrames - 1, Number(settings.currentFrame)));
          requestedFrameTrail = Math.max(0, Math.min(totalFrames - 1, Number(settings.frameTrail)));
          frameSpacing = Number(settings.frameSpacing);
          staticPixelRemoval = Number(settings.staticPixelRemoval);
          frameOpacity = Number(settings.frameOpacity);
          luminanceThreshold = Number(settings.luminanceThreshold);
          resolution = Number(settings.resolution);
          updateLayer();
        }
      })
    });
  }

  function syncBackendControls() {
    const backend = backendSwitching ? requestedBackend : useWebGPU ? 'webgpu' : 'webgl';
    backendButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.backendOption === backend));
      button.disabled = Boolean(options.device) || backendSwitching;
    });
  }

  function createDeck(preferWebGPU: boolean, generation: number): Deck {
    return new Deck({
      // Keep source sampling independent of Retina framebuffer fill cost.
      useDevicePixels: 1,
      ...(options.device
        ? {device: options.device}
        : {
            deviceProps: preferWebGPU
              ? {type: 'webgpu', adapters: [webgpuAdapter]}
              : {type: 'webgl'}
          }),
      parent: getElement('.vv-canvas'),
      views: [
        new OrbitView({
          id: 'volume',
          orbitAxis: 'Y',
          controller: {
            inertia: false,
            scrollZoom: {speed: 0.003, smooth: false},
            doubleClickZoom: false
          }
        })
      ],
      viewState: {
        volume: {...viewState, minRotationX: -65, maxRotationX: 65, minZoom: 4, maxZoom: 10}
      },
      widgets: [...(options.widgets ?? []), ...(standardPanel ? [standardPanel] : [])],
      onDeviceInitialized: device => {
        if (destroyed || generation !== deckGeneration) return;
        maxArrayLayers = device.limits.maxTextureArrayLayers;
        useWebGPU = device.type === 'webgpu';
        requestedBackend = useWebGPU ? 'webgpu' : 'webgl';
        root.dataset.backend = device.type;
        backendOutput.textContent = device.type === 'webgpu' ? 'WEBGPU' : 'WEBGL2';
        syncBackendControls();
        if (info) updateLayer();
      },
      onInteractionStateChange: state => {
        interacting = Boolean(state.isDragging || state.isZooming);
      },
      onViewStateChange: event => {
        cameraTarget = event.viewState as OrbitViewState;
        return options.onViewStateChange?.(event);
      },
      onError: error => {
        if (destroyed || generation !== deckGeneration) return;
        errorOutput.textContent = error.message;
        status.textContent = root.dataset.frameReady
          ? 'Keeping the last working volume'
          : 'Video could not be loaded';
        setPlaying(false);
        playButton.disabled = true;
      },
      getCursor: ({isDragging}) => (isDragging ? 'grabbing' : 'grab')
    });
  }

  function onVideoLoad(loaded: VolumetricVideoInfo) {
    if (destroyed) return;
    const preserveControls = preserveVideoState;
    preserveVideoState = false;
    info = loaded;
    if (!preserveControls) {
      // Start each source at full resolution with a trail that fits the initial budget.
      frameTrail = Math.min(
        48,
        loaded.frameCount - 1,
        Math.max(
          0,
          Math.floor(
            maxTextureBytes / getVolumetricVideoHistoryBytes(loaded.width, loaded.height, 1)
          ) - 1
        )
      );
      requestedFrameTrail = frameTrail;
    } else {
      requestedFrameTrail = Math.min(requestedFrameTrail, loaded.frameCount - 1);
    }
    currentFrame = Math.min(currentFrame, loaded.frameCount - 1);
    frameInput.max = String(loaded.frameCount - 1);
    frameInput.value = String(currentFrame);
    playButton.disabled = pending;
    status.textContent = `${loaded.width} × ${loaded.height} · ${loaded.frameCount} frames · ${loaded.duration.toFixed(2)}s`;
    updateLayer();
  }

  function onFrameLoad(loaded: VolumetricVideoFrameInfo) {
    if (destroyed) return;
    pending = false;
    errorOutput.textContent = '';
    playButton.disabled = false;
    root.dataset.frameReady = String(loaded.currentFrame);
    root.dataset.frameCount = String(loaded.frameCount);
    if (info) {
      status.textContent = `${info.width} × ${info.height} · ${info.frameCount} frames · ${info.duration.toFixed(2)}s`;
    }
    getElement('#vv-stats').textContent =
      `${loaded.splatCount.toLocaleString()} splats · ${(loaded.textureBytes / 1048576).toFixed(1)} MiB history`;
    // The small video is a source reference; it is not used by the volume renderer.
    if (Math.abs(preview.currentTime - loaded.timestamp) > 0.02)
      preview.currentTime = loaded.timestamp;
  }

  function updateLayer() {
    if (destroyed || !deck) return;
    const layerGeneration = deckGeneration;
    const sampling = getElement<HTMLSelectElement>('#vv-resolution');
    const nativeOption = sampling.querySelector<HTMLOptionElement>('option[value="0"]')!;
    const totalFrames = info?.frameCount ?? 120;
    const scale =
      info && resolution > 0 ? Math.min(1, resolution / Math.max(info.width, info.height)) : 1;
    const bytesPerFrame = info
      ? getVolumetricVideoHistoryBytes(
          Math.round(info.width * scale),
          Math.round(info.height * scale),
          1
        )
      : 0;
    const history = getDemoHistory(
      requestedFrameTrail,
      totalFrames,
      bytesPerFrame || 1,
      maxTextureBytes,
      maxArrayLayers
    );
    frameTrail = history.frameTrail;
    const historyCapacity = info ? history.capacity : 1;
    getElement('#vv-limit').textContent =
      info && history.limited
        ? `Trail limited to ${frameTrail} preceding frames at this sampling (${(history.budget / 1048576).toFixed(0)} MiB budget). Lower Sampling for the requested ${requestedFrameTrail}-frame trail.`
        : '';
    if (
      requestedVideo !== video ||
      requestedFrame !== currentFrame ||
      requestedTrail !== frameTrail ||
      requestedResolution !== resolution ||
      requestedBudget !== maxTextureBytes
    ) {
      pending = true;
      requestedVideo = video;
      requestedFrame = currentFrame;
      requestedTrail = frameTrail;
      requestedResolution = resolution;
      requestedBudget = maxTextureBytes;
    }
    nativeOption.textContent = info
      ? `Every source pixel (${info.width} × ${info.height})`
      : 'Every source pixel';
    trailInput.max = String(Math.max(0, totalFrames - 1));
    trailInput.value = String(frameTrail);
    getElement('#vv-history').textContent = info
      ? `Full video history: ${((bytesPerFrame * totalFrames) / 1048576).toFixed(0)} MiB · budget ${(maxTextureBytes / 1048576).toFixed(0)} MiB`
      : '';
    frameInput.value = String(currentFrame);
    getElement('#vv-frame-value').textContent = String(currentFrame);
    getElement('#vv-trail-value').textContent = String(frameTrail);
    getElement('#vv-spacing-value').textContent = frameSpacing.toFixed(3);
    getElement('#vv-static-value').textContent =
      staticPixelRemoval === 0
        ? '0.00 · Off'
        : staticPixelRemoval === 1
          ? '1.00 · Max'
          : staticPixelRemoval.toFixed(2);
    deck.setProps({
      layers: [
        new VolumetricVideoLayer({
          id: 'video-volume',
          video,
          currentFrame,
          frameTrail,
          // Reserve in buckets for nearby adjustments, bounded by source length.
          maxFrameTrail: historyCapacity - 1,
          maxTextureBytes,
          resolution,
          width: 3,
          frameSpacing,
          frameOpacity,
          luminanceThreshold,
          staticPixelRemoval,
          splatSize: 1.5,
          trailFade: 0.006,
          onVideoLoad: loaded => {
            if (deckGeneration === layerGeneration) onVideoLoad(loaded);
          },
          onFrameLoad: loaded => {
            if (deckGeneration === layerGeneration) onFrameLoad(loaded);
          }
        })
      ]
    });
    syncStandardPanel();
  }

  function setPlaying(value: boolean) {
    playing = value;
    playButton.textContent = value ? 'Pause' : 'Play';
    if (value && info) {
      playbackStart = performance.now();
      playbackTime = info.frameTimestamps[currentFrame];
    }
  }

  function selectVideo(source: string | File) {
    setPlaying(false);
    preserveVideoState = false;
    if (source === video && info) {
      currentFrame = Math.min(typeof source === 'string' ? 88 : 0, info.frameCount - 1);
      updateLayer();
      return;
    }
    resolution = 0;
    getElement<HTMLSelectElement>('#vv-resolution').value = '0';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
    video = source;
    preview.src = previewUrl || (source as string);
    currentFrame = typeof source === 'string' ? 88 : 0;
    info = null;
    delete root.dataset.frameReady;
    delete root.dataset.frameCount;
    errorOutput.textContent = '';
    playButton.disabled = true;
    status.textContent = 'Indexing video frames…';
    getElement('#vv-name').textContent =
      typeof source === 'string' ? 'Synthetic motion demo · H.264 MP4' : source.name;
    updateLayer();
  }

  frameInput.oninput = () => {
    setPlaying(false);
    currentFrame = Number(frameInput.value);
    updateLayer();
  };
  trailInput.oninput = () => {
    requestedFrameTrail = Number(trailInput.value);
    updateLayer();
  };
  getElement<HTMLInputElement>('#vv-spacing').oninput = event => {
    frameSpacing = Number((event.target as HTMLInputElement).value);
    updateLayer();
  };
  getElement<HTMLInputElement>('#vv-opacity').oninput = event => {
    frameOpacity = Number((event.target as HTMLInputElement).value);
    updateLayer();
  };
  getElement<HTMLInputElement>('#vv-threshold').oninput = event => {
    luminanceThreshold = Number((event.target as HTMLInputElement).value);
    updateLayer();
  };
  getElement<HTMLSelectElement>('#vv-resolution').onchange = event => {
    resolution = Number((event.target as HTMLSelectElement).value);
    updateLayer();
  };
  getElement<HTMLInputElement>('#vv-budget').onchange = event => {
    const input = event.target as HTMLInputElement;
    const budget = Number(input.value);
    if (!Number.isFinite(budget) || budget < 1) return;
    maxTextureBytes = Math.min(MAX_DEMO_HISTORY_BYTES, budget * 1048576);
    input.value = String(maxTextureBytes / 1048576);
    updateLayer();
  };
  getElement<HTMLInputElement>('#vv-static').oninput = event => {
    staticPixelRemoval = Number((event.target as HTMLInputElement).value);
    updateLayer();
  };
  getElement<HTMLInputElement>('#vv-file').onchange = event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) selectVideo(file);
  };
  playButton.onclick = () => setPlaying(!playing);
  getElement('#vv-sample').onclick = () => selectVideo(sampleVideo);
  backendButtons.forEach(button => {
    button.onclick = () => void switchBackend(button.dataset.backendOption as 'webgl' | 'webgpu');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    button.onclick = () => {
      const preset = button.dataset.view;
      cameraTarget = {
        ...INITIAL_VIEW,
        minRotationX: -65,
        maxRotationX: 65,
        minZoom: 4,
        maxZoom: 10,
        rotationX: preset === 'volume' ? 22 : 0,
        rotationOrbit: preset === 'front' ? 0 : preset === 'side' ? 82 : -38
      };
    };
  });

  function animate(now: number) {
    const movingCamera = interacting || !isCameraSettled(viewState, cameraTarget);
    if (!isCameraSettled(viewState, cameraTarget)) {
      viewState = dampCamera(viewState, cameraTarget, now - lastAnimationTime);
      deck?.setProps({viewState: {volume: viewState}});
    }
    // Hold the same video frame while orbiting, including the damping tail.
    // Shift the playback clock by the held duration so resuming does not jump ahead.
    if (playing && movingCamera) playbackStart += now - lastAnimationTime;
    lastAnimationTime = now;
    if (playing && info && !pending && !movingCamera) {
      const time = (playbackTime + (now - playbackStart) / 1000) % info.duration;
      // Source timestamps also support variable-frame-rate videos.
      let low = 0;
      let high = info.frameCount;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (info.frameTimestamps[middle] <= time) low = middle + 1;
        else high = middle;
      }
      const next = Math.max(0, low - 1);
      if (next !== currentFrame) {
        currentFrame = next;
        updateLayer();
      }
    }
    animation = requestAnimationFrame(animate);
  }

  async function supportsWebGPU(): Promise<boolean> {
    try {
      return Boolean(await (navigator as WebGPUNavigator).gpu?.requestAdapter());
    } catch {
      // A browser can expose navigator.gpu while adapter allocation is disabled.
      return false;
    }
  }

  async function switchBackend(backend: 'webgl' | 'webgpu') {
    if (options.device || destroyed || backendSwitching || backend === requestedBackend) return;
    backendSwitching = true;
    requestedBackend = backend;
    const requestGeneration = ++backendRequestGeneration;
    syncBackendControls();
    try {
      if (backend === 'webgpu' && !(await supportsWebGPU())) {
        if (destroyed || requestGeneration !== backendRequestGeneration) return;
        requestedBackend = useWebGPU ? 'webgpu' : 'webgl';
        errorOutput.textContent = 'WebGPU is unavailable in this browser. Continuing with WebGL2.';
        return;
      }
      if (destroyed || requestGeneration !== backendRequestGeneration) return;
      setPlaying(false);
      preserveVideoState = true;
      pending = true;
      delete root.dataset.frameReady;
      playButton.disabled = true;
      status.textContent = 'Switching graphics backend…';
      deck?.finalize();
      deck = undefined;
      useWebGPU = backend === 'webgpu';
      backendOutput.textContent = 'SWITCHING…';
      const generation = ++deckGeneration;
      deck = createDeck(useWebGPU, generation);
      options.onDeckInitialized?.(deck as Deck<OrbitView>);
      const url = new URL(window.location.href);
      url.searchParams.set('backend', backend);
      window.history.replaceState({}, '', url);
      updateLayer();
      if (!animation) animation = requestAnimationFrame(animate);
    } catch (error) {
      preserveVideoState = false;
      errorOutput.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      backendSwitching = false;
      syncBackendControls();
    }
  }

  async function initializeDeck() {
    const requestGeneration = ++backendRequestGeneration;
    if (!options.device && requestedBackend === 'webgpu' && !(await supportsWebGPU())) {
      if (destroyed || requestGeneration !== backendRequestGeneration) return;
      requestedBackend = 'webgl';
    }
    if (destroyed || requestGeneration !== backendRequestGeneration) return;
    useWebGPU = requestedBackend === 'webgpu';
    const generation = ++deckGeneration;
    deck = createDeck(useWebGPU, generation);
    options.onDeckInitialized?.(deck as Deck<OrbitView>);
    updateLayer();
    if (!animation) animation = requestAnimationFrame(animate);
  }
  // Keep the file picker live while WebGPU capability detection is in flight.
  // initializeDeck renders whichever source is current when the device is ready.
  selectVideo(sampleVideo);
  syncBackendControls();
  void initializeDeck();
  return () => {
    destroyed = true;
    backendRequestGeneration++;
    deckGeneration++;
    cancelAnimationFrame(animation);
    deck?.finalize();
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    root.remove();
  };
}
