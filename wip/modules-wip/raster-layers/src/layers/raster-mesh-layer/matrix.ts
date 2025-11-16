// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import type {CoordinateSystem} from '@deck.gl/core';
import {COORDINATE_SYSTEM, Viewport} from '@deck.gl/core';

// only apply composeModelMatrix when in cartesian or meter_offsets coordinate system
// with `composeModelMatrix` enabled, the rotation part of the layer's modelMatrix will be composed to instance's transformations
// since rotating latitude and longitude can not provide meaningful results, hence `composeModelMatrix` is disabled
// when in LNGLAT and LNGLAT_OFFSET coordinates.
export function shouldComposeModelMatrix(
  viewport: Viewport,
  coordinateSystem: CoordinateSystem
): boolean {
  return (
    coordinateSystem === COORDINATE_SYSTEM.CARTESIAN ||
    coordinateSystem === COORDINATE_SYSTEM.METER_OFFSETS ||
    (coordinateSystem === COORDINATE_SYSTEM.DEFAULT && !viewport.isGeospatial)
  );
}
