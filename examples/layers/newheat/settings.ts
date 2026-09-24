// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SettingsSchema} from '@deck.gl-community/panels';

/** The same schema-driven controls used by the other layer examples. */
export const SETTINGS_SCHEMA: SettingsSchema = {
  sections: [
    {
      name: 'Playback',
      initiallyCollapsed: false,
      settings: [
        {name: 'playing', label: 'Play trip', type: 'boolean'},
        {name: 'animateFlame', label: 'Animate flame', type: 'boolean'},
        {name: 'currentTime', label: 'Current time', type: 'number', min: 0, max: 300, step: 0.1},
        {name: 'speed', label: 'Trip speed', type: 'number', min: 0.1, max: 3, step: 0.1}
      ]
    },
    {
      name: 'Appearance',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'mode',
          label: 'Layer',
          type: 'select',
          options: [
            {value: 'fire', label: 'NewHeatLayer'},
            {value: 'trips', label: 'TripsLayer'}
          ]
        },
        {
          name: 'surface',
          label: 'Surface',
          type: 'select',
          options: [
            {value: 'terrain', label: 'Rugged terrain'},
            {value: 'flat', label: 'Flat ground'}
          ]
        },
        {name: 'followSurface', label: 'Follow surface', type: 'boolean'},
        {name: 'grid', label: 'Show mesh', type: 'boolean'},
        {name: 'fadeTrail', label: 'Fade trail', type: 'boolean'},
        {name: 'trailLength', label: 'Trail length', type: 'number', min: 0, max: 300, step: 1},
        {name: 'width', label: 'Width (px)', type: 'number', min: 4, max: 100, step: 1},
        {name: 'tint', label: 'Tint', type: 'select', options: ['Natural', 'Ember', 'Violet']}
      ]
    },
    {
      name: 'Recording',
      settings: [{name: 'orbit', label: 'Slow orbit', type: 'boolean'}]
    }
  ]
};
