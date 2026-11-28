/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import type {Position} from './legacy-types';
import {type OrbitViewState} from '@deck.gl/core';
import {type View} from './view';

export const viewStateProps = ['target', 'rotationOrbit', 'rotationX', 'zoom'];

export function targetViewState(height: number, width: number, view: View): OrbitViewState {
  const target = [width / 2, -height / 2, 0] as Position;

  if (view === '2d') {
    return {
      target,
      rotationOrbit: 0,
      rotationX: 90,
      zoom: -0.2
    };
  }
  return {
    target,
    rotationOrbit: 25,
    rotationX: 30,
    zoom: -0.4
  };
}
