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

const FILES_BY_URL = new Map<string, SplatFile>();
const FILES_BY_OBJECT = new WeakMap<object, SplatFile>();

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

/** The load of one file, started on first use; the same URL or object loads once. */
export function getSplatFile(input: SplatFileInput): SplatFile {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : undefined;
  const cached = url ? FILES_BY_URL.get(url) : FILES_BY_OBJECT.get(input as object);
  if (cached) return cached;
  const file = {} as SplatFile;
  file.promise = loadSplatFile(input).then(
    source => {
      file.source = source;
      return source;
    },
    (error: unknown) => {
      file.error = error instanceof Error ? error : new Error(String(error));
      throw file.error;
    }
  );
  // the layer reports a failure through its own error path
  file.promise.catch(() => {});
  if (url) FILES_BY_URL.set(url, file);
  else FILES_BY_OBJECT.set(input as object, file);
  return file;
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
