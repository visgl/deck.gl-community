// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mountStandaloneExample} from '../../mount-example';
import {mountSatelliteOrbitsExample, type SatelliteOrbitsExampleProps} from './app';

// URL parameters, for example `?group=active&format=tle&speed=10&select=25544&follow`.
const params = new URLSearchParams(window.location.search);
const number = (name: string) => (params.has(name) ? Number(params.get(name)) : undefined);
const view = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'].filter(key => params.has(key));

mountStandaloneExample<SatelliteOrbitsExampleProps>(mountSatelliteOrbitsExample, {
  group: params.get('group') ?? undefined,
  format: params.get('format') === 'tle' ? 'tle' : 'json',
  speed: number('speed'),
  selectNoradId: number('select'),
  follow: params.has('follow'),
  showTracks: params.get('tracks') !== '0',
  cullPaths: params.has('cullPaths'),
  farZMultiplier: number('farZMultiplier'),
  viewProps: params.has('cameraRelative') ? {_cameraRelative: true} : undefined,
  initialViewState: Object.fromEntries(view.map(key => [key, Number(params.get(key))])),
  // Measurement scripts read this handle; see the README.
  onReady: params.has('measure')
    ? handle => Object.assign(window, {satelliteOrbits: handle})
    : undefined
});
