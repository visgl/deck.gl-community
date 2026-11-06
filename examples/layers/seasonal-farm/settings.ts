// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Season, TreeCharacteristics, WindEffectProps} from '@deck.gl-community/layers';
import type {SettingDescriptor, SettingsSchema} from '@deck.gl-community/panels';

/** TreeLayer and WindEffect props driven by the demo's settings panel. */
export type FarmSettings = {
  season: Season;
  crops: boolean;
  /** The scene's WindEffect: the trees follow it. */
  wind: Required<Pick<WindEffectProps, 'strength' | 'direction' | 'gust'>>;
  sizeScale: number;
  characteristics: Required<TreeCharacteristics>;
  maxCanopySplats: 'auto' | number;
  maxCanopyPixels: number;
  foveationStrength: number;
};

export const DEFAULT_FARM_SETTINGS: FarmSettings = {
  season: 'spring',
  crops: true,
  wind: {strength: 0, direction: 90, gust: 0},
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
  },
  maxCanopySplats: 'auto',
  maxCanopyPixels: Infinity,
  foveationStrength: 0
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
        {name: 'wind.strength', label: 'Wind', type: 'number', min: 0, max: 0.1, step: 0.005},
        {
          name: 'wind.direction',
          label: 'Wind direction',
          description: 'Compass bearing the wind blows toward.',
          type: 'number',
          min: 0,
          max: 345,
          step: 15
        },
        {
          name: 'wind.gust',
          label: 'Gusts',
          description: 'How far the wind swells above and below its strength.',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05
        },
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
    },
    {
      name: 'Rendering',
      initiallyCollapsed: true,
      settings: [
        {
          name: 'maxCanopySplats',
          label: 'Splat budget',
          description: 'Shared foliage splat budget. Auto picks one for the device.',
          type: 'select',
          options: [
            {label: 'Auto', value: 'auto'},
            {label: '5,000', value: 5_000},
            {label: '20,000', value: 20_000},
            {label: '100,000', value: 100_000}
          ]
        },
        {
          name: 'maxCanopyPixels',
          label: 'Canopy pixels',
          description: 'Pixel cap for foliage rendering. Lower values soften leaves.',
          type: 'select',
          options: [
            {label: 'Full', value: Infinity},
            {label: '1 MP', value: 1_000_000},
            {label: '0.25 MP', value: 250_000}
          ]
        },
        {
          name: 'foveationStrength',
          label: 'Foveation',
          description: 'Under a tight budget, favors crowns near the screen center.',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05
        }
      ]
    }
  ]
};
