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
 * Assets supported by the prepared rendering backend: prepared columns, a prepared descriptor, or
 * a Gaussian splat table decoded by `@loaders.gl/splats` (for example `SPZLoader`).
 */
export type SplatDataInput = SplatSource | PreparedSplatData | GaussianSplatsTable;

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
  rowAssets: ResolvedSplatAsset[];
};

type AssetCache = {
  defaultAsset?: ResolvedSplatAsset;
  hierarchies: WeakMap<SplatHierarchy, ResolvedSplatAsset>;
};
const ASSETS = new WeakMap<SplatSource, AssetCache>();
const INSTANCES = new WeakMap<SplatDataInput, SplatInstance[]>();
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
    Boolean(
      input && typeof input === 'object' && 'type' in input && input.type === 'prepared-splats'
    )
  );
}

/** Validate one source/hierarchy pair once without allocating a GPU resource. */
export function resolveSplatAsset(input: SplatDataInput): ResolvedSplatAsset {
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
    let instances = INSTANCES.get(props.data as SplatDataInput);
    if (!instances) {
      instances = [{splats: props.data as SplatDataInput, position: [0, 0, 0]}];
      INSTANCES.set(props.data as SplatDataInput, instances);
    }
    data = instances as DataT[];
  } else {
    if (!Array.isArray(props.data))
      throw new Error('SplatLayer data must be a prepared asset or an array of instance rows.');
    data = props.data;
  }
  const assets = new Set<ResolvedSplatAsset>();
  const info = {data, index: -1, target: []} as AccessorContext<DataT>;
  const rowAssets = data.map((row, index) => {
    info.index = index;
    const asset = resolveSplatAsset(
      direct
        ? (props.data as SplatDataInput)
        : typeof props.getSource === 'function'
          ? props.getSource(row, info)
          : props.getSource
    );
    assets.add(asset);
    return asset;
  });
  return {data, rowAssets, assets: [...assets].sort((a, b) => a.id - b.id)};
}
