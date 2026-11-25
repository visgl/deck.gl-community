// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {readFileSync} from 'node:fs';
import {gstime} from 'satellite.js';
import {describe, expect, it, vi} from 'vitest';

import {mountSatelliteOrbitsExample, type SatelliteOrbitsHandle} from './app';
import fixture from './data/gp-fixture.omm.json';
import {createSatRec, parseOmmJson, parseTleText} from './gp-records';
import {
  classifyOrbit,
  getGroundTrack,
  getOrbitalPeriodMinutes,
  getOrbitPath,
  interpolateLngLatAlt,
  propagateToLngLatAlt
} from './orbit-math';
import type {WorkerRequest, WorkerResponse} from './propagation-worker';

vi.mock('@deck.gl/core', () => ({
  Deck: class {
    finalize = vi.fn();
  },
  GlobeView: class {}
}));

const records = parseOmmJson(fixture as unknown[]);
const tleRecords = parseTleText(
  readFileSync(new URL('./data/stations.tle', import.meta.url), 'utf8')
);
const getRecord = (noradId: number) => records.find(record => record.noradId === noradId)!;
const ISS = 25544;
const DATE = new Date(Date.UTC(2026, 10, 24));

function getLngLatAlt(record = getRecord(ISS), date = DATE): Float64Array {
  const position = new Float64Array(3);
  propagateToLngLatAlt(createSatRec(record)!, date, gstime(date), position, 0);
  return position;
}

describe('satellite orbits: dataset switching', () => {
  it('ignores a late live fetch and a stale worker reply after switching to the fixture', async () => {
    let resolveLive: (response: Response) => void;
    const slowLive = new Promise<Response>(resolve => {
      resolveLive = resolve;
    });
    const liveBody = JSON.stringify(fixture.slice(0, 1));
    const fetchGroup = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(liveBody))
      .mockReturnValueOnce(slowLive);

    const controls = new Map<
      string,
      {value?: string; onchange?: () => void; textContent?: string}
    >();
    const panel = {
      style: {},
      remove: vi.fn(),
      querySelector(selector: string) {
        if (!controls.has(selector)) controls.set(selector, {});
        return controls.get(selector);
      }
    };
    const getControl = (id: string) => controls.get(`[data-id="${id}"]`)!;
    const container = {style: {}, appendChild: vi.fn()} as unknown as HTMLElement;

    const replies: WorkerResponse[] = [];
    const workerScope = {
      onmessage: null as (event: {data: WorkerRequest}) => void,
      postMessage: (data: WorkerResponse) => replies.push(data)
    };
    let worker: TestWorker;
    class TestWorker {
      onmessage: (event: {data: WorkerResponse}) => void;
      terminate = vi.fn();

      constructor() {
        worker = this;
      }

      postMessage(data: WorkerRequest) {
        workerScope.onmessage({data});
      }
    }

    vi.useFakeTimers();
    vi.stubGlobal('document', {createElement: () => panel});
    vi.stubGlobal('localStorage', {getItem: () => null, setItem: vi.fn()});
    vi.stubGlobal('fetch', fetchGroup);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('Worker', TestWorker);
    vi.stubGlobal('self', workerScope);

    let handle: SatelliteOrbitsHandle;
    let cleanup: (() => void) | undefined;
    try {
      await import('./propagation-worker');
      cleanup = mountSatelliteOrbitsExample(container, {
        group: 'gps-ops',
        onReady: value => {
          handle = value;
        }
      });
      await vi.advanceTimersByTimeAsync(0);
      const [staleReady] = replies;
      expect(staleReady).toMatchObject({type: 'ready', generation: 1});

      const group = getControl('group');
      group.value = 'stations';
      group.onchange!();
      expect(fetchGroup).toHaveBeenLastCalledWith(expect.stringContaining('GROUP=stations'));
      group.value = 'fixture';
      group.onchange!();
      await vi.advanceTimersByTimeAsync(0);
      const [, fixtureReady] = replies;
      expect(fixtureReady).toMatchObject({type: 'ready', generation: 3});

      worker.onmessage({data: staleReady});
      expect(getControl('status').textContent).toBe('Loading fixture...');
      expect(handle.stats.count).toBe(0);
      expect(replies).toHaveLength(2);

      worker.onmessage({data: fixtureReady});
      const [, , fixturePositions] = replies;
      expect(fixturePositions).toMatchObject({type: 'positions', generation: 3});
      worker.onmessage({data: fixturePositions});
      expect(handle.getPosition(ISS)).not.toBeNull();

      resolveLive!(new Response(liveBody));
      await vi.advanceTimersByTimeAsync(0);
      expect(group.value).toBe('fixture');
      expect(getControl('status').textContent).toBe(`${records.length} satellites`);
      expect(handle.stats.count).toBe(records.length);
      expect(replies).toHaveLength(3);
    } finally {
      cleanup?.();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('satellite orbits: GP parsing', () => {
  it('parses the OMM JSON fixture', () => {
    expect(records.length).toBe(224);
    const iss = getRecord(ISS);
    expect(iss.name).toBe('ISS (ZARYA)');
    expect(new Date(iss.epochMs).toISOString()).toBe('2026-11-23T21:54:38.454Z');
    expect(records.every(record => createSatRec(record))).toBe(true);
  });

  it('parses three-line TLE text', () => {
    expect(tleRecords.length).toBe(13);
    const iss = tleRecords.find(record => record.noradId === ISS)!;
    expect(iss.name).toBe('ISS (ZARYA)');
    expect(iss.epochMs).toBeCloseTo(getRecord(ISS).epochMs, -1);
  });

  it('gives the same position from OMM and from TLE', () => {
    const fromOmm = getLngLatAlt();
    const fromTle = getLngLatAlt(tleRecords.find(record => record.noradId === ISS));
    expect(Math.abs(fromOmm[0] - fromTle[0])).toBeLessThan(0.01);
    expect(Math.abs(fromOmm[1] - fromTle[1])).toBeLessThan(0.01);
    expect(Math.abs(fromOmm[2] - fromTle[2])).toBeLessThan(1000);
  });
});

describe('satellite orbits: orbit math', () => {
  it('classifies orbits', () => {
    const classOf = (noradId: number) => classifyOrbit(createSatRec(getRecord(noradId))!);
    expect(classOf(ISS)).toBe('LEO');
    expect(classOf(19548)).toBe('GEO'); // TDRS 3
    const classes = records.map(record => classifyOrbit(createSatRec(record)!));
    expect(classes.filter(c => c === 'MEO').length).toBeGreaterThanOrEqual(64); // GPS, Galileo
    expect(classes.filter(c => c === 'HEO').length).toBe(16);
  });

  it('propagates the ISS to a plausible position', () => {
    const [lng, lat, altitude] = getLngLatAlt();
    expect(Math.abs(lng)).toBeLessThanOrEqual(180);
    expect(Math.abs(lat)).toBeLessThan(52);
    expect(altitude).toBeGreaterThan(380e3);
    expect(altitude).toBeLessThan(450e3);
    expect(getOrbitalPeriodMinutes(createSatRec(getRecord(ISS))!)).toBeCloseTo(92.9, 0);
  });

  it('samples one orbit at altitude and the ground track at the surface', () => {
    const satrec = createSatRec(getRecord(ISS))!;
    const orbit = getOrbitPath(satrec, DATE, 180);
    expect(orbit.length).toBe(181);
    expect(orbit.every(([, , altitude]) => altitude > 380e3 && altitude < 450e3)).toBe(true);
    // The first sample is the satellite position.
    const position = getLngLatAlt();
    expect(orbit[0][0]).toBeCloseTo(position[0], 6);
    expect(orbit[0][1]).toBeCloseTo(position[1], 6);

    const track = getGroundTrack(satrec, DATE, 90);
    expect(track.length).toBe(181);
    expect(track.every(point => point[2] === 0)).toBe(true);
    expect(track[90][0]).toBeCloseTo(position[0], 6);
  });

  it('interpolates across the antimeridian the short way', () => {
    const target = new Float64Array(3);
    interpolateLngLatAlt(
      Float64Array.of(179, 10, 1000),
      Float64Array.of(-179, 12, 2000),
      0.25,
      target
    );
    expect(Array.from(target)).toEqual([179.5, 10.5, 1250]);
  });
});
