// deck.gl-community
// SPDX-License-Identifier: MIT

import {MAX_DATA_BYTES} from './playground-webmcp-data';

/** Decodes bounded IPC in a disposable worker; cancellation never falls back to the main thread. */
export function decodePlaygroundArrow(bytes: Uint8Array, signal: AbortSignal): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Arrow decoding canceled'));
      return;
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_DATA_BYTES) {
      reject(new Error('Invalid Arrow input size'));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./playground-arrow-worker.js', import.meta.url), {
        type: 'module'
      });
    } catch {
      reject(new Error('Arrow worker unavailable'));
      return;
    }
    let settled = false;
    const finish = (rows?: unknown[], error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(new Error(error));
      else resolve(rows!);
    };
    const abort = () => finish(undefined, 'Arrow decoding canceled');
    const timeout = setTimeout(() => finish(undefined, 'Arrow decoding timed out'), 5000);
    signal.addEventListener('abort', abort, {once: true});
    worker.onmessage = event => {
      if (event.data?.ok === true && Array.isArray(event.data.rows)) {
        finish(event.data.rows);
      } else {
        finish(undefined, 'Invalid or unsupported Arrow data');
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(undefined, 'Arrow decoding failed');
    };
    worker.onmessageerror = () => finish(undefined, 'Arrow decoding failed');
    try {
      const copy = bytes.slice();
      worker.postMessage(copy, [copy.buffer]);
    } catch {
      finish(undefined, 'Arrow decoding failed');
    }
  });
}
