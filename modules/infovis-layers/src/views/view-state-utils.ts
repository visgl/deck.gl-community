// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import { OrthographicViewState } from '@deck.gl/core';

export type OptionalizedViewState<T> = {
  [K in keyof T]: T[K] extends [number, number] | undefined
    ? [number | undefined, number | undefined] | undefined
    : T[K] extends [number, number, number] | undefined
      ? [number | undefined, number | undefined, number | undefined] | undefined
      : T[K] extends [number, number] | number | undefined
        ? [number | undefined, number | undefined] | undefined
        : T[K] extends [number, number, number] | [number, number] | undefined
          ?
              | [number | undefined, number | undefined, number | undefined]
              | [number | undefined, number | undefined]
              | undefined
          : T[K];
};

export type OptionalViewState = OptionalizedViewState<OrthographicViewState>;

export function mergeViewStates(
  viewState1: OrthographicViewState,
  viewState2: OptionalViewState,
): OrthographicViewState {
  const target1 = viewState1.target ?? [0, 0];
  const zoom1 = viewState1.zoom ?? [1, 1];
  const mergedViewState = {
    ...viewState1,
    ...viewState2,
    target: [viewState2.target?.[0] ?? target1[0], viewState2.target?.[1] ?? target1[1]],
    zoom: [
      // @ts-expect-error view state typing is awfully optional
      viewState2.zoom?.[0] ?? zoom1[0],
      // @ts-expect-error view state typing is awfully optional
      viewState2.zoom?.[1] ?? zoom1[1],
    ],
  };
  // @ts-expect-error view state typing is awfully optional
  validateViewState(mergedViewState);
  // @ts-expect-error view state typing is awfully optional
  return mergedViewState;
}

export function validateViewState(
  viewState: OrthographicViewState,
): viewState is OrthographicViewState {
  const isTargetValid =
    Array.isArray(viewState.target) &&
    viewState.target[0] !== undefined &&
    !Number.isNaN(viewState.target[0]) &&
    viewState.target[1] !== undefined &&
    !Number.isNaN(viewState.target[1]);
  const isZoomValid =
    Array.isArray(viewState.zoom) &&
    viewState.zoom[0] !== undefined &&
    !Number.isNaN(viewState.zoom[0]) &&
    viewState.zoom[1] !== undefined &&
    !Number.isNaN(viewState.zoom[1]);

  if (!isTargetValid || !isZoomValid) {
    console.warn('Invalid viewState:', viewState);
  }

  return isTargetValid && isZoomValid;
}
