// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SettingsSchema} from '@deck.gl-community/panels';

/** Where the garden's wind comes from: one wind everywhere, or interpolated weather stations. */
export type WindSource = 'uniform' | 'stations';

/** The garden's WindEffect, lighting and layer visibility, driven by the settings panel. */
export type GardenSettings = {
  /** Speed in m/s at 10 m, and the effect's direction, gusts and turbulence. */
  wind: {speed: number; direction: number; gust: number; turbulence: number};
  source: WindSource;
  frozen: boolean;
  shadows: boolean;
  layers: {trees: boolean; reeds: boolean; columns: boolean; cells: boolean; scan: boolean};
};

export const DEFAULT_GARDEN_SETTINGS: GardenSettings = {
  wind: {speed: 6, direction: 90, gust: 0.3, turbulence: 1},
  source: 'uniform',
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
        {
          name: 'source',
          label: 'Wind source',
          description:
            'Uniform: the Wind and Wind direction controls everywhere. Stations: five weather stations around the garden, calm in the southwest and windy in the northeast.',
          type: 'select',
          options: [
            {label: 'Uniform', value: 'uniform'},
            {label: 'Stations', value: 'stations'}
          ]
        },
        {
          name: 'wind.speed',
          label: 'Wind (m/s)',
          description: 'Speed at the 10 m reference height. 5 m/s is a gentle breeze.',
          type: 'number',
          min: 0,
          max: 25,
          step: 0.5
        },
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
