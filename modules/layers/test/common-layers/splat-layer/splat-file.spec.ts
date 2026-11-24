// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {afterEach, expect, it, vi} from 'vitest';
import {
  getSplatFile,
  holdSplatFile,
  releaseSplatFile
} from '../../../src/common-layers/splat-layer/splat-file';

/** One splat in the uncompressed antimatter15 `.splat` layout (32 bytes). */
function makeSplatBytes(): ArrayBuffer {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  [1, 2, 3].forEach((v, k) => view.setFloat32(k * 4, v, true));
  [0.1, 0.2, 0.3].forEach((v, k) => view.setFloat32(12 + k * 4, v, true));
  [255, 128, 0, 255, 255, 128, 128, 128].forEach((v, k) => view.setUint8(24 + k, v));
  return buffer;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('shares one URL load between holders and drops it with the last hold', async () => {
  const fetch = vi.fn(async () => new Response(makeSplatBytes()));
  vi.stubGlobal('fetch', fetch);
  const url = 'https://splats.test/row.splat';

  const first = getSplatFile(url);
  holdSplatFile(first);
  // a second layer joins the load in flight
  expect(getSplatFile(url)).toBe(first);
  holdSplatFile(first);
  await first.promise;
  expect(Array.from(first.source!.positions)).toEqual([1, 2, 3]);

  releaseSplatFile(first);
  expect(getSplatFile(url)).toBe(first);
  releaseSplatFile(first);
  // nothing holds the decoded Gaussians any more, so the next use loads the URL again
  const next = getSplatFile(url);
  expect(next).not.toBe(first);
  expect(fetch).toHaveBeenCalledTimes(2);
  await next.promise;
});

it('shares a pending request across a gap with no holders', async () => {
  const response = Promise.withResolvers<Response>();
  const fetch = vi.fn(() => response.promise);
  vi.stubGlobal('fetch', fetch);
  const url = 'https://splats.test/pending.splat';

  const file = getSplatFile(url);
  holdSplatFile(file);
  releaseSplatFile(file);
  expect(getSplatFile(url)).toBe(file);
  expect(fetch).toHaveBeenCalledOnce();

  response.resolve(new Response(makeSplatBytes()));
  await file.promise;
  expect(getSplatFile(url)).not.toBe(file);
});

it('keeps a held failure without refetching, and retries once it is released', async () => {
  const fetch = vi.fn(async () => new Response(null, {status: 503}));
  vi.stubGlobal('fetch', fetch);
  const url = 'https://splats.test/flaky.splat';

  const failed = getSplatFile(url);
  holdSplatFile(failed);
  await expect(failed.promise).rejects.toThrow('HTTP 503');
  // the holding layer reports the failure once instead of reloading in a loop
  expect(getSplatFile(url)).toBe(failed);
  expect(fetch).toHaveBeenCalledTimes(1);

  releaseSplatFile(failed);
  fetch.mockImplementation(async () => new Response(makeSplatBytes()));
  const retry = getSplatFile(url);
  expect(retry).not.toBe(failed);
  holdSplatFile(retry);
  await retry.promise;
  expect(retry.source).toBeDefined();
  releaseSplatFile(retry);
});

it('drops a settled load that nothing holds', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, {status: 404}))
  );
  const url = 'https://splats.test/probed.splat';
  const probed = getSplatFile(url);
  await probed.promise.catch(() => undefined);
  const next = getSplatFile(url);
  expect(next).not.toBe(probed);
  await next.promise.catch(() => undefined);
});
