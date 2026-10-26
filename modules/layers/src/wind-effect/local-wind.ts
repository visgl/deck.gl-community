// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getWindStrength} from './wind-module';

/** Wind at one place: what a station, forecast grid or shelter model reports there. */
export type LocalWind = {
  /** Wind speed in m/s at the 10 m reference height. */
  speed: number;
  /** Compass bearing the wind blows toward, in degrees clockwise from north. */
  direction?: number;
};

/**
 * Samples the wind at a position, or returns null where it has no data. `time` is passed through
 * in the sampler's own units, for example a forecast frame.
 */
export type WindSampler = (position: readonly number[], time: number) => LocalWind | null;

/** Options for {@link getLocalWindStrengths}. */
export type LocalWindStrengthOptions<DataT> = {
  /** Where to sample each object. @default object.position, as in `TreeSpec` */
  getPosition?: (object: DataT, index: number) => readonly number[] | null | undefined;
  /** Passed to the sampler. @default 0 */
  time?: number;
};

/**
 * Per-object bend strengths from local wind, for `TreeSpec.wind`. Each strength is
 * `getWindStrength` of the sampled speed. A pinned tree still takes its direction, gusts and clock
 * from the deck's `WindEffect`, so sampled directions do not reach the bend.
 * @param data - Objects to sample, such as TreeLayer rows.
 * @param sampler - The local wind, for example an adapter over a station field.
 * @param options - Position accessor and sampler time.
 * @returns One strength per object, `undefined` where the sampler has no data: such a tree follows
 *   the scene's wind.
 *
 * @example
 * ```ts
 * const strengths = getLocalWindStrengths(trees, sampleStations);
 * new TreeLayer({data: trees.map((tree, i) => ({...tree, wind: strengths[i]}))});
 * ```
 */
export function getLocalWindStrengths<DataT>(
  data: readonly DataT[],
  sampler: WindSampler,
  options: LocalWindStrengthOptions<DataT> = {}
): (number | undefined)[] {
  const {
    getPosition = (object: DataT) => (object as {position?: readonly number[]} | null)?.position,
    time = 0
  } = options;
  return data.map((object, index) => {
    const position = getPosition(object, index);
    const local = position ? sampler(position, time) : null;
    return local && Number.isFinite(local.speed) ? getWindStrength(local.speed) : undefined;
  });
}
