// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {createOrbitPropagator, parseGpRecords} from '@deck.gl-community/layers/space-layers';
import fixture from './data/gp-fixture.omm.json';

const records = await parseGpRecords(JSON.stringify(fixture), 'json');
const TIME_MS = Date.UTC(2026, 10, 24);

describe('createOrbitPropagator (worker)', () => {
  it('worker and main thread give the same sample', async () => {
    const worker = createOrbitPropagator('worker');
    const mainThread = createOrbitPropagator('main-thread');
    try {
      const workerInit = await worker.init(1, records);
      const mainInit = await mainThread.init(1, records);
      expect(workerInit.generation).toBe(1);
      expect(Array.from(workerInit.recordIndices)).toEqual(Array.from(mainInit.recordIndices));
      expect(Array.from(workerInit.orbitClasses)).toEqual(Array.from(mainInit.orbitClasses));
      expect(Array.from(workerInit.periodsMinutes)).toEqual(Array.from(mainInit.periodsMinutes));

      const workerSample = await worker.propagate(1, TIME_MS);
      const mainSample = await mainThread.propagate(1, TIME_MS);
      expect(workerSample.generation).toBe(1);
      expect(workerSample.timeMs).toBe(TIME_MS);
      expect(workerSample.positions.length).toBe(3 * 224);
      expect(workerSample.positions).toEqual(mainSample.positions);
      expect(workerSample.speedsKmS).toEqual(mainSample.speedsKmS);
    } finally {
      worker.destroy();
      mainThread.destroy();
    }
  });

  it('resolves concurrent propagate calls with their own samples', async () => {
    const worker = createOrbitPropagator('worker');
    try {
      await worker.init(1, records);
      const later = TIME_MS + 3600e3;
      const [a, b] = await Promise.all([worker.propagate(1, TIME_MS), worker.propagate(1, later)]);
      expect(a.timeMs).toBe(TIME_MS);
      expect(b.timeMs).toBe(later);
      expect(a.positions).not.toEqual(b.positions);
    } finally {
      worker.destroy();
    }
  });

  it('destroy terminates the worker', async () => {
    const worker = createOrbitPropagator('worker');
    await worker.init(1, records);
    const pending = worker.propagate(1, TIME_MS);
    worker.destroy();
    await expect(pending).rejects.toThrow(/destroyed/);
    await expect(worker.propagate(1, TIME_MS)).rejects.toThrow(/destroyed/);
    await expect(worker.init(2, records)).rejects.toThrow(/destroyed/);
  });
});
