// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, GlobeView, type GlobeViewState, type PickingInfo} from '@deck.gl/core';
import {GeoJsonLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {
  classifyOrbit,
  createSatRec,
  OrbitLayer,
  parseGpRecords,
  toGpRecords,
  type OrbitLayerData,
  type OrbitSatellite
} from '@deck.gl-community/layers/space-layers';

import fixture from './data/gp-fixture.omm.json';

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
  setPlaying: (playing: boolean) => void;
};

export type SatelliteStats = {
  /** Satellites that SGP4 accepted in the current data. */
  count: number;
  /** Element sets that SGP4 rejected. */
  rejected: number;
};

const DEFAULT_SPEED = 60;
const DEFAULT_FAR_Z_MULTIPLIER = 8;
const CACHE_TTL_MS = 2 * 3600 * 1000;
const LAND_URL =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_scale_rank.geojson';

const ISS_NORAD_ID = 25544;

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

type Dataset = {
  generation: number;
  /** A URL, OMM JSON text, TLE text or OMM rows. The same value on each frame. */
  data: OrbitLayerData;
  /** NORAD id of the first GEO satellite; `null` when the data has none. */
  geoNoradId: number | null;
};

/** The `data` of the layer before a load ends. The same array on each frame: no reload. */
const NO_DATA: OrbitLayerData = [];

/** Mounts the satellite orbits example. Returns a cleanup function. */
export function mountSatelliteOrbitsExample(
  container: HTMLElement,
  props: SatelliteOrbitsExampleProps = {}
): () => void {
  const clock = createClock(props.speed ?? DEFAULT_SPEED);
  const stats: SatelliteStats = {count: 0, rejected: 0};
  let generation = 0;
  let dataset: Dataset | null = null;
  let selectedNoradId: number | null = props.selectNoradId ?? null;
  let selectedPosition: [number, number, number] | null = null;
  /** Zoom to apply when the selected satellite reports its position, after a View button. */
  let flyToZoom: number | null = null;
  let follow = Boolean(props.follow);
  let viewState: GlobeViewState = {...INITIAL_VIEW_STATE, ...props.initialViewState};
  let animationFrame = 0;
  let disposed = false;

  container.style.position = 'relative';
  container.style.background = '#05070d';
  const panel = createPanel(container, props, {
    onGroupChange: (group, format) => loadGroup(group, format),
    onSpeedChange: speed => clock.setSpeed(speed),
    onPlayingChange: playing => clock.setPlaying(playing),
    onSeek: offsetHours => clock.set(clock.originMs + offsetHours * 3600 * 1000),
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
      const satellite = info.layer?.id === 'orbits' ? (info.object as OrbitSatellite) : null;
      selectedNoradId = satellite?.noradId ?? null;
      selectedPosition = null;
      flyToZoom = null;
    },
    layers: []
  });

  loadGroup(props.group ?? 'fixture', props.format ?? 'json');
  animationFrame = requestAnimationFrame(renderFrame);
  props.onReady?.({deck, stats, setPlaying: playing => clock.setPlaying(playing)});

  async function loadGroup(group: string, format: GpFormat): Promise<void> {
    const loadGeneration = ++generation;
    const isCurrent = () => !disposed && loadGeneration === generation;
    dataset = null;
    flyToZoom = null;
    stats.count = stats.rejected = 0;
    selectedNoradId = props.selectNoradId ?? null;
    selectedPosition = null;
    panel.setStatus(`Loading ${group}...`);
    try {
      const data = await loadData(group, format, isCurrent);
      if (!isCurrent() || !data) return;
      const geoNoradId = await findGeoNoradId(data);
      if (!isCurrent()) return;
      clock.setOrigin(group === 'fixture' ? getMedianEpochMs(fixture) : Date.now());
      dataset = {generation: loadGeneration, data, geoNoradId};
      panel.setGeoAvailable(geoNoradId !== null);
    } catch (error) {
      if (isCurrent()) {
        panel.setStatus(`Could not load ${group}: ${(error as Error).message}`);
      }
    }
  }

  function renderFrame(): void {
    animationFrame = requestAnimationFrame(renderFrame);
    const timeMs = clock.now();
    panel.setTime(timeMs);
    if (selectedPosition && (follow || flyToZoom !== null)) {
      viewState = {
        ...viewState,
        longitude: selectedPosition[0],
        latitude: selectedPosition[1],
        position: [0, 0, selectedPosition[2]],
        ...(flyToZoom !== null && {zoom: flyToZoom})
      };
      flyToZoom = null;
    }
    deck.setProps({viewState, layers: getLayers(timeMs)});
  }

  function getLayers(timeMs: number) {
    const current = dataset;
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
      new OrbitLayer({
        id: 'orbits',
        data: current?.data ?? NO_DATA,
        currentTime: timeMs,
        selectedNoradId,
        showOrbit: props.showTracks !== false,
        showGroundTrack: props.showTracks !== false,
        getColor: (d: OrbitSatellite) => [...CLASS_COLORS[d.orbitClass], 230],
        pickable: true,
        onDataLoad: ({satellites, rejected}) => {
          // The layer drops the data of older loads. This also drops a callback of a replaced one.
          if (disposed || !current || current.generation !== generation) return;
          stats.count = satellites;
          stats.rejected = rejected;
          panel.setStatus(`${satellites} satellites`);
        },
        onSelectedPositionChange: position => {
          selectedPosition = position;
        },
        onError: error => {
          panel.setStatus(`Could not draw the data: ${error.message}`);
          return true;
        }
      })
    ];
  }

  function getTooltip(info: PickingInfo): string | null {
    const satellite = info.layer?.id === 'orbits' ? (info.object as OrbitSatellite | null) : null;
    if (!satellite?.position) return null;
    return [
      satellite.name,
      `NORAD ${satellite.noradId} (${satellite.orbitClass})`,
      `Altitude ${(satellite.position[2] / 1000).toFixed(0)} km`,
      `Speed ${satellite.speedKmS.toFixed(2)} km/s`,
      `Period ${satellite.periodMinutes.toFixed(1)} min`
    ].join('\n');
  }

  function flyTo(target: 'iss' | 'geo' | 'all'): void {
    if (target === 'all') {
      follow = false;
      panel.setFollow(false);
      flyToZoom = null;
      viewState = {...INITIAL_VIEW_STATE};
      return;
    }
    // The layer reports the position of the selected satellite on its next update.
    const noradId = target === 'iss' ? ISS_NORAD_ID : dataset?.geoNoradId;
    if (noradId == null) return;
    selectedNoradId = noradId;
    selectedPosition = null;
    flyToZoom = target === 'iss' ? 4 : 0;
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    deck.finalize();
    panel.element.remove();
  };
}

/** Finds the first GEO satellite, once per data load, for the GEO button. */
async function findGeoNoradId(data: OrbitLayerData): Promise<number | null> {
  const records =
    typeof data === 'string'
      ? await parseGpRecords(data, /^\s*[[{]/.test(data) ? 'json' : 'tle')
      : toGpRecords(data);
  const geo = records.find(record => {
    const satrec = createSatRec(record);
    return satrec !== null && classifyOrbit(satrec) === 'GEO';
  });
  return geo?.noradId ?? null;
}

/** The median element set epoch of the fixture, so that it stays accurate offline. */
function getMedianEpochMs(rows: {EPOCH: string}[]): number {
  const epochs = rows.map(row => Date.parse(`${row.EPOCH}Z`)).sort((a, b) => a - b);
  return epochs[epochs.length >> 1];
}

async function loadData(
  group: string,
  format: GpFormat,
  isCurrent: () => boolean
): Promise<OrbitLayerData | null> {
  if (group === 'fixture') {
    return fixture as OrbitLayerData;
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
  }
  // The layer parses the text: OMM JSON or TLE.
  return isCurrent() ? text : null;
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

type GpFormat = 'json' | 'tle';

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
      ${(Object.keys(CLASS_COLORS) as (keyof typeof CLASS_COLORS)[]).map(c => `<span style="color:rgb(${CLASS_COLORS[c]})">&#9679; ${c}</span>`).join(' ')}
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

  const geoButton = get<HTMLButtonElement>('geo');
  const status = get<HTMLSpanElement>('status');
  const time = get<HTMLDivElement>('time');
  return {
    element,
    setStatus: (text: string) => {
      status.textContent = text;
    },
    setGeoAvailable: (available: boolean) => {
      geoButton.disabled = !available;
      geoButton.title = available ? '' : 'No GEO satellite in this data';
    },
    setFollow: (value: boolean) => {
      follow.checked = value;
    },
    setTime: (timeMs: number) => {
      time.textContent = `${new Date(timeMs).toISOString().slice(0, 19)}Z`;
    }
  };
}
