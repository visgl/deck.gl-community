// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {FieldCamera} from '../field';
import type {ShellView} from './shell-field';

const METRES_AROUND_EARTH = 40.03e6;
const LATITUDE = 28.1;
const MAP_ALTITUDE = 1.5;

/** Matches the field's perspective views in metres and device pixels. */
export function updateShellView(
  view: ShellView,
  camera: FieldCamera,
  width: number,
  height: number,
  dpr = 1
): void {
  const pixelsPerMetre =
    2 ** (camera.zoom + 9) / (METRES_AROUND_EARTH * Math.cos((LATITUDE * Math.PI) / 180));
  const distance = (MAP_ALTITUDE * height) / pixelsPerMetre;
  const pitch = (camera.pitch * Math.PI) / 180;
  const bearing = (camera.bearing * Math.PI) / 180;
  const sinBearing = Math.sin(bearing);
  const cosBearing = Math.cos(bearing);
  const sinPitch = Math.sin(pitch);
  const fx = sinBearing * sinPitch;
  const fy = cosBearing * sinPitch;
  const fz = -Math.cos(pitch);
  view.position[0] = camera.east - fx * distance;
  view.position[1] = camera.north - fy * distance;
  view.position[2] = camera.up - fz * distance;
  view.forward[0] = fx;
  view.forward[1] = fy;
  view.forward[2] = fz;
  view.right[0] = cosBearing;
  view.right[1] = -sinBearing;
  view.right[2] = 0;
  // Up on screen is right crossed with forward.
  view.up[0] = -sinBearing * fz;
  view.up[1] = -cosBearing * fz;
  view.up[2] = sinPitch;
  view.focal = MAP_ALTITUDE * height * dpr;
  view.tanY = 0.5 / MAP_ALTITUDE;
  view.tanX = view.tanY * (width / height);
}
