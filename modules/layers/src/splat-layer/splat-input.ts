// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Accessor, AccessorContext, Position} from '@deck.gl/core';
import type {SplatSource} from './splat-source';
import {validateSplatSource} from './splat-source';
import type {SplatHierarchy} from './splat-hierarchy';
import {
  type GaussianSplatsTable,
  getSplatSourceFromGaussianSplatsTable,
  isGaussianSplatsTable
} from './splat-gaussian-table';
import {type SplatFile, type SplatFileInput, getSplatFile, isSplatFileInput} from './splat-file';

/** Prepared Gaussian asset with its optional, source-local template hierarchy. */
export type PreparedSplatData = {
  /** Distinguishes an asset descriptor from an application-owned instance row. */
  type: 'prepared-splats';
  /** Immutable Gaussian columns. Replace the source when its columns change. */
  source: SplatSource;
  /** Finest source at error zero, followed by increasing local error bounds. */
  hierarchy?: SplatHierarchy;
};

/**
 * Assets supported by the prepared rendering backend: prepared columns, a prepared descriptor, a
 * Gaussian splat table decoded by `@loaders.gl/splats`, or a splat file (URL or bytes) that the
 * layer loads and decodes itself.
 */
export type SplatDataInput = SplatSource | PreparedSplatData | GaussianSplatsTable | SplatFileInput;

/** Owner returned by accessors and picking for a directly supplied asset. */
export type SplatInstance = {splats: SplatDataInput; position: Position};

export type ResolvedSplatAsset = {
  id: number;
  source: SplatSource;
  hierarchy: SplatHierarchy;
};
export type ResolvedSplatInput<DataT> = {
  data: DataT[];
  assets: ResolvedSplatAsset[];
  /** One asset per row; undefined while the row's file loads, or after it failed. */
  rowAssets: (ResolvedSplatAsset | undefined)[];
  /** Files still loading; the layer resolves again when each settles. */
  pending: SplatFile[];
  /** Files that failed to load. */
  failed: SplatFile[];
};

type AssetCache = {
  defaultAsset?: ResolvedSplatAsset;
  hierarchies: WeakMap<SplatHierarchy, ResolvedSplatAsset>;
};
const ASSETS = new WeakMap<SplatSource, AssetCache>();
const INSTANCES = new WeakMap<object, SplatInstance[]>();
const URL_INSTANCES = new Map<string, SplatInstance[]>();
let nextAssetId = 0;

/** The conventional row accessor, used when getSource is not supplied. */
export const DEFAULT_GET_SOURCE = (row: {splats?: SplatDataInput}): SplatDataInput => row.splats!;

function isPreparedSource(input: unknown): input is SplatSource {
  return Boolean(
    input && typeof input === 'object' && 'positions' in input && 'opacities' in input
  );
}
export function isSplatDataInput(input: unknown): input is SplatDataInput {
  return (
    isPreparedSource(input) ||
    isGaussianSplatsTable(input) ||
    isSplatFileInput(input) ||
    Boolean(
      input && typeof input === 'object' && 'type' in input && input.type === 'prepared-splats'
    )
  );
}

/** Validate one source/hierarchy pair once without allocating a GPU resource. */
export function resolveSplatAsset(input: SplatDataInput): ResolvedSplatAsset {
  if (isSplatFileInput(input)) {
    const source = getSplatFile(input).source;
    if (!source) throw new Error('A splat file resolves only after it has loaded.');
    return resolveSplatAsset(source);
  }
  // a decoded table converts once and then resolves like its prepared columns
  if (isGaussianSplatsTable(input))
    return resolveSplatAsset(getSplatSourceFromGaussianSplatsTable(input));
  if (!isSplatDataInput(input))
    throw new Error(
      'SplatLayer requires a prepared Gaussian asset or a decoded @loaders.gl/splats table. RAD and sorted scene rendering require the upstream paged-instance backend.'
    );
  const descriptor = 'type' in input ? input : undefined;
  const source = descriptor ? descriptor.source : (input as SplatSource);
  if (!isPreparedSource(source))
    throw new Error('Prepared splat data requires Gaussian source columns.');
  let cache = ASSETS.get(source);
  const supplied = descriptor?.hierarchy;
  const cached = supplied ? cache?.hierarchies.get(supplied) : cache?.defaultAsset;
  if (cached) return cached;
  const hierarchy = supplied ?? [{source, error: 0}];
  if (
    !hierarchy.length ||
    hierarchy[0].source !== source ||
    hierarchy[0].error !== 0 ||
    hierarchy.some(
      (level, i) =>
        !Number.isFinite(level.error) ||
        level.error < 0 ||
        (i > 0 && level.error <= hierarchy[i - 1].error)
    )
  )
    throw new Error(
      'Splat hierarchy must start with source at error zero, followed by increasing finite errors.'
    );
  for (const level of hierarchy) validateSplatSource(level.source);
  const asset = {id: nextAssetId++, source, hierarchy};
  if (!cache) {
    cache = {hierarchies: new WeakMap()};
    ASSETS.set(source, cache);
  }
  if (supplied) cache.hierarchies.set(supplied, asset);
  else cache.defaultAsset = asset;
  return asset;
}

/** The implicit owner row of a directly supplied asset, stable per asset (a URL by its text). */
export function getSplatInstanceRows(input: SplatDataInput): SplatInstance[] {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : undefined;
  let instances = url ? URL_INSTANCES.get(url) : INSTANCES.get(input as object);
  if (!instances) {
    instances = [{splats: input, position: [0, 0, 0]}];
    if (url) URL_INSTANCES.set(url, instances);
    else INSTANCES.set(input as object, instances);
  }
  return instances;
}

/** Directly supplied sources at least this large draw as a capture. */
export const SPLAT_CAPTURE_MIN_COUNT = 65536;

/**
 * Whether direct `data` is a capture: a splat file, or one source of at least
 * `SPLAT_CAPTURE_MIN_COUNT` Gaussians without an authored hierarchy. A capture draws depth-sorted
 * and unlit, without owner instancing or refinement. Returns its source, `undefined` while its file
 * loads or after it failed, or `null` when data is not a capture.
 */
export function getSplatCaptureSource(data: unknown): SplatSource | undefined | null {
  if (isSplatFileInput(data)) return getSplatFile(data).source;
  const source = isGaussianSplatsTable(data)
    ? getSplatSourceFromGaussianSplatsTable(data)
    : isPreparedSource(data)
      ? data
      : data && typeof data === 'object' && 'type' in data && data.type === 'prepared-splats'
        ? (data as PreparedSplatData).hierarchy
          ? null
          : (data as PreparedSplatData).source
        : null;
  return source && source.positions.length / 3 >= SPLAT_CAPTURE_MIN_COUNT ? source : null;
}

/** Normalize direct assets and owner rows while retaining each original accessor context. */
export function resolveSplatInput<DataT>(props: {
  data: DataT[] | SplatDataInput;
  getSource: Accessor<DataT, SplatDataInput>;
}): ResolvedSplatInput<DataT> {
  const direct = isSplatDataInput(props.data);
  let data: DataT[];
  if (direct) {
    if (props.getSource !== DEFAULT_GET_SOURCE)
      throw new Error('SplatLayer getSource applies to instance rows, not direct asset data.');
    data = getSplatInstanceRows(props.data as SplatDataInput) as DataT[];
  } else {
    if (!Array.isArray(props.data))
      throw new Error('SplatLayer data must be a prepared asset or an array of instance rows.');
    data = props.data;
  }
  const assets = new Set<ResolvedSplatAsset>();
  const pending = new Set<SplatFile>();
  const failed = new Set<SplatFile>();
  const info = {data, index: -1, target: []} as AccessorContext<DataT>;
  const rowAssets = data.map((row, index) => {
    info.index = index;
    const input = direct
      ? (props.data as SplatDataInput)
      : typeof props.getSource === 'function'
        ? props.getSource(row, info)
        : props.getSource;
    if (isSplatFileInput(input)) {
      // one load per file; its rows draw nothing until it is decoded
      const file = getSplatFile(input);
      if (file.error) failed.add(file);
      else if (!file.source) pending.add(file);
      if (!file.source) return undefined;
    }
    const asset = resolveSplatAsset(input);
    assets.add(asset);
    return asset;
  });
  return {
    data,
    rowAssets,
    assets: [...assets].sort((a, b) => a.id - b.id),
    pending: [...pending],
    failed: [...failed]
  };
}
