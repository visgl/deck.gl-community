// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {TreeLayer} from '@deck.gl-community/layers';
import {ReferenceMeshTreeLayer} from './baseline/reference-mesh-tree-layer';
import {DEFAULT_OPTIONS, VIEW, createSpecimens, createSceneLayers, createLighting} from './scene';
import {getTourFrame, FILM_DURATION} from './tour';
import './style.css';

/** Record actual paired deck.gl canvases; one frame clock drives every visual input. */
export async function mountTreeFilm(container: HTMLElement) {
  container.innerHTML = `<main class="tree-lab film"><header><div class="eyebrow">vis.gl / Tree Lab</div><h1>Eight trees. Four seasons. One moving sun.</h1><p>Matched cameras and sunlight. Highest-detail mesh canopy on the left; anisotropic Gaussian leaves on the right. Matched GPU wind.</p></header><canvas id="film" width="1920" height="1080" aria-label="Animated mesh and Gaussian tree comparison"></canvas><div class="toolbar"><button id="play">Pause tour</button><button id="preview" disabled>Record 4-second preview</button><button id="record" disabled>Record ${FILM_DURATION}-second film</button><a href="./index.html">All specimens</a><output id="progress" aria-live="polite">Preparing both renderers…</output><a id="download" hidden>Download video</a></div><div class="film-sources" aria-hidden="true"><canvas width="880" height="800"></canvas><canvas width="880" height="800"></canvas></div></main>`;
  const output = container.querySelector<HTMLCanvasElement>('#film')!;
  const ctx = output.getContext('2d')!;
  const progress = container.querySelector<HTMLOutputElement>('#progress')!;
  const sourceCanvases = [...container.querySelectorAll<HTMLCanvasElement>('.film-sources canvas')];
  let disposed = false;
  let playing = true;
  let recording = false;
  let elapsed = 0;
  let previous = performance.now();
  let request = 0;
  let currentKey = '';
  let ready = 0;
  let liveRender: Promise<void> | undefined;
  let downloadUrl: string | undefined;
  const errors: string[] = [];
  const pending: (() => void)[] = [];
  const lights = [createLighting(true), createLighting(true)];
  const specimenSources = new Map<string, ReturnType<typeof createSpecimens>>();
  const getSpecimens = (species: Parameters<typeof createSpecimens>[0]) => {
    let data = specimenSources.get(species);
    if (!data) {
      data = createSpecimens(species);
      specimenSources.set(species, data);
    }
    return data;
  };
  const decks = sourceCanvases.map(
    (canvas, i) =>
      new Deck({
        canvas,
        width: 880,
        height: 800,
        useDevicePixels: 1,
        deviceProps: {
          type: 'webgl',
          adapters: [webgl2Adapter],
          webgl: {preserveDrawingBuffer: true}
        },
        views: new MapView({id: `film-${i}`}),
        viewState: {...VIEW, zoom: 21.5},
        layers: createSceneLayers(
          i ? TreeLayer : ReferenceMeshTreeLayer,
          `film-${i}`,
          getSpecimens('pine'),
          {...DEFAULT_OPTIONS, shadows: true}
        ),
        effects: [lights[i]],
        onLoad: () => {
          ready++;
        },
        onAfterRender: () => {
          pending[i]?.();
          pending[i] = undefined;
        },
        onError: error => {
          errors.push(error.message);
          progress.textContent = error.message;
        }
      })
  );
  const draw = (seconds: number) => {
    const frame = getTourFrame(seconds, true);
    ctx.fillStyle = '#f4f5ee';
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#647961';
    ctx.font = '600 19px system-ui';
    ctx.fillText('VIS.GL / TREE LAB', 60, 53);
    ctx.fillStyle = '#233c2c';
    ctx.font = '650 54px system-ui';
    ctx.fillText(frame.species[0].toUpperCase() + frame.species.slice(1), 60, 121);
    ctx.font = '500 28px system-ui';
    ctx.fillText(frame.season[0].toUpperCase() + frame.season.slice(1), 1490, 94);
    ctx.font = '19px system-ui';
    ctx.fillStyle = '#647961';
    ctx.fillText('A year in motion', 1490, 126);
    for (let i = 0; i < 2; i++) {
      const x = 60 + i * 920;
      ctx.fillStyle = '#e2e7de';
      ctx.fillRect(x, 180, 880, 800);
      ctx.drawImage(sourceCanvases[i], x, 180, 880, 800);
      ctx.fillStyle = i ? '#233c2c' : '#e7ecdf';
      ctx.fillRect(x + 20, 204, i ? 306 : 316, 47);
      ctx.fillStyle = i ? '#ffffff' : '#435a43';
      ctx.font = '600 22px system-ui';
      ctx.fillText(i ? 'GAUSSIAN / VIS.GL' : 'MESH / VIS.GL', x + 36, 235);
      ctx.fillStyle = '#eaf0e4';
      ctx.fillRect(x + 20, 919, 836, 40);
      ctx.fillStyle = '#435a43';
      ctx.font = '18px system-ui';
      ctx.fillText(
        i
          ? 'Gaussian foliage · covariance bends in the wind'
          : frame.species === 'banyan' || frame.species === 'mangrove' || frame.species === 'citrus'
            ? 'Leaf-card mesh · shared growth, wood and wind'
            : 'Frozen native mesh · matched GPU wind',
        x + 35,
        945
      );
    }
    ctx.fillStyle = '#647961';
    ctx.font = '19px system-ui';
    ctx.fillText(
      'Same dimensions, camera and sunlight · WebGL shadows · illustrative supplied crops',
      60,
      1027
    );
    ctx.fillStyle = '#233c2c';
    ctx.font = '600 19px system-ui';
    ctx.fillText(
      `${Math.floor(seconds).toString().padStart(2, '0')} / ${FILM_DURATION}`,
      1742,
      1027
    );
    ctx.fillStyle = '#d1dccb';
    ctx.fillRect(60, 1050, 1800, 4);
    ctx.fillStyle = '#233c2c';
    ctx.fillRect(60, 1050, (1800 * (seconds % FILM_DURATION)) / FILM_DURATION, 4);
  };
  const render = async (seconds: number) => {
    if (errors.length) throw new Error(errors[0]);
    const frame = getTourFrame(seconds, true);
    const key = `${frame.species}/${frame.season}`;
    const promises = decks.map(
      (deck, i) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timed out waiting for paired GPU frames.')),
            10000
          );
          pending[i] = () => {
            clearTimeout(timeout);
            resolve();
          };
          lights[i].setSunDirection(frame.direction);
          deck.setProps({
            viewState: {...VIEW, zoom: 21.5, bearing: frame.cameraBearing},
            layers: createSceneLayers(
              i ? TreeLayer : ReferenceMeshTreeLayer,
              `film-${i}`,
              getSpecimens(frame.species),
              {
                ...DEFAULT_OPTIONS,
                season: frame.season,
                shadows: true,
                crops: frame.season !== 'winter',
                dropped: frame.season === 'autumn',
                wind: true,
                windTime: seconds
              }
            )
          });
        })
    );
    currentKey = key;
    await Promise.all(promises);
    if (disposed) return;
    draw(seconds);
  };
  const tick = async (now: number) => {
    if (disposed) return;
    if (!recording && playing && ready === 2) {
      elapsed = (elapsed + Math.min(0.1, (now - previous) / 1000)) % FILM_DURATION;
      try {
        liveRender = render(elapsed);
        await liveRender;
      } catch (error) {
        progress.textContent = String(error);
        playing = false;
      } finally {
        liveRender = undefined;
      }
    }
    previous = now;
    request = requestAnimationFrame(tick);
  };
  const startRecord = async (duration: number) => {
    if (recording || ready !== 2) return;
    recording = true;
    playing = false;
    for (const button of container.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = true;
    const totalFrames = duration * 30;
    let completedFrames = 0;
    let encoder: VideoEncoder | undefined;
    try {
      await liveRender;
      if (typeof VideoEncoder === 'undefined')
        throw new Error('This browser does not support frame-accurate video encoding.');
      const config: VideoEncoderConfig = {
        codec: 'vp09.00.40.08',
        width: 1920,
        height: 1080,
        bitrate: 10000000,
        framerate: 30,
        latencyMode: 'quality'
      };
      if (!(await VideoEncoder.isConfigSupported(config)).supported)
        throw new Error('This browser cannot encode the paired film.');
      const chunks = new Map<number, Uint8Array<ArrayBuffer>>();
      let encodingError: Error | undefined;
      encoder = new VideoEncoder({
        output(chunk) {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          chunks.set(Math.round((chunk.timestamp * 30) / 1000000), bytes);
        },
        error(error) {
          encodingError = error;
        }
      });
      encoder.configure(config);
      for (let frame = 0; frame < totalFrames; frame++) {
        if (disposed) throw new Error('Film renderer was closed.');
        if (encodingError) throw encodingError;
        await render(frame / 30);
        const videoFrame = new VideoFrame(output, {
          timestamp: Math.round((frame * 1000000) / 30),
          duration: Math.round(1000000 / 30)
        });
        try {
          encoder.encode(videoFrame, {keyFrame: frame % 90 === 0});
        } finally {
          videoFrame.close();
        }
        // Bound encoder memory without skipping frames when rendering or encoding is slow.
        if (encoder.encodeQueueSize >= 8) await encoder.flush();
        completedFrames++;
        progress.textContent = `Recording ${completedFrames}/${totalFrames} frames · ${currentKey}`;
      }
      await encoder.flush();
      if (encodingError) throw encodingError;
      if (chunks.size !== totalFrames)
        throw new Error(`Encoder returned ${chunks.size}/${totalFrames} frames.`);
      // IVF is a small, dependency-free VP9 interchange container, not a browser
      // capture stream. Integer presentation timestamps preserve every seasonal pose.
      // Layout: https://github.com/webmproject/libvpx/blob/main/ivfenc.c
      const header = new Uint8Array(32);
      header.set(new TextEncoder().encode('DKIF'));
      header.set(new TextEncoder().encode('VP90'), 8);
      const view = new DataView(header.buffer);
      view.setUint16(6, 32, true);
      view.setUint16(12, 1920, true);
      view.setUint16(14, 1080, true);
      view.setUint32(16, 30, true);
      view.setUint32(20, 1, true);
      view.setUint32(24, totalFrames, true);
      const parts: BlobPart[] = [header];
      for (let frame = 0; frame < totalFrames; frame++) {
        const bytes = chunks.get(frame);
        if (!bytes) throw new Error(`Encoder omitted frame ${frame}.`);
        const packet = new Uint8Array(12);
        const packetView = new DataView(packet.buffer);
        packetView.setUint32(0, bytes.length, true);
        packetView.setUint32(4, frame, true);
        parts.push(packet, bytes);
      }
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob(parts, {type: 'video/x-ivf'}));
      const link = container.querySelector<HTMLAnchorElement>('#download')!;
      link.href = downloadUrl;
      link.download = `tree-lab-${duration}s.ivf`;
      link.hidden = false;
      link.textContent = `Download ${duration}-second film`;
      progress.textContent = `Ready · ${completedFrames}/${totalFrames} paired and encoded frames · ${errors.length} rendering errors`;
    } catch (error) {
      progress.textContent = `Capture failed after ${completedFrames}/${totalFrames} frames: ${String(error)}`;
    } finally {
      if (encoder?.state !== 'closed') encoder?.close();
      recording = false;
      if (!disposed) {
        for (const button of container.querySelectorAll<HTMLButtonElement>('button'))
          button.disabled = false;
        container.querySelector<HTMLButtonElement>('#play')!.textContent = 'Play tour';
      }
    }
  };
  container.querySelector('#preview')!.addEventListener('click', () => {
    void startRecord(4);
  });
  container.querySelector('#record')!.addEventListener('click', () => {
    void startRecord(FILM_DURATION);
  });
  container.querySelector('#play')!.addEventListener('click', () => {
    playing = !playing;
    previous = performance.now();
    container.querySelector('#play')!.textContent = playing ? 'Pause tour' : 'Play tour';
  });
  const initializationDeadline = performance.now() + 10000;
  while (ready < 2 && !errors.length && performance.now() < initializationDeadline)
    await new Promise(resolve => setTimeout(resolve, 50));
  if (errors.length) throw new Error(errors[0]);
  if (ready < 2) throw new Error('Timed out initializing paired renderers.');
  await render(0);
  for (const button of container.querySelectorAll<HTMLButtonElement>('button'))
    button.disabled = false;
  progress.textContent =
    'Ready · live sunlight and seasonal tour · matched wind · connected trunk and branches';
  request = requestAnimationFrame(tick);
  return () => {
    disposed = true;
    cancelAnimationFrame(request);
    for (const deck of decks) deck.finalize();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    container.replaceChildren();
  };
}
