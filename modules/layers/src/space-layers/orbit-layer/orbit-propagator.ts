// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GpRecord} from './gp-records';
import {
  createPropagationState,
  initPropagation,
  propagateAll,
  type OrbitInitResult,
  type OrbitSample
} from './orbit-propagation-core';

export type {OrbitInitResult, OrbitSample};

/**
 * Computes satellite positions from GP records. Every reply carries the `generation` of the
 * request, so the caller can drop replies that belong to older records.
 */
export interface OrbitPropagator {
  /** Replaces the satellites. Resolves with the records that SGP4 accepted. */
  init(generation: number, records: GpRecord[]): Promise<OrbitInitResult>;
  /** Propagates the satellites of the latest `init` to `timeMs`. */
  propagate(generation: number, timeMs: number): Promise<OrbitSample>;
  destroy(): void;
}

/** Returns true when a reply belongs to `generation`, the latest one the caller requested. */
export function isCurrentGeneration(result: {generation: number}, generation: number): boolean {
  return result.generation === generation;
}

/** Creates a propagator that runs in a Web Worker or on the main thread. */
export function createOrbitPropagator(mode: 'worker' | 'main-thread'): OrbitPropagator {
  if (mode === 'worker') {
    throw new Error('Worker propagation is added in a later task');
  }
  return new MainThreadOrbitPropagator();
}

class MainThreadOrbitPropagator implements OrbitPropagator {
  private readonly state = createPropagationState();

  async init(generation: number, records: GpRecord[]): Promise<OrbitInitResult> {
    return initPropagation(this.state, generation, records);
  }

  async propagate(generation: number, timeMs: number): Promise<OrbitSample> {
    return propagateAll(this.state, generation, timeMs);
  }

  destroy(): void {
    this.state.satrecs = [];
  }
}
