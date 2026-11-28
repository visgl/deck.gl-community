// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, GlobeView, type GlobeViewState, type PickingInfo} from '@deck.gl/core';
import {GeoJsonLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {gstime, type SatRec} from 'satellite.js';

import fixture from './data/gp-fixture.omm.json';
import {createSatRec, type GpFormat, type GpRecord} from './gp-records';
import {parseGpRecords} from './load-gp-records';
import {
  getGroundTrack,
  getOrbitPath,
  interpolateLngLatAlt,
  ORBIT_CLASSES,
  propagateToLngLatAlt
} from './orbit-math';
import type {WorkerRequest, WorkerResponse} from './propagation-worker';

/** CelesTrak GP groups offered in the data menu. `fixture` is the checked-in sample. */
export const DATA_GROUPS = ['fixture', 'stations', 'gps-ops', 'galileo', 'geo', 'active'];

export type SatelliteOrbitsExampleProps = {
  /** `fixture` (offline sample) or a CelesTrak GP group name. Default `fixture`. */
  group?: string;
  /** CelesTrak format for live groups. Default `json` (OMM). */
  format?: 'json' | 'tle';
  /** Simulation speed (simulated seconds per second). Default `60`. */
  speed?: number;
  /** NORAD catalog id of the satellite to select at start. */
  selectNoradId?: number;
  /** Keep the camera on the selected satellite. */
  follow?: boolean;
  /** Draw the orbit and the ground track of the selected satellite. Default `true`. */
  showTracks?: boolean;
  initialViewState?: Partial<GlobeViewState>;
  /** Keep the GlobeView default back-face culling on the orbit path, to show its effect. */
  cullPaths?: boolean;
  /** Passed to `GlobeView`, to test the far plane. */
  farZMultiplier?: number;
  /** Extra `GlobeView` props, e.g. `{_cameraRelative: true}` with a local deck.gl build. */
  viewProps?: Record<string, unknown>;
  /** Called once the deck exists, for measurements. */
  onReady?: (handle: SatelliteOrbitsHandle) => void;
};

/** Measurement access to a mounted example. */
export type SatelliteOrbitsHandle = {
  deck: Deck<GlobeView>;
  stats: SatelliteStats;
  /** Current interpolated `[lng, lat, alt]` of a satellite, by NORAD id. */
  getPosition: (noradId: number) => number[] | null;
  setPlaying: (playing: boolean) => void;
};

export type SatelliteStats = {
  count: number;
  initMs: number;
  lastPropagateMs: number;
  propagateCount: number;
  propagateTotalMs: number;
};

const UPDATE_INTERVAL_MS = 200;
const DEFAULT_SPEED = 60;
const DEFAULT_FAR_Z_MULTIPLIER = 8;
const CACHE_TTL_MS = 2 * 3600 * 1000;
const LAND_URL =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_scale_rank.geojson';

const CLASS_COLORS: Record<string, [number, number, number]> = {
  LEO: [80, 200, 255],
  MEO: [120, 230, 120],
  GEO: [255, 170, 60],
  HEO: [240, 100, 220]
};

const INITIAL_VIEW_STATE: GlobeViewState = {
  longitude: -40,
  latitude: 20,
  zoom: -0.6,
  minZoom: -3,
  maxZoom: 20
};

/**
 * The globe surface as 5 degree cells. One polygon for the whole world is drawn with large flat
 * triangles that cut through the sphere, so it does not hide what is behind the Earth.
 */
const EARTH_CELLS: number[][][] = [];
for (let lng = -180; lng < 180; lng += 5) {
  for (let lat = -90; lat < 90; lat += 5) {
    EARTH_CELLS.push([
      [lng, lat],
      [lng + 5, lat],
      [lng + 5, lat + 5],
      [lng, lat + 5]
    ]);
  }
}

type Sample = {timeMs: number; positions: Float64Array; speedsKmS: Float32Array};

type Dataset = {
  generation: number;
  records: GpRecord[];
  satrecs: (SatRec | null)[];
  colors: Uint8Array;
  periodsMinutes: Float32Array;
  orbitClasses: Uint8Array;
};

/** Mounts the satellite orbits example. Returns a cleanup function. */
export function mountSatelliteOrbitsExample(
  container: HTMLElement,
  props: SatelliteOrbitsExampleProps = {}
): () => void {
  const clock = createClock(props.speed ?? DEFAULT_SPEED);
  const stats: SatelliteStats = {
    count: 0,
    initMs: 0,
    lastPropagateMs: 0,
    propagateCount: 0,
    propagateTotalMs: 0
  };
  let generation = 0;
  let pendingDataset: {records: GpRecord[]; originMs: number} | null = null;
  let dataset: Dataset | null = null;
  let previous: Sample | null = null;
  let latest: Sample | null = null;
  let current = new Float64Array(0);
  let selectedIndex = -1;
  let orbitPath: number[][] = [];
  let groundTrack: number[][] = [];
  let requestId = 0;
  let pendingRequest = false;
  let resetOnNextSample = true;
  let follow = Boolean(props.follow);
  let viewState: GlobeViewState = {...INITIAL_VIEW_STATE, ...props.initialViewState};
  let animationFrame = 0;
  let disposed = false;

  container.style.position = 'relative';
  container.style.background = '#05070d';
  const panel = createPanel(container, props, {
    onGroupChange: (group, format) => loadGroup(group, format),
    onSpeedChange: speed => {
      clock.setSpeed(speed);
      requestNow();
    },
    onPlayingChange: playing => clock.setPlaying(playing),
    onSeek: offsetHours => {
      clock.set(clock.originMs + offsetHours * 3600 * 1000);
      requestNow();
    },
    onFollowChange: value => {
      follow = value;
    },
    onFlyTo: target => flyTo(target)
  });

  const deck = new Deck<GlobeView>({
    parent: container as HTMLDivElement,
    views: new GlobeView({
      id: 'globe',
      controller: true,
      // The default far plane (1) clips the far half of the GEO ring; see the README.
      farZMultiplier: props.farZMultiplier ?? DEFAULT_FAR_Z_MULTIPLIER,
      ...props.viewProps
    } as ConstructorParameters<typeof GlobeView>[0]),
    viewState,
    onViewStateChange: ({viewState: next}) => {
      viewState = next as GlobeViewState;
    },
    getTooltip: info => getTooltip(info),
    onClick: info => {
      selectedIndex = info.layer?.id === 'satellites' ? info.index : -1;
      updateTracks();
    },
    layers: []
  });

  const worker = new Worker(new URL('./propagation-worker.ts', import.meta.url), {type: 'module'});
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => onWorkerMessage(event.data);

  const timer = setInterval(requestAhead, UPDATE_INTERVAL_MS);
  loadGroup(props.group ?? 'fixture', props.format ?? 'json');
  animationFrame = requestAnimationFrame(renderFrame);
  props.onReady?.({deck, stats, getPosition, setPlaying: playing => clock.setPlaying(playing)});

  async function loadGroup(group: string, format: GpFormat): Promise<void> {
    const loadGeneration = ++generation;
    const isCurrent = () => !disposed && loadGeneration === generation;
    pendingDataset = null;
    panel.setStatus(`Loading ${group}...`);
    try {
      const records = await loadRecords(group, format, isCurrent);
      if (!isCurrent() || !records) return;
      // The fixture runs at its median epoch, so that it stays accurate offline.
      const epochs = records.map(record => record.epochMs).sort((a, b) => a - b);
      const originMs = group === 'fixture' ? epochs[epochs.length >> 1] : Date.now();
      pendingDataset = {records, originMs};
      postToWorker({type: 'init', generation: loadGeneration, records});
    } catch (error) {
      if (isCurrent()) {
        panel.setStatus(`Could not load ${group}: ${(error as Error).message}`);
      }
    }
  }

  function onWorkerMessage(message: WorkerResponse): void {
    if (disposed || message.generation !== generation) return;
    if (message.type === 'ready') {
      if (!pendingDataset) return;
      const {records: loadedRecords, originMs} = pendingDataset;
      pendingDataset = null;
      // Keep only the records that SGP4 accepted, in worker order.
      const records = Array.from(message.recordIndices, index => loadedRecords[index]);
      dataset = {
        generation: message.generation,
        records,
        satrecs: records.map(() => null),
        colors: Uint8Array.from(
          Array.from(message.orbitClasses).flatMap(c => [...CLASS_COLORS[ORBIT_CLASSES[c]], 230])
        ),
        periodsMinutes: message.periodsMinutes,
        orbitClasses: message.orbitClasses
      };
      stats.count = records.length;
      stats.initMs = message.initMs;
      current = new Float64Array(records.length * 3);
      clock.setOrigin(originMs);
      previous = latest = null;
      selectedIndex = props.selectNoradId
        ? records.findIndex(record => record.noradId === props.selectNoradId)
        : -1;
      updateTracks();
      panel.setStatus(`${records.length} satellites`);
      requestNow();
      return;
    }
    if (message.requestId !== requestId) return;
    pendingRequest = false;
    if (message.positions.length !== current.length) return;
    stats.lastPropagateMs = message.propagateMs;
    stats.propagateCount++;
    stats.propagateTotalMs += message.propagateMs;
    const sample = {
      timeMs: message.timeMs,
      positions: message.positions,
      speedsKmS: message.speedsKmS
    };
    previous = resetOnNextSample || !latest ? sample : latest;
    latest = sample;
    resetOnNextSample = false;
    updateTracks();
  }

  /** Asks the worker for the positions at the simulated time of the next update. */
  function requestAhead(): void {
    if (dataset?.generation !== generation || pendingRequest) return;
    const timeMs = clock.at(performance.now() + UPDATE_INTERVAL_MS);
    if (latest && timeMs === latest.timeMs) return;
    pendingRequest = true;
    postToWorker({type: 'propagate', requestId: ++requestId, timeMs});
  }

  /** Drops the old samples and asks for the current time, after a seek or speed change. */
  function requestNow(): void {
    if (dataset?.generation !== generation) return;
    resetOnNextSample = true;
    pendingRequest = true;
    postToWorker({type: 'propagate', requestId: ++requestId, timeMs: clock.now()});
  }

  function postToWorker(message: WorkerRequest): void {
    worker.postMessage(message);
  }

  function renderFrame(): void {
    animationFrame = requestAnimationFrame(renderFrame);
    const timeMs = clock.now();
    if (previous && latest) {
      const span = latest.timeMs - previous.timeMs;
      const t = span > 0 ? Math.min(Math.max((timeMs - previous.timeMs) / span, 0), 1) : 1;
      interpolateLngLatAlt(previous.positions, latest.positions, t, current);
    }
    panel.setTime(timeMs, stats);
    if (follow && selectedIndex >= 0 && latest) {
      const i = selectedIndex * 3;
      viewState = {
        ...viewState,
        longitude: current[i],
        latitude: current[i + 1],
        position: [0, 0, current[i + 2]]
      };
    }
    deck.setProps({viewState, layers: getLayers()});
  }

  function getLayers() {
    const count = latest && dataset ? dataset.records.length : 0;
    const selected =
      selectedIndex >= 0 && count
        ? [current.subarray(selectedIndex * 3, selectedIndex * 3 + 3)]
        : [];
    return [
      new SolidPolygonLayer({
        id: 'earth',
        data: EARTH_CELLS,
        getPolygon: d => d,
        getFillColor: [18, 32, 58]
      }),
      new GeoJsonLayer({
        id: 'land',
        data: LAND_URL,
        stroked: false,
        getFillColor: [44, 62, 80],
        onError: () => true
      }),
      new PathLayer({
        id: 'ground-track',
        data: groundTrack.length ? [groundTrack] : [],
        getPath: d => d,
        getColor: [255, 230, 120, 200],
        getWidth: 1.5,
        widthUnits: 'pixels'
      }),
      new PathLayer({
        id: 'orbit',
        data: orbitPath.length ? [orbitPath] : [],
        getPath: d => d,
        getColor: [255, 255, 255, 220],
        getWidth: 1.5,
        widthUnits: 'pixels',
        // GlobeView culls back faces by default. That drops the far half of a path in space.
        parameters: props.cullPaths ? {} : {cullMode: 'none'}
      }),
      new ScatterplotLayer({
        id: 'satellites',
        data: {
          length: count,
          attributes: {
            getPosition: {value: current, size: 3},
            getFillColor: {value: dataset?.colors ?? new Uint8Array(0), size: 4, normalized: true}
          }
        },
        billboard: true,
        radiusUnits: 'pixels',
        getRadius: count > 2000 ? 1.5 : 3,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 255]
      }),
      new ScatterplotLayer({
        id: 'selected',
        data: selected,
        getPosition: d => d as unknown as [number, number, number],
        billboard: true,
        radiusUnits: 'pixels',
        getRadius: 8,
        filled: false,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        getLineColor: [255, 255, 255]
      })
    ];
  }

  function updateTracks(): void {
    if (!dataset || selectedIndex < 0 || !latest || props.showTracks === false) {
      orbitPath = groundTrack = [];
      return;
    }
    const satrec = getSatRec(selectedIndex);
    const date = new Date(latest.timeMs);
    orbitPath = satrec ? getOrbitPath(satrec, date) : [];
    groundTrack = satrec ? getGroundTrack(satrec, date) : [];
  }

  function getSatRec(index: number): SatRec | null {
    if (!dataset) return null;
    dataset.satrecs[index] ??= createSatRec(dataset.records[index]);
    return dataset.satrecs[index];
  }

  function getTooltip(info: PickingInfo): string | null {
    if (info.layer?.id !== 'satellites' || info.index < 0 || !dataset || !latest) return null;
    const record = dataset.records[info.index];
    const altitudeKm = current[info.index * 3 + 2] / 1000;
    const speed = latest.speedsKmS[info.index];
    const period = dataset.periodsMinutes[info.index];
    const orbitClass = ORBIT_CLASSES[dataset.orbitClasses[info.index]];
    return [
      record.name,
      `NORAD ${record.noradId} (${orbitClass})`,
      `Altitude ${altitudeKm.toFixed(0)} km`,
      `Speed ${speed.toFixed(2)} km/s`,
      `Period ${period.toFixed(1)} min`
    ].join('\n');
  }

  function getPosition(noradId: number): number[] | null {
    const index = dataset?.records.findIndex(record => record.noradId === noradId) ?? -1;
    return index >= 0 && latest ? Array.from(current.subarray(index * 3, index * 3 + 3)) : null;
  }

  function flyTo(target: 'iss' | 'geo' | 'all'): void {
    if (target === 'all') {
      follow = false;
      panel.setFollow(false);
      viewState = {...INITIAL_VIEW_STATE};
      return;
    }
    if (!dataset) return;
    const index =
      target === 'iss'
        ? dataset.records.findIndex(record => record.noradId === 25544)
        : dataset.orbitClasses.indexOf(ORBIT_CLASSES.indexOf('GEO'));
    if (index < 0) return;
    selectedIndex = index;
    updateTracks();
    // Place the camera from the elements, so that this works before the first sample.
    const satrec = getSatRec(index);
    const position = new Float64Array(3);
    const date = new Date(clock.now());
    if (satrec) propagateToLngLatAlt(satrec, date, gstime(date), position, 0);
    viewState = {
      ...viewState,
      longitude: position[0],
      latitude: position[1],
      zoom: target === 'iss' ? 4 : 0,
      position: [0, 0, position[2]]
    };
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    clearInterval(timer);
    worker.terminate();
    deck.finalize();
    panel.element.remove();
  };
}

async function loadRecords(
  group: string,
  format: GpFormat,
  isCurrent: () => boolean
): Promise<GpRecord[] | null> {
  if (group === 'fixture') {
    return parseGpRecords(JSON.stringify(fixture), 'json');
  }
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=${format}`;
  // CelesTrak updates GP data every 2 hours and blocks repeated downloads, so cache the text.
  const cacheKey = `celestrak:${group}:${format}`;
  let text = readCache(cacheKey);
  if (!text) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    text = await response.text();
    // Keep a late download: CelesTrak asks for one request per group and update interval.
    writeCache(cacheKey, text);
    if (!isCurrent()) return null;
  }
  const records = await parseGpRecords(text, format);
  return isCurrent() ? records : null;
}

function readCache(key: string): string | null {
  try {
    const entry = JSON.parse(localStorage.getItem(key) ?? 'null');
    return entry && Date.now() - entry.time < CACHE_TTL_MS ? entry.text : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, text: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({time: Date.now(), text}));
  } catch {
    // Large groups do not fit in localStorage. The example still works without the cache.
  }
}

/** A simulation clock: simulated time runs at `speed` times wall time. */
function createClock(initialSpeed: number) {
  let anchorWallMs = performance.now();
  let anchorSimMs = Date.now();
  let speed = initialSpeed;
  let playing = true;
  const clock = {
    originMs: anchorSimMs,
    at: (wallMs: number) => anchorSimMs + (playing ? (wallMs - anchorWallMs) * speed : 0),
    now: () => clock.at(performance.now()),
    set: (simMs: number) => {
      anchorWallMs = performance.now();
      anchorSimMs = simMs;
    },
    setOrigin: (simMs: number) => {
      clock.originMs = simMs;
      clock.set(simMs);
    },
    setSpeed: (value: number) => {
      clock.set(clock.now());
      speed = value;
    },
    setPlaying: (value: boolean) => {
      clock.set(clock.now());
      playing = value;
    }
  };
  return clock;
}

type PanelCallbacks = {
  onGroupChange: (group: string, format: GpFormat) => void;
  onSpeedChange: (speed: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (offsetHours: number) => void;
  onFollowChange: (follow: boolean) => void;
  onFlyTo: (target: 'iss' | 'geo' | 'all') => void;
};

function createPanel(
  container: HTMLElement,
  props: SatelliteOrbitsExampleProps,
  callbacks: PanelCallbacks
) {
  const element = document.createElement('div');
  element.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:1;padding:10px 12px;width:260px;' +
    'font:12px/1.6 system-ui,sans-serif;color:#e8eef7;background:rgba(10,14,24,0.85);' +
    'border-radius:6px;';
  const speeds = [1, 10, 60, 300, 1000];
  element.innerHTML = `
    <div><b>Satellites</b> <span data-id="status"></span></div>
    <div>Data <select data-id="group">${DATA_GROUPS.map(g => `<option>${g}</option>`).join('')}</select>
      <select data-id="format"><option value="json">OMM JSON</option><option value="tle">TLE</option></select></div>
    <div>Speed <select data-id="speed">${speeds.map(s => `<option value="${s}">${s}x</option>`).join('')}</select>
      <label><input type="checkbox" data-id="playing" checked> play</label>
      <label><input type="checkbox" data-id="follow"> follow</label></div>
    <div>Time <input type="range" data-id="seek" min="-12" max="12" step="0.1" value="0" style="width:170px"></div>
    <div data-id="time"></div>
    <div>View <button data-id="all">All</button> <button data-id="iss">ISS</button>
      <button data-id="geo">GEO</button></div>
    <div style="opacity:0.7">
      ${ORBIT_CLASSES.map(c => `<span style="color:rgb(${CLASS_COLORS[c]})">&#9679; ${c}</span>`).join(' ')}
      <br>Data: <a style="color:inherit" href="https://celestrak.org">CelesTrak</a></div>`;
  container.appendChild(element);
  const get = <T extends HTMLElement>(id: string) =>
    element.querySelector(`[data-id="${id}"]`) as T;

  const group = get<HTMLSelectElement>('group');
  const format = get<HTMLSelectElement>('format');
  const speed = get<HTMLSelectElement>('speed');
  const follow = get<HTMLInputElement>('follow');
  group.value = props.group ?? 'fixture';
  format.value = props.format ?? 'json';
  speed.value = String(props.speed ?? DEFAULT_SPEED);
  follow.checked = Boolean(props.follow);
  const onGroup = () => callbacks.onGroupChange(group.value, format.value as 'json' | 'tle');
  group.onchange = onGroup;
  format.onchange = onGroup;
  speed.onchange = () => callbacks.onSpeedChange(Number(speed.value));
  get<HTMLInputElement>('playing').onchange = event =>
    callbacks.onPlayingChange((event.target as HTMLInputElement).checked);
  follow.onchange = () => callbacks.onFollowChange(follow.checked);
  get<HTMLInputElement>('seek').oninput = event =>
    callbacks.onSeek(Number((event.target as HTMLInputElement).value));
  for (const target of ['all', 'iss', 'geo'] as const) {
    get<HTMLButtonElement>(target).onclick = () => callbacks.onFlyTo(target);
  }

  const status = get<HTMLSpanElement>('status');
  const time = get<HTMLDivElement>('time');
  return {
    element,
    setStatus: (text: string) => {
      status.textContent = text;
    },
    setFollow: (value: boolean) => {
      follow.checked = value;
    },
    setTime: (timeMs: number, stats: SatelliteStats) => {
      time.textContent = `${new Date(timeMs).toISOString().slice(0, 19)}Z, SGP4 ${stats.lastPropagateMs.toFixed(1)} ms`;
    }
  };
}
