/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import {type Axis, type Stage} from '../interfaces';
import type {Color} from '../legacy-types';
import {type Mark, type Orient, type Scene, type SceneGroup} from 'vega';

export enum GroupType {
  none = 0,
  legend = 1,
  xAxis = 2,
  yAxis = 3,
  zAxis = 4
}

export interface MarkStagerOptions {
  maxOrdinal: number;
  currAxis: Axis;
  defaultCubeColor: Color;
  assignCubeOrdinal: (d: object) => number | undefined;
  zAxisZindex: number;
}

// TODO - use vega-typings below
export type AxisSceneGroup = SceneGroup & {
  datum?: any;
  orient?: Orient;
  mark: Mark;
};
export interface LabelDatum {
  value: any;
}
// TODO - use vega-typings above

export interface MarkStager {
  (
    options: MarkStagerOptions,
    stage: Stage,
    scene: Scene,
    x: number,
    y: number,
    groupType: GroupType
  ): void;
}
