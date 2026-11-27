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
import type {WorkerRequest, WorkerResponse} from './orbit-propagation-worker';

export type {OrbitInitResult, OrbitSample};

/**
 * Computes satellite positions from GP records. Every reply carries the `generation` of the
 * request, so the caller can drop replies that belong to older records.
 */
export interface OrbitPropagator {
  /** Replaces the satellites. Resolves with the records that SGP4 accepted. */
  init(generation: number, records: GpRecord[]): Promise<OrbitInitResult>;
  /**
   * Propagates the satellites of the latest `init` to `timeMs`.
   *
   * The generation tag of the reply differs by mode. Worker mode tags it with the generation of
   * the latest `init` that the worker processed. Main-thread mode tags it with the `generation`
   * argument. Both are safe when the caller drops replies whose generation differs from the
   * latest generation it requested (see `isCurrentGeneration`).
   */
  propagate(generation: number, timeMs: number): Promise<OrbitSample>;
  destroy(): void;
}

/** Returns true when a reply belongs to `generation`, the latest one the caller requested. */
export function isCurrentGeneration(result: {generation: number}, generation: number): boolean {
  return result.generation === generation;
}

const DESTROYED_MESSAGE = 'OrbitPropagator was destroyed';

const WORKER_LOAD_ERROR = Symbol('worker load error');

/**
 * Returns true when the worker could not start: `new Worker` threw (no `Worker` global, an
 * invalid URL, a CSP error) or the worker failed before its first reply (a missing file).
 */
export function isWorkerLoadError(error: unknown): boolean {
  return Boolean(error && (error as Record<symbol, unknown>)[WORKER_LOAD_ERROR]);
}

function toWorkerLoadError(cause: unknown): Error {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  (error as unknown as Record<symbol, unknown>)[WORKER_LOAD_ERROR] = true;
  return error;
}

/** Creates a propagator that runs in a Web Worker or on the main thread. */
export function createOrbitPropagator(mode: 'worker' | 'main-thread'): OrbitPropagator {
  return mode === 'worker' ? new WorkerOrbitPropagator() : new MainThreadOrbitPropagator();
}

class MainThreadOrbitPropagator implements OrbitPropagator {
  private readonly state = createPropagationState();
  private destroyed = false;

  async init(generation: number, records: GpRecord[]): Promise<OrbitInitResult> {
    if (this.destroyed) {
      throw new Error(DESTROYED_MESSAGE);
    }
    return initPropagation(this.state, generation, records);
  }

  async propagate(generation: number, timeMs: number): Promise<OrbitSample> {
    if (this.destroyed) {
      throw new Error(DESTROYED_MESSAGE);
    }
    return propagateAll(this.state, generation, timeMs);
  }

  destroy(): void {
    this.destroyed = true;
    this.state.satrecs = [];
  }
}

type PendingRequest = {resolve: (value: any) => void; reject: (error: Error) => void};

class WorkerOrbitPropagator implements OrbitPropagator {
  private worker: Worker | null = null;
  private destroyed = false;
  /** False until the first worker reply. A worker error before it is a load error. */
  private replied = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  init(generation: number, records: GpRecord[]): Promise<OrbitInitResult> {
    return this.request(requestId => ({type: 'init', requestId, generation, records}));
  }

  propagate(generation: number, timeMs: number): Promise<OrbitSample> {
    // The worker replies with the generation of its latest init, so `generation` is not sent.
    return this.request(requestId => ({type: 'propagate', requestId, timeMs}));
  }

  destroy(): void {
    this.destroyed = true;
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new Error(DESTROYED_MESSAGE));
  }

  private request<T>(createMessage: (requestId: number) => WorkerRequest): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error(DESTROYED_MESSAGE));
    }
    let worker: Worker;
    try {
      worker = this.getWorker();
    } catch (error) {
      // For example no `Worker` global, a CSP error, or an invalid `import.meta.url` (CJS).
      return Promise.reject(toWorkerLoadError(error));
    }
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {resolve, reject});
      try {
        worker.postMessage(createMessage(requestId));
      } catch (error) {
        this.pending.delete(requestId);
        reject(error as Error);
      }
    });
  }

  private getWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('./orbit-propagation-worker.js', import.meta.url), {
        type: 'module'
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
      worker.onerror = event => {
        // A worker error is fatal, for example a failed module load. Drop the worker, so the
        // next request creates a new one instead of waiting on a dead one.
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
        }
        const error = new Error(event.message || 'Orbit worker failed');
        this.rejectAll(this.replied ? error : toWorkerLoadError(error));
      };
      worker.onmessageerror = () => this.rejectAll(new Error('Orbit worker message failed'));
      this.worker = worker;
    }
    return this.worker;
  }

  private handleMessage(response: WorkerResponse): void {
    this.replied = true;
    const request = this.pending.get(response.requestId);
    if (!request) {
      return;
    }
    this.pending.delete(response.requestId);
    if (response.type === 'error') {
      request.reject(new Error(response.message));
    } else {
      request.resolve(response);
    }
  }

  private rejectAll(error: Error): void {
    const requests = [...this.pending.values()];
    this.pending.clear();
    for (const request of requests) {
      request.reject(error);
    }
  }
}
