// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {gstime, json2satrec, propagate} from 'satellite.js';
import {describe, expect, it} from 'vitest';

import {
  ORBIT_CLASSES,
  createOrbitPropagator,
  createSatRec,
  isCurrentGeneration,
  parseGpRecords,
  propagateToLngLatAlt,
  type GpRecord
} from '@deck.gl-community/layers/space-layers';
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
});
