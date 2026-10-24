// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SettingsSchema} from '@deck.gl-community/panels';

/** The garden's WindEffect, lighting and layer visibility, driven by the settings panel. */
export type GardenSettings = {
  wind: {strength: number; direction: number; gust: number; turbulence: number};
  frozen: boolean;
  shadows: boolean;
  layers: {trees: boolean; reeds: boolean; columns: boolean; cells: boolean; scan: boolean};
};

export const DEFAULT_GARDEN_SETTINGS: GardenSettings = {
  wind: {strength: 0.03, direction: 90, gust: 0.3, turbulence: 1},
  frozen: false,
  shadows: false,
  layers: {trees: true, reeds: true, columns: true, cells: true, scan: true}
};

export const SETTINGS_SCHEMA: SettingsSchema = {
  sections: [
    {
      name: 'WindEffect',
      initiallyCollapsed: false,
      settings: [
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
          name: 'wind.turbulence',
          label: 'Turbulence',
          description: 'Crown flutter on top of the bend.',
          type: 'number',
          min: 0,
          max: 2,
          step: 0.1
        },
        {
          name: 'frozen',
          label: 'Freeze',
          description: 'Fix the wind clock to inspect one pose.',
          type: 'boolean'
        }
      ]
    },
    {
      name: 'Layers',
      description: 'Every layer follows the same WindEffect.',
      initiallyCollapsed: false,
      settings: [
        {name: 'layers.trees', label: 'TreeLayer', type: 'boolean'},
        {name: 'layers.reeds', label: 'SimpleMeshLayer', type: 'boolean'},
        {name: 'layers.columns', label: 'ColumnLayer', type: 'boolean'},
        {name: 'layers.cells', label: 'GridCellLayer', type: 'boolean'},
        {name: 'layers.scan', label: 'PointCloudLayer', type: 'boolean'}
      ]
    },
    {
      name: 'Lighting',
      initiallyCollapsed: true,
      settings: [
        {
          name: 'shadows',
          label: 'Shadows',
          description: 'A shadow-casting sun (WebGL2): shadows bend with the geometry.',
          type: 'boolean'
        }
      ]
    }
  ]
};
