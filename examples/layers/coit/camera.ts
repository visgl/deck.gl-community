// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FirstPersonController, type FirstPersonViewState} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';

// The authored capture camera uses RAD source axes. Apply the same source-to-world pose
// to its eye, target and Gaussians, then use practical world units for navigation.
const WORLD_SCALE = 1000;
const SOURCE_TARGET = [0.0226670563, -0.1886351632, 0.0141479052];
const SOURCE_EYE = [-0.0858, -0.2203, 0.1128];
/** Source-local to deck Cartesian world. */
export const MODEL_MATRIX = new Matrix4().scale(WORLD_SCALE).rotateX(-Math.PI / 2);
/** Authored pivot retained as a visual reference, not a movement constraint. */
export const TARGET = MODEL_MATRIX.transformAsPoint(SOURCE_TARGET) as [number, number, number];
const WORLD_EYE = MODEL_MATRIX.transformAsPoint(SOURCE_EYE) as [number, number, number];
/** Fixed world-space lens and clipping distances, independent of camera movement. */
export const CAMERA_PROPS = {fovy: 75, near: 2, far: 100_000};

/** Reproduce the authored view with an explicit eye and orientation. */
export function getInitialViewState(): FirstPersonViewState {
  const direction = TARGET.map((value, index) => value - WORLD_EYE[index]);
  return {
    position: [...WORLD_EYE],
    bearing: (Math.atan2(direction[0], direction[1]) * 180) / Math.PI,
    pitch: (-Math.asin(direction[2] / Math.hypot(...direction)) * 180) / Math.PI
  };
}

/** First-person deck input with camera-axis dolly, as in Spark PointerControls.
 * Stock first-person wheel movement is horizontal; inspection needs the full pitch.
 * Input still flows through deck's controller and one canonical view state.
 */
export class SplatCameraController extends FirstPersonController {
  constructor(options: ConstructorParameters<typeof FirstPersonController>[0]) {
    super(options);
    const BaseState = this.ControllerState;
    this.ControllerState = class SplatCameraState extends BaseState {
      _getUpdatedState(newProps: Record<string, any>): SplatCameraState {
        return new SplatCameraState({
          ...this.getViewportProps(),
          ...this.getState(),
          ...newProps,
          makeViewport: this.makeViewport
        });
      }

      zoom({scale}: {pos: [number, number]; scale: number}) {
        return this._move(
          this.getDirection(),
          Math.log2(scale) * 20,
          this.getState().startZoomPosition || this.getViewportProps().position
        );
      }
      zoomIn(speed = 2) {
        return this.zoom({pos: [0, 0], scale: speed});
      }
      zoomOut(speed = 2) {
        return this.zoom({pos: [0, 0], scale: 1 / speed});
      }
    };
  }
}
