// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SettingsSchema} from '@deck.gl-community/panels';
import type {SceneOptions} from './scene';

/** The same schema-driven controls used by the other layer examples. */
const SETTINGS_SCHEMA: SettingsSchema = {
  sections: [
    {
      name: 'Playback',
      initiallyCollapsed: true,
      settings: [
        {name: 'playing', label: 'Play trip', type: 'boolean'},
        {
          name: 'currentTime',
          label: 'Current time',
          description: 'Scrubbing pauses the trip. The flame keeps burning.',
          type: 'number',
          min: 0,
          max: 300,
          step: 0.1
        },
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
            {value: 'fire', label: 'FlameTrailLayer'},
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
        {
          name: 'width',
          label: 'Width (px)',
          description: 'Path width in pixels. Flame height scales with width.',
          type: 'number',
          min: 4,
          max: 100,
          step: 1
        },
        {name: 'tint', label: 'Tint', type: 'select', options: ['Natural', 'Ember', 'Violet']}
      ]
    },
    {
      name: 'Recording',
      settings: [{name: 'orbit', label: 'Slow orbit', type: 'boolean'}]
    }
  ]
};

/** Show only controls that affect the selected layer and surface. */
export function getSettingsSchema(
  options: Pick<SceneOptions, 'mode' | 'surface' | 'fadeTrail'>
): SettingsSchema {
  return {
    ...SETTINGS_SCHEMA,
    sections: SETTINGS_SCHEMA.sections.map(section => ({
      ...section,
      settings: section.settings
        .filter(setting => {
          if (setting.name === 'tint') return options.mode === 'fire';
          if (setting.name === 'followSurface') return options.surface === 'terrain';
          if (setting.name === 'trailLength') return options.fadeTrail;
          return true;
        })
        .map(setting =>
          setting.name === 'grid' && options.surface === 'flat'
            ? {...setting, label: 'Show grid'}
            : setting
        )
    }))
  };
}
