// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SettingsSchema} from '@deck.gl-community/panels';

/** Flame appearance controls rendered by the shared example panel. */
export const SETTINGS_SCHEMA: SettingsSchema = {
  sections: [
    {
      name: 'Appearance',
      settings: [
        {name: 'trailLength', label: 'Length', type: 'number', min: 10, max: 120, step: 1},
        {
          name: 'width',
          label: 'Width (px)',
          description: 'Path width in pixels. Flame height scales with width.',
          type: 'number',
          min: 4,
          max: 100,
          step: 1
        },
        {name: 'color', label: 'Color', type: 'select', options: ['Natural', 'Ember', 'Violet']}
      ]
    }
  ]
};
