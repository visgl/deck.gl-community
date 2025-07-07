// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrthographicController, OrthographicView} from '@deck.gl/core';

import {fitBoundsOrthographic} from '../views/orthographic-utils';
import {mergeViewStates} from '../views/view-state-utils';

import type {OptionalViewState} from '../views/view-state-utils';
import type {OrthographicViewState} from '@deck.gl/core';

export const HEADER_VIEW_HEIGHT = 50;
export const LEGEND_VIEW_WIDTH = 150;

export const SYNCHRONIZED_VIEWS = [
  new OrthographicView({
    id: 'main',
    flipY: false,
    clear: true, // [1, 1, 1, 1],
    x: LEGEND_VIEW_WIDTH,
    width: `calc(100% - ${LEGEND_VIEW_WIDTH}px`,
    y: HEADER_VIEW_HEIGHT,
    height: `calc(100% - ${HEADER_VIEW_HEIGHT}px)`,
    controller: {
      type: OrthographicController,
      // @ts-expect-error Specific to OrthographicController
      zoomAxis: 'X',
      inertia: false,
      scrollZoom: true
    }
  }),
  new OrthographicView({
    id: 'header',
    flipY: false,
    clear: true, // [1, 1, 1, 1],
    x: LEGEND_VIEW_WIDTH,
    width: `calc(100% - ${LEGEND_VIEW_WIDTH}px)`,
    height: 50,
    controller: false
  }),
  new OrthographicView({
    id: 'legend',
    flipY: false,
    clear: true, // [1, 1, 1, 1],
    x: 0,
    width: LEGEND_VIEW_WIDTH,
    y: HEADER_VIEW_HEIGHT,
    height: `calc(100% - ${HEADER_VIEW_HEIGHT}px)`,
    controller: false
  })
];

export const SYNCHRONIZED_VIEW_STATE_CONSTRAINTS = {
  header: {target: [undefined, 20], zoom: [undefined, 0]} satisfies OptionalViewState,
  legend: {target: [-30, undefined], zoom: [1, undefined]} satisfies OptionalViewState
};

export function getSynchronizedViewStates(viewState: OrthographicViewState) {
  return {
    header: mergeViewStates(viewState, SYNCHRONIZED_VIEW_STATE_CONSTRAINTS.header),
    legend: mergeViewStates(viewState, SYNCHRONIZED_VIEW_STATE_CONSTRAINTS.legend),
    main: viewState
  };
}

export function fitSynchronizedViewStatesToBounds(props: {
  viewState: {
    header: OrthographicViewState;
    legend: OrthographicViewState;
    main: OrthographicViewState;
  };
  width: number;
  height: number;
  bounds: [[xMin: number, yMin: number], [xMax: number, yMax: number]];
  /** App should set to true on first call */
  initialize: boolean;
  headerHeight?: number;
  legendWidth?: number;
}): {
  header: OrthographicViewState;
  legend: OrthographicViewState;
  main: OrthographicViewState;
} {
  const {viewState, initialize} = props;
  const {headerHeight = HEADER_VIEW_HEIGHT, legendWidth = LEGEND_VIEW_WIDTH} = props;

  // Handle cases where the window size is too small for the header and/or legend
  const width = Math.max(props.width - legendWidth, 1);
  const height = Math.max(props.height - headerHeight, 1);

  const {target, zoom} = fitBoundsOrthographic(width, height, props.bounds, 'per-axis');
  target[1] = target[1] - 1.5; // ADD SOME TIME SPACE

  let mainViewState: OrthographicViewState;
  // Avoid messing with y axis if we have already fitted the view state
  if (initialize) {
    mainViewState = {...viewState.main, target, zoom};
  } else {
    mainViewState = {
      ...viewState.main,
      target: [viewState.main.target[0], target[1]],
      zoom: [(viewState.main.zoom as [number, number])[0], zoom[1]]
    };
  }
  const newViewState = {
    ...viewState,
    main: mainViewState,
    header: mergeViewStates(mainViewState, SYNCHRONIZED_VIEW_STATE_CONSTRAINTS.header),
    legend: mergeViewStates(mainViewState, SYNCHRONIZED_VIEW_STATE_CONSTRAINTS.legend)
  };
  return newViewState;
}
