// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {gstime, json2satrec, propagate} from 'satellite.js';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  ORBIT_CLASSES,
  createOrbitPropagator,
  createSatRec,
  isCurrentGeneration,
  parseGpRecords,
  propagateToLngLatAlt,
  type GpRecord
} from '@deck.gl-community/layers/space-layers';
import {isWorkerLoadError} from '../../../src/space-layers/orbit-layer/orbit-propagator';
import fixture from './data/gp-fixture.omm.json';

const records = await parseGpRecords(JSON.stringify(fixture), 'json');
const ISS = 25544;
const DATE = new Date(Date.UTC(2026, 10, 24));

describe('createOrbitPropagator (main thread)', () => {
  it('initializes the fixture and rejects none', async () => {
    const propagator = createOrbitPropagator('main-thread');
    const result = await propagator.init(1, records);
    expect(result.generation).toBe(1);
    expect(result.recordIndices.length).toBe(224);
    expect(result.orbitClasses.length).toBe(224);
    expect(result.periodsMinutes.length).toBe(224);
    const issIndex = records.findIndex(record => record.noradId === ISS);
    const row = Array.from(result.recordIndices).indexOf(issIndex);
    expect(ORBIT_CLASSES[result.orbitClasses[row]]).toBe('LEO');
    propagator.destroy();
  });

  it('propagates the ISS to the example position', async () => {
    const propagator = createOrbitPropagator('main-thread');
    const init = await propagator.init(1, records);
    const sample = await propagator.propagate(1, DATE.getTime());
    const issIndex = records.findIndex(record => record.noradId === ISS);
    const row = Array.from(init.recordIndices).indexOf(issIndex);
    const expected = new Float64Array(3);
    const speed = propagateToLngLatAlt(
      createSatRec(records[issIndex])!,
      DATE,
      gstime(DATE),
      expected,
      0
    );
    expect(sample.timeMs).toBe(DATE.getTime());
    expect(sample.positions.length).toBe(3 * 224);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(sample.positions[row * 3 + k] - expected[k])).toBeLessThan(1e-9);
    }
    expect(Math.abs(sample.speedsKmS[row] - speed)).toBeLessThan(1e-4);
    propagator.destroy();
  });

  it('drops replies of an older generation', async () => {
    const propagator = createOrbitPropagator('main-thread');
    const first = propagator.init(1, records);
    const second = propagator.init(2, records.slice(0, 10));
    const [result1, result2] = await Promise.all([first, second]);
    expect(isCurrentGeneration(result1, 2)).toBe(false);
    expect(isCurrentGeneration(result2, 2)).toBe(true);
    propagator.destroy();
  });

  it('a record that fails later gives NaN, not a missing row', async () => {
    // High drag decays the orbit within a year, so SGP4 accepts the set at its epoch
    // and fails when it propagates a year past it.
    const iss = records.find(record => record.noradId === ISS)!;
    const epochMs = DATE.getTime() - 365 * 86400e3;
    const decaying: GpRecord = {
      ...iss,
      epochMs,
      omm: {...iss.omm, EPOCH: new Date(epochMs).toISOString().replace('Z', ''), BSTAR: 0.1}
    };

    // Precondition: the set passes init and fails at the test time.
    expect(createSatRec(decaying)).not.toBeNull();
    expect(propagate(json2satrec(decaying.omm), DATE)).toBeFalsy();

    const propagator = createOrbitPropagator('main-thread');
    const init = await propagator.init(1, [iss, decaying]);
    expect(Array.from(init.recordIndices)).toEqual([0, 1]);
    const sample = await propagator.propagate(1, DATE.getTime());
    expect(sample.positions.length).toBe(3 * init.recordIndices.length);
    expect(sample.speedsKmS.length).toBe(2);
    expect(Number.isFinite(sample.positions[0])).toBe(true);
    expect(Array.from(sample.positions.slice(3, 6)).every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(sample.speedsKmS[1])).toBe(true);
    propagator.destroy();
  });

  it('rejects init and propagate after destroy', async () => {
    const propagator = createOrbitPropagator('main-thread');
    await propagator.init(1, records);
    propagator.destroy();
    await expect(propagator.propagate(1, DATE.getTime())).rejects.toThrow(/destroyed/);
    await expect(propagator.init(2, records)).rejects.toThrow(/destroyed/);
  });

  it('rejects propagate before init', async () => {
    const propagator = createOrbitPropagator('main-thread');
    await expect(propagator.propagate(1, DATE.getTime())).rejects.toThrow(/not initialized/);
    await propagator.init(1, records);
    await expect(propagator.propagate(1, DATE.getTime())).resolves.toBeTruthy();
    propagator.destroy();
  });
});

/** A worker that fires `error` on the first message, or after `repliesBeforeError` replies. */
function stubWorker(repliesBeforeError: number) {
  class FakeWorker {
    onmessage: ((event: {data: unknown}) => void) | null = null;
    onerror: ((event: {message: string}) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    private replies = 0;
    postMessage(message: {type: string; requestId: number; generation?: number}) {
      setTimeout(() => {
        if (this.replies++ < repliesBeforeError) {
          this.onmessage?.({
            data: {
              type: 'init',
              requestId: message.requestId,
              generation: message.generation,
              recordIndices: new Int32Array(0),
              orbitClasses: new Uint8Array(0),
              periodsMinutes: new Float64Array(0)
            }
          });
        } else {
          this.onerror?.({message: 'Failed to fetch dynamically imported module'});
        }
      }, 0);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
}

describe('createOrbitPropagator (worker)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects, and does not throw, when there is no Worker global', async () => {
    expect(typeof Worker).toBe('undefined');
    const propagator = createOrbitPropagator('worker');
    let promise: Promise<unknown> | null = null;
    expect(() => {
      promise = propagator.init(1, records);
    }).not.toThrow();
    const error = await promise!.catch(caught => caught);
    expect(isWorkerLoadError(error)).toBe(true);
    await expect(propagator.propagate(1, DATE.getTime())).rejects.toSatisfy(isWorkerLoadError);
    propagator.destroy();
  });

  it('marks a worker error before the first reply as a load error', async () => {
    stubWorker(0);
    const propagator = createOrbitPropagator('worker');
    const error = await propagator.init(1, records).catch(caught => caught);
    expect(isWorkerLoadError(error)).toBe(true);
    expect(error.message).toMatch(/Failed to fetch/);
    propagator.destroy();
  });

  it('does not mark a worker error after a reply as a load error', async () => {
    stubWorker(1);
    const propagator = createOrbitPropagator('worker');
    await propagator.init(1, records);
    const error = await propagator.propagate(1, DATE.getTime()).catch(caught => caught);
    expect(error).toBeInstanceOf(Error);
    expect(isWorkerLoadError(error)).toBe(false);
    propagator.destroy();
  });
});
