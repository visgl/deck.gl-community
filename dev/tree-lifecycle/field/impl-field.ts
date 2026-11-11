// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {FieldFrame, FieldTree} from './field';
import {getFieldDetailThresholds} from './field-detail';
import {getFieldLayers as getShellFieldLayers} from './impl-shell';

export {getFieldSetup, getFieldStats} from './impl-shell';

const DEFAULT_THRESHOLDS = getFieldDetailThresholds();

/**
 * Interactive 20,000-tree field. Near trees retain the photoreal renderer's leaves and wood;
 * background trees use shells fitted to those same botanical templates. The bounded near list
 * avoids promoting whole rows to full geometry on a dive. Both sides share lifecycle updates.
 * This is a dev integration of the measured prototypes, not the published TreeLayer API.
 */
export function getFieldLayers(trees: FieldTree[], frame: FieldFrame) {
  const {params} = frame;
  // Set defaults once, preserving the object identity shared by the controls and benchmark.
  params.nearMost ??= 8;
  params.nearIn ??= DEFAULT_THRESHOLDS.nearIn;
  params.nearOut ??= DEFAULT_THRESHOLDS.nearOut;
  params.finePixels ??= DEFAULT_THRESHOLDS.finePixels;
  params.tinyPixels ??= DEFAULT_THRESHOLDS.tinyPixels;
  params.cellColumns ??= 1;
  params.cellRows ??= 1;
  return getShellFieldLayers(trees, frame, true);
}
