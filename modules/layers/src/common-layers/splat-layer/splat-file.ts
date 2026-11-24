// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SplatSource} from './splat-source';
import {
  type GaussianSplatsColumns,
  type GaussianSplatsTable,
  getSplatSourceFromGaussianSplats,
  getSplatSourceFromGaussianSplatsTable
} from './splat-gaussian-table';

/** A splat file the layer loads and decodes itself: a URL, or the file's bytes. */
export type SplatFileInput = string | URL | ArrayBuffer | ArrayBufferView | Blob;

/** Formats decoded by `@loaders.gl/splats`. */
export type SplatFileFormat = 'spz' | 'splat' | 'ksplat';

/** One file's load: the source once decoded, or the error that stopped it. */
export type SplatFile = {
  promise: Promise<SplatSource>;
  source?: SplatSource;
  error?: Error;
};

const SPZ_V4_MAGIC = 0x5053474e; // 'NGSP'
const RAD_MAGIC = 0x30444152; // 'RAD0'
const SPLAT_ROW_BYTES = 32;

type SplatLoaderLike = {
  parse?: (data: ArrayBuffer, options?: object) => Promise<unknown>;
  preload?: () => Promise<SplatLoaderLike>;
};

// A URL's load stays cached while a layer holds it; bytes and Blobs live as long as the object.
const FILES_BY_URL = new Map<string, SplatFile>();
const FILES_BY_OBJECT = new WeakMap<object, SplatFile>();
const FILE_URLS = new WeakMap<SplatFile, string>();
const FILE_HOLDS = new WeakMap<SplatFile, number>();

/** True for a URL or the bytes of a splat file. */
export function isSplatFileInput(input: unknown): input is SplatFileInput {
  return (
    typeof input === 'string' ||
    input instanceof URL ||
    input instanceof ArrayBuffer ||
    ArrayBuffer.isView(input) ||
    (typeof Blob !== 'undefined' && input instanceof Blob)
  );
}

/**
 * The load of one file, started on first use. A URL loads once while layers hold it (see
 * `holdSplatFile`), so concurrent layers share one fetch and decode; an object loads once per object.
 */
export function getSplatFile(input: SplatFileInput): SplatFile {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : undefined;
  const cached = url ? FILES_BY_URL.get(url) : FILES_BY_OBJECT.get(input as object);
  if (cached) return cached;
  const file = {} as SplatFile;
  file.promise = loadSplatFile(input).then(
    source => {
      file.source = source;
      forgetUnheldSplatFile(file);
      return source;
    },
    (error: unknown) => {
      file.error = error instanceof Error ? error : new Error(String(error));
      forgetUnheldSplatFile(file);
      throw file.error;
    }
  );
  // the layer reports a failure through its own error path
  file.promise.catch(() => {});
  if (url) {
    FILES_BY_URL.set(url, file);
    FILE_URLS.set(file, url);
  } else FILES_BY_OBJECT.set(input as object, file);
  return file;
}

/** Keep a file's load cached while a layer draws it. */
export function holdSplatFile(file: SplatFile): void {
  FILE_HOLDS.set(file, (FILE_HOLDS.get(file) ?? 0) + 1);
}

/**
 * Release a hold. A URL's load leaves the cache once nothing holds it, so its decoded Gaussians can
 * be collected, and the next use of that URL loads it again, retrying a failure.
 */
export function releaseSplatFile(file: SplatFile): void {
  const holds = (FILE_HOLDS.get(file) ?? 0) - 1;
  if (holds > 0) {
    FILE_HOLDS.set(file, holds);
    return;
  }
  FILE_HOLDS.delete(file);
  forgetSplatFile(file);
}

/** Drop a settled load nothing holds, such as one only probed, rather than keep it for the session. */
function forgetUnheldSplatFile(file: SplatFile): void {
  if (!FILE_HOLDS.get(file)) forgetSplatFile(file);
}

function forgetSplatFile(file: SplatFile): void {
  const url = FILE_URLS.get(file);
  if (url !== undefined && FILES_BY_URL.get(url) === file) FILES_BY_URL.delete(url);
}

/** Fetch if needed, detect the format from the bytes, and decode with `@loaders.gl/splats`. */
export async function loadSplatFile(input: SplatFileInput): Promise<SplatSource> {
  const name =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : typeof File !== 'undefined' && input instanceof File
          ? input.name
          : '';
  const buffer = await readSplatFileBytes(input);
  const format = detectSplatFileFormat(buffer, name);
  // loaded on first use, so layers that never see a file never fetch the decoders
  const splats = await import('@loaders.gl/splats');
  // loaders.gl 5 decodes SPZ to plain columns, skipping the Arrow table and its copies
  const parseColumns = (splats as Record<string, unknown>).parseSPZToGaussianSplats as
    | ((data: ArrayBuffer) => Promise<GaussianSplatsColumns>)
    | undefined;
  if (format === 'spz' && parseColumns)
    return getSplatSourceFromGaussianSplats(await parseColumns(buffer));
  const base = {spz: splats.SPZLoader, splat: splats.SPLATLoader, ksplat: splats.KSPLATLoader}[
    format
  ] as unknown as SplatLoaderLike;
  // loaders.gl 4 loaders parse directly; loaders.gl 5 exports metadata that preloads its parser
  const loader = base.parse ? base : await base.preload!();
  const table = await loader.parse!(buffer, {});
  return getSplatSourceFromGaussianSplatsTable(table as GaussianSplatsTable);
}

/** SPZ by its header (v4 magic, or the gzip stream of v2/v3); `.splat`/`.ksplat` by name or size. */
export function detectSplatFileFormat(buffer: ArrayBuffer, name = ''): SplatFileFormat {
  const view = new DataView(buffer);
  if (buffer.byteLength >= 4 && view.getUint32(0, true) === SPZ_V4_MAGIC) return 'spz';
  if (buffer.byteLength >= 2 && view.getUint8(0) === 0x1f && view.getUint8(1) === 0x8b)
    return 'spz';
  if (buffer.byteLength >= 4 && view.getUint32(0, true) === RAD_MAGIC)
    throw new Error('SplatLayer does not draw RAD files yet: they need the paged LoD backend.');
  const extension = name.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  if (extension === 'ksplat') return 'ksplat';
  if (extension === 'splat' || (buffer.byteLength > 0 && buffer.byteLength % SPLAT_ROW_BYTES === 0))
    return 'splat';
  throw new Error(
    `SplatLayer could not recognize ${name || 'the splat file'}: expected SPZ, .splat or .ksplat.`
  );
}

async function readSplatFileBytes(input: SplatFileInput): Promise<ArrayBuffer> {
  if (typeof input === 'string' || input instanceof URL) {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`SplatLayer got HTTP ${response.status} for ${input}.`);
    return response.arrayBuffer();
  }
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input))
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  return input.arrayBuffer();
}
