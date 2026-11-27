// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {gstime, type SatRec} from 'satellite.js';
import {createSatRec, type GpRecord} from './gp-records';
import {
  classifyOrbit,
  getOrbitalPeriodMinutes,
  ORBIT_CLASSES,
  propagateToLngLatAlt
} from './orbit-math';

/**
 * The propagation logic, as plain functions with no worker or DOM dependency. The main-thread
 * propagator and the propagation worker both use it.
 */

/** What `initPropagation` reports for the records that SGP4 accepted. */
export type OrbitInitResult = {
  generation: number;
  /** Index into the `records` that were sent, for each satellite that SGP4 accepted. */
  recordIndices: Int32Array;
  /** Index into `ORBIT_CLASSES`. */
  orbitClasses: Uint8Array;
  periodsMinutes: Float32Array;
};

/** The positions of all accepted satellites at one time. */
export type OrbitSample = {
  generation: number;
  timeMs: number;
  /** `[lng, lat, altitude meters]` per satellite; NaN when SGP4 fails for that sample. */
  positions: Float64Array;
  speedsKmS: Float32Array;
};

/** The SGP4 state of the accepted satellites. */
export type PropagationState = {
  generation: number;
  satrecs: SatRec[];
  /** False until the first `initPropagation`. */
  initialized: boolean;
};

export function createPropagationState(): PropagationState {
  return {generation: 0, satrecs: [], initialized: false};
}

/** Replaces the satellites in `state` with the records that SGP4 accepts. */
export function initPropagation(
  state: PropagationState,
  generation: number,
  records: GpRecord[]
): OrbitInitResult {
  const recordIndices: number[] = [];
  state.generation = generation;
  state.satrecs = [];
  state.initialized = true;
  records.forEach((record, index) => {
    const satrec = createSatRec(record);
    if (satrec) {
      state.satrecs.push(satrec);
      recordIndices.push(index);
    }
  });
  return {
    generation,
    recordIndices: Int32Array.from(recordIndices),
    orbitClasses: Uint8Array.from(state.satrecs, satrec =>
      ORBIT_CLASSES.indexOf(classifyOrbit(satrec))
    ),
    periodsMinutes: Float32Array.from(state.satrecs, getOrbitalPeriodMinutes)
  };
}

/**
 * Propagates every satellite in `state` to `timeMs`. Throws when no init was processed, for
 * example in a new worker after a worker error, so the caller knows that it must init again.
 */
export function propagateAll(
  state: PropagationState,
  generation: number,
  timeMs: number
): OrbitSample {
  if (!state.initialized) {
    throw new Error('OrbitPropagator is not initialized');
  }
  const {satrecs} = state;
  const date = new Date(timeMs);
  const gmst = gstime(date);
  const positions = new Float64Array(satrecs.length * 3);
  const speedsKmS = new Float32Array(satrecs.length);
  for (let i = 0; i < satrecs.length; i++) {
    speedsKmS[i] = propagateToLngLatAlt(satrecs[i], date, gmst, positions, i * 3);
  }
  return {generation, timeMs, positions, speedsKmS};
}
