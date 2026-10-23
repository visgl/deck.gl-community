// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Season, TreeCharacteristics} from '@deck.gl-community/layers';
import type {SettingDescriptor, SettingsSchema} from '@deck.gl-community/panels';

/** TreeLayer props driven by the demo's settings panel. */
export type FarmSettings = {
  season: Season;
  crops: boolean;
  windStrength: number;
  sizeScale: number;
  characteristics: Required<TreeCharacteristics>;
};

export const DEFAULT_FARM_SETTINGS: FarmSettings = {
  season: 'spring',
  crops: true,
  windStrength: 0,
  sizeScale: 1,
  characteristics: {
    seed: 0,
    crownSpread: 1,
    crownDepth: 1,
    crownAsymmetry: 1,
    branchDensity: 1,
    branchLift: 1,
    internodeLength: 1,
    leafSize: 1,
    leafDensity: 1
  }
};

// Geometry props regenerate tree templates, so sliders only apply once dragging pauses.
const GEOMETRY_SLIDER_DEBOUNCE_MS = 150;

function crownSetting(
  name: keyof TreeCharacteristics,
  label: string,
  min: number,
  max: number,
  step = 0.05
): SettingDescriptor {
  return {
    name: `characteristics.${name}`,
    label,
    type: 'number',
    min,
    max,
    step,
    sliderDebounceMs: GEOMETRY_SLIDER_DEBOUNCE_MS
  };
}

/** Panel schema for the TreeLayer props exposed by the demo. */
export const SETTINGS_SCHEMA: SettingsSchema = {
  sections: [
    {
      name: 'Trees',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'season',
          label: 'Season',
          type: 'select',
          options: [
            {label: 'Spring', value: 'spring'},
            {label: 'Summer', value: 'summer'},
            {label: 'Autumn', value: 'autumn'},
            {label: 'Winter', value: 'winter'}
          ]
        },
        {name: 'crops', label: 'Fruit & flowers', type: 'boolean'},
        {name: 'windStrength', label: 'Wind', type: 'number', min: 0, max: 0.1, step: 0.005},
        {
          name: 'sizeScale',
          label: 'Size',
          type: 'number',
          min: 0.5,
          max: 1.5,
          step: 0.05,
          sliderDebounceMs: GEOMETRY_SLIDER_DEBOUNCE_MS
        }
      ]
    },
    {
      name: 'Crown',
      description: 'Shared broadleaf characteristics. Pine and palm keep their own shapes.',
      initiallyCollapsed: true,
      settings: [
        crownSetting('seed', 'Seed', 0, 99, 1),
        crownSetting('crownSpread', 'Spread', 0.6, 1.5),
        crownSetting('crownDepth', 'Depth', 0.6, 1.4),
        crownSetting('crownAsymmetry', 'Asymmetry', 0, 2),
        crownSetting('branchDensity', 'Branches', 0.5, 1.5),
        crownSetting('branchLift', 'Branch lift', 0, 3, 0.1),
        crownSetting('internodeLength', 'Internode', 0.7, 1.4),
        crownSetting('leafSize', 'Leaf size', 0.5, 1.8),
        crownSetting('leafDensity', 'Leaf density', 0.25, 2)
      ]
    }
  ]
};
