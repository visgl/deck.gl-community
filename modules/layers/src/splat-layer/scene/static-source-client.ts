// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatSource} from '../splat-source';

/** Decodes a static file off-thread and transfers each source column exactly once. */
export function loadStaticSplatSource(
  data: string | Blob,
  format?: 'splat' | 'ksplat' | 'spz',
  suppliedWorker?: Worker
): {promise: Promise<SplatSource>; destroy: () => void} {
  const worker =
    suppliedWorker ??
    new Worker(new URL('./static-source-worker.js', import.meta.url), {type: 'module'});
  let rejectLoading: (error: Error) => void;
  const promise = new Promise<SplatSource>((resolve, reject) => {
    rejectLoading = reject;
    worker.onmessage = ({data: result}: MessageEvent<{source?: SplatSource; error?: string}>) => {
      worker.terminate();
      if (result.source) resolve(result.source);
      else reject(new Error(result.error ?? 'Static splat decoder failed.'));
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({source: data, format});
  });
  return {
    promise,
    destroy: () => {
      worker.terminate();
      rejectLoading(new DOMException('Splat source destroyed.', 'AbortError'));
    }
  };
}
