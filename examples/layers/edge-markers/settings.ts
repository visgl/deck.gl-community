// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {EdgeMarkerLayerProps} from '@deck.gl-community/layers/common-layers';
import type {SettingsSchema} from '@deck.gl-community/panels';
import type {ViewMode} from './scene';

const DEFAULT_COUNT = 200;
const MIN_COUNT = 10;
const MAX_COUNT = 10_000;

export const MAX_DISTANCE: Record<ViewMode, number> = {
  map: 50_000,
  globe: 30_000_000,
  'first-person': 2_000
};

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'map' || value === 'globe' || value === 'first-person';
}

export function clampCount(count: number): number {
  return Number.isFinite(count)
    ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(count)))
    : DEFAULT_COUNT;
}

export function getInitialSettings(params: URLSearchParams, restoredView?: ViewMode) {
  const requestedView = params.get('view');
  const view = restoredView ?? (isViewMode(requestedView) ? requestedView : 'map');
  return {
    view,
    count: clampCount(Number(params.get('count') || DEFAULT_COUNT)),
    autoPan: params.get('autopan') === '1',
    labels: params.get('labels') === '1',
    margins: 24,
    minDistance: 0,
    maxDistance: MAX_DISTANCE[view],
    yStretch: 1,
    integerCoordinates: true,
    behindCamera: 'dock' as NonNullable<EdgeMarkerLayerProps['behindCamera']>,
    beyondHorizon: 'dock' as NonNullable<EdgeMarkerLayerProps['beyondHorizon']>,
    showOnScreen: true
  };
}

export function createSettingsSchema(view: ViewMode): SettingsSchema {
  const maxDistance = MAX_DISTANCE[view];
  return {
    sections: [
      {
        name: 'Settings',
        settings: [
          {
            name: 'view',
            label: 'View',
            type: 'select',
            options: [
              {label: 'Map', value: 'map'},
              {label: 'Globe', value: 'globe'},
              {label: 'First person', value: 'first-person'}
            ]
          },
          {
            name: 'count',
            label: 'Targets',
            type: 'number',
            min: MIN_COUNT,
            max: MAX_COUNT,
            step: 1
          },
          {name: 'autoPan', label: 'Slow auto pan', type: 'boolean'},
          {name: 'margins', label: 'Margins (px)', type: 'number', min: 0, max: 120, step: 1},
          {name: 'minDistance', label: 'Min distance (m)', type: 'number', min: 0, step: 1},
          {
            name: 'maxDistance',
            label: 'Max distance (m → ∞)',
            description: `${maxDistance.toLocaleString()} means infinite range.`,
            type: 'number',
            min: 0,
            max: maxDistance,
            step: 1
          },
          {name: 'yStretch', label: 'Y stretch', type: 'number', min: 1, max: 2, step: 0.05},
          {name: 'integerCoordinates', label: 'Whole device pixels', type: 'boolean'},
          {name: 'behindCamera', label: 'Behind camera', type: 'select', options: ['dock', 'hide']},
          {
            name: 'beyondHorizon',
            label: 'Beyond horizon',
            description: 'Applies to the globe view.',
            type: 'select',
            options: ['dock', 'hide', 'ignore']
          },
          {name: 'showOnScreen', label: 'Show on screen', type: 'boolean'},
          {name: 'labels', label: 'Labels', type: 'boolean'}
        ]
      }
    ]
  };
}
