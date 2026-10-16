// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {afterEach, describe, expect, it, vi} from 'vitest';
import {RADSourceClient, type RADWorker} from '../../../src/splat-layer/scene/rad-source-client';
import {loadStaticSplatSource} from '../../../src/splat-layer/scene/static-source-client';

const SOURCES = [
  ['relative', 'assets/scene.rad', 'https://assets.example/scenes/assets/scene.rad'],
  ['root relative', '/scene.rad', 'https://assets.example/scene.rad'],
  ['protocol relative', '//cdn.example/scene.rad', 'https://cdn.example/scene.rad'],
  [
    'absolute',
    'https://cdn.example/scene.rad?token=example',
    'https://cdn.example/scene.rad?token=example'
  ],
  [
    'data URL',
    'data:application/octet-stream;base64,AA==',
    'data:application/octet-stream;base64,AA=='
  ],
  ['blob URL', 'blob:https://app.example/scene', 'blob:https://app.example/scene']
] as const;

afterEach(() => vi.unstubAllGlobals());

for (const kind of ['static', 'rad'] as const) {
  describe(`${kind} worker asset URLs`, () => {
    const start = (data: string | Blob) => {
      const worker: RADWorker = {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: vi.fn()
      };
      if (kind === 'rad') {
        const client = new RADSourceClient(data, worker);
        return {
          worker,
          promise: client.getMetadata(),
          settled: client.getMetadata().catch(() => {}),
          destroy: () => client.destroy(),
          property: 'data'
        };
      }
      const loading = loadStaticSplatSource(data, undefined, worker as unknown as Worker);
      return {
        worker,
        promise: loading.promise,
        settled: loading.promise.catch(() => {}),
        destroy: loading.destroy,
        property: 'source'
      };
    };
    it.each(
      SOURCES
    )('resolves %s sources before crossing the worker boundary', async (_name, data, expected) => {
      // A document <base> can differ from the page URL and from either bundled worker URL.
      vi.stubGlobal('document', {baseURI: 'https://assets.example/scenes/'});
      vi.stubGlobal('location', {href: 'https://app.example/nested/page.html'});
      const request = start(data);
      try {
        expect(request.worker.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({[request.property]: expected})
        );
      } finally {
        request.destroy();
        await request.settled;
      }
    });
    it('rejects malformed URLs locally and terminates their worker', async () => {
      vi.stubGlobal('document', {baseURI: 'https://assets.example/scenes/'});
      const request = start('http://[');
      try {
        await expect(request.promise).rejects.toBeInstanceOf(TypeError);
        expect(request.worker.postMessage).not.toHaveBeenCalled();
        expect(request.worker.terminate).toHaveBeenCalledTimes(1);
      } finally {
        request.destroy();
        await request.settled;
      }
    });
    it('preserves Blob identity without a browser document', async () => {
      const data = new Blob([new Uint8Array([1, 2, 3])]);
      const request = start(data);
      try {
        const message = vi.mocked(request.worker.postMessage).mock.calls[0][0];
        expect((message as unknown as Record<string, unknown>)[request.property]).toBe(data);
      } finally {
        request.destroy();
        await request.settled;
      }
    });
  });
}
