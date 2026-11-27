// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {
  ORBIT_CLASSES,
  classifyOrbit,
  getGroundTrack,
  getOrbitPath,
  getOrbitalPeriodMinutes,
  interpolateLngLatAlt,
  propagateToLngLatAlt,
  type OrbitClass
} from './orbit-layer/orbit-math';
export {createSatRec, type GpFormat, type GpRecord} from './orbit-layer/gp-records';
export {parseGpRecords, toGpRecords} from './orbit-layer/load-gp-records';
export {
  OrbitLayer,
  type OrbitLayerData,
  type OrbitLayerProps,
  type OrbitSatellite
} from './orbit-layer/orbit-layer';
export {OrbitSampleClock} from './orbit-layer/orbit-sample-clock';
export {
  createOrbitPropagator,
  isCurrentGeneration,
  type OrbitInitResult,
  type OrbitPropagator,
  type OrbitSample
} from './orbit-layer/orbit-propagator';
