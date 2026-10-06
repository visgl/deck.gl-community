// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, WebMercatorViewport} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {getDistanceScales, lngLatToWorld, pixelsToWorld} from '@math.gl/web-mercator';
import type {EditModeProjection} from '../edit-modes/types';
import type {Position} from './geojson-types';

/** Pairs layer projection with its inverse for planar geographic and Cartesian views. */
export function createLayerProjection(layer: Layer): EditModeProjection | undefined {
  const viewport = layer.internalState?.viewport || layer.context?.viewport;
  if (
    !viewport?.pixelUnprojectionMatrix ||
    (viewport.isGeospatial && !(viewport instanceof WebMercatorViewport))
  )
    return undefined;
  const {coordinateOrigin: origin, modelMatrix} = layer.props;
  const coordinateSystem =
    layer.props.coordinateSystem === COORDINATE_SYSTEM.DEFAULT
      ? viewport.isGeospatial
        ? COORDINATE_SYSTEM.LNGLAT
        : COORDINATE_SYSTEM.CARTESIAN
      : layer.props.coordinateSystem;
  const matrix = modelMatrix ? new Matrix4(modelMatrix) : undefined;
  const inverse = matrix && matrix.determinant() !== 0 ? matrix.invert() : undefined;
  const originWorld =
    coordinateSystem === COORDINATE_SYSTEM.METER_OFFSETS ? lngLatToWorld(origin) : undefined;
  const scales = originWorld
    ? getDistanceScales({longitude: origin[0], latitude: origin[1], highPrecision: true})
    : undefined;
  return {
    project: position => layer.project(position),
    unproject: screenPosition => {
      if (matrix && !inverse) return undefined;
      const common = pixelsToWorld(screenPosition, viewport.pixelUnprojectionMatrix).slice(0, 3);
      let position: Position;
      if (coordinateSystem === COORDINATE_SYSTEM.CARTESIAN) {
        position = viewport.isGeospatial
          ? common.map((value, index) => value - origin[index])
          : viewport.unprojectPosition(common);
      } else {
        const [longitude, latitude] = viewport.unprojectFlat(common);
        // Derive the forward altitude scale rather than relying on SDK inverse altitude math.
        const altitudeScale =
          viewport.projectPosition([longitude, latitude, 1])[2] -
          viewport.projectPosition([longitude, latitude, 0])[2];
        const altitude = common[2] / altitudeScale;
        if (coordinateSystem === COORDINATE_SYSTEM.LNGLAT_OFFSETS) {
          position = [longitude - origin[0], latitude - origin[1], altitude - (origin[2] || 0)];
        } else if (coordinateSystem === COORDINATE_SYSTEM.METER_OFFSETS && originWorld && scales) {
          // Invert addMetersToLngLat's latitude-dependent common-space offsets.
          const dx = common[0] - originWorld[0];
          const dy = common[1] - originWorld[1];
          const [ux, uy] = scales.unitsPerMeter;
          const [ux2, uy2] = scales.unitsPerMeter2;
          const y = (2 * dy) / (uy + Math.sqrt(uy * uy + 4 * uy2 * dy));
          position = [dx / (ux + ux2 * y), y, altitude - (origin[2] || 0)];
        } else {
          position = [longitude, latitude, altitude];
        }
      }
      if (!position.every(Number.isFinite)) return undefined;
      if (inverse) position = Array.from(inverse.transform([...position, 1])).slice(0, 3);
      return position.every(Number.isFinite) ? position : undefined;
    }
  };
}
