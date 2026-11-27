// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/// <reference lib="webworker" />

import type {GpRecord} from './gp-records';
import {
  createPropagationState,
  initPropagation,
  propagateAll,
  type OrbitInitResult,
  type OrbitSample
} from './orbit-propagation-core';

/** Messages from the main thread to the worker. */
export type WorkerRequest =
  | {type: 'init'; requestId: number; generation: number; records: GpRecord[]}
  | {type: 'propagate'; requestId: number; timeMs: number};

/** Messages from the worker to the main thread. */
export type WorkerResponse =
  | ({type: 'ready'; requestId: number} & OrbitInitResult)
  | ({type: 'positions'; requestId: number} & OrbitSample)
  | {type: 'error'; requestId: number; message: string};

const state = createPropagationState();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const result = initPropagation(state, message.generation, message.records);
      const response: WorkerResponse = {type: 'ready', requestId: message.requestId, ...result};
      self.postMessage(response);
      return;
    }
    // The reply keeps the generation of the latest init, so the caller can drop stale samples.
    const sample = propagateAll(state, state.generation, message.timeMs);
    const response: WorkerResponse = {type: 'positions', requestId: message.requestId, ...sample};
    self.postMessage(response, {transfer: [sample.positions.buffer, sample.speedsKmS.buffer]});
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(response);
  }
};
