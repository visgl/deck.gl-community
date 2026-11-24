// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/// <reference lib="webworker" />

import {gstime, type SatRec} from 'satellite.js';
import {createSatRec, type GpRecord} from './gp-records';
import {
  classifyOrbit,
  getOrbitalPeriodMinutes,
  ORBIT_CLASSES,
  propagateToLngLatAlt
} from './orbit-math';

/** Messages from the main thread to the worker. */
export type WorkerRequest =
  | {type: 'init'; records: GpRecord[]}
  | {type: 'propagate'; requestId: number; timeMs: number};

/** Messages from the worker to the main thread. */
export type WorkerResponse =
  | {
      type: 'ready';
      /** Index into the `records` that were sent, for each satellite that SGP4 accepted. */
      recordIndices: Int32Array;
      /** Index into `ORBIT_CLASSES`. */
      orbitClasses: Uint8Array;
      periodsMinutes: Float32Array;
      initMs: number;
    }
  | {
      type: 'positions';
      requestId: number;
      timeMs: number;
      /** `[lng, lat, altitude meters]` per satellite; NaN when SGP4 failed. */
      positions: Float64Array;
      speedsKmS: Float32Array;
      propagateMs: number;
    };

let satrecs: SatRec[] = [];

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    const start = performance.now();
    const recordIndices: number[] = [];
    satrecs = [];
    message.records.forEach((record, index) => {
      const satrec = createSatRec(record);
      if (satrec) {
        satrecs.push(satrec);
        recordIndices.push(index);
      }
    });
    const response: WorkerResponse = {
      type: 'ready',
      recordIndices: Int32Array.from(recordIndices),
      orbitClasses: Uint8Array.from(satrecs, s => ORBIT_CLASSES.indexOf(classifyOrbit(s))),
      periodsMinutes: Float32Array.from(satrecs, getOrbitalPeriodMinutes),
      initMs: performance.now() - start
    };
    self.postMessage(response);
    return;
  }

  const start = performance.now();
  const date = new Date(message.timeMs);
  const gmst = gstime(date);
  const positions = new Float64Array(satrecs.length * 3);
  const speedsKmS = new Float32Array(satrecs.length);
  for (let i = 0; i < satrecs.length; i++) {
    speedsKmS[i] = propagateToLngLatAlt(satrecs[i], date, gmst, positions, i * 3);
  }
  const response: WorkerResponse = {
    type: 'positions',
    requestId: message.requestId,
    timeMs: message.timeMs,
    positions,
    speedsKmS,
    propagateMs: performance.now() - start
  };
  self.postMessage(response, {transfer: [positions.buffer, speedsKmS.buffer]});
};
