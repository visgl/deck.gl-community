// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Season, TreeCharacteristics} from '@deck.gl-community/layers';
import type {SettingsSchema} from '@deck.gl-community/panels';

export const CROWN_PROFILES: Record<string, {label: string; characteristics: TreeCharacteristics}> =
  {
    natural: {
      label: 'Natural',
      characteristics: {crownDepth: 1, crownAsymmetry: 1, branchDensity: 1, branchLift: 1}
    },
    open: {
      label: 'Open',
      characteristics: {
        crownDepth: 0.9,
        crownAsymmetry: 1.15,
        branchDensity: 0.82,
        branchLift: 1.1
      }
    },
    lush: {
      label: 'Lush',
      characteristics: {
        crownDepth: 1.08,
        crownAsymmetry: 1.18,
        branchDensity: 1.18,
        branchLift: 0.92
      }
    },
    sculpted: {
      label: 'Sculpted',
      characteristics: {
        crownDepth: 1.14,
        crownAsymmetry: 0.62,
        branchDensity: 0.9,
        branchLift: 1.22
      }
    }
  };

/** TreeLayer props driven by the demo's settings panel. */
export type TreeLabSettings = {
  season: Season;
  crownProfile: string;
  crownSpread: number;
  leafSize: number;
  leafDensity: number;
  windStrength: number;
  maxCanopySplats: 'auto' | number;
  maxCanopyPixels: number;
  foveationStrength: number;
};

export const DEFAULT_TREE_LAB_SETTINGS: TreeLabSettings = {
  season: 'summer',
  crownProfile: 'natural',
  crownSpread: 1,
  leafSize: 1,
  leafDensity: 1,
  windStrength: 0,
  maxCanopySplats: 'auto',
  maxCanopyPixels: Infinity,
  // Ranks constrained canopy refinement toward the screen center without capping any crown.
  foveationStrength: 1
};

// Crown settings regenerate shared tree templates, so sliders apply once dragging pauses.
const CROWN_SLIDER_DEBOUNCE_MS = 200;

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
        {
          name: 'crownProfile',
          label: 'Crown',
          type: 'select',
          options: Object.entries(CROWN_PROFILES).map(([value, profile]) => ({
            label: profile.label,
            value
          }))
        },
        {
          name: 'crownSpread',
          label: 'Spread',
          type: 'number',
          min: 0.75,
          max: 1.25,
          step: 0.05,
          sliderDebounceMs: CROWN_SLIDER_DEBOUNCE_MS
        },
        {
          name: 'leafSize',
          label: 'Leaf size',
          type: 'number',
          min: 0.7,
          max: 1.4,
          step: 0.05,
          sliderDebounceMs: CROWN_SLIDER_DEBOUNCE_MS
        },
        {
          name: 'leafDensity',
          label: 'Leaf density',
          type: 'number',
          min: 0.7,
          max: 1.35,
          step: 0.05,
          sliderDebounceMs: CROWN_SLIDER_DEBOUNCE_MS
        },
        {name: 'windStrength', label: 'Wind', type: 'number', min: 0, max: 0.08, step: 0.005}
      ]
    },
    {
      name: 'Rendering',
      initiallyCollapsed: true,
      settings: [
        {
          name: 'maxCanopySplats',
          label: 'Splat budget',
          description: 'Shared foliage Gaussian budget. Auto picks one for the device.',
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
          description: 'Pixel cap for the foliage render target.',
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
          description: 'Favors crowns near the screen center under a tight budget.',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05
        }
      ]
    }
  ]
};
