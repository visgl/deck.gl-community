// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {EditToolsConfig} from './types';
import {makeDrawPoint} from './tools/draw-point';
import {makeDrawPolygon} from './tools/draw-polygon';
import {makeDeleteFeature} from './tools/delete-feature';
import {makeTranslateFeature} from './tools/translate-feature';
import {makeDrawLineString} from './tools/draw-line-string';
import {makeDrawRectangle} from './tools/draw-rectangle';
import {makeModifyFeature} from './tools/modify-feature';
import {makeRotateFeature} from './tools/rotate-feature';
import {makeScaleFeature} from './tools/scale-feature';
import {makeSplitPolygon} from './tools/split-polygon';
import {makeDuplicateFeature} from './tools/duplicate-feature';

/**
 * createEditTools — AI-forward tool factory for editable-layers.
 *
 * Returns a vocabulary of Vercel AI SDK v4-shaped tools (structural match,
 * no runtime `ai` dep required). Each tool has:
 *   - description: string  — used by LLMs to select the right tool
 *   - parameters: ZodSchema — validated args
 *   - execute(args): Promise<EditResult>  — direct geometry execution via turf
 *
 * Every execute() call is immutable: it reads the FeatureCollection via
 * config.getFeatureCollection(), computes a new FC, calls
 * config.onFeatureCollectionChange(newFc), and returns an EditResult.
 *
 * Usage:
 * ```ts
 * const tools = createEditTools({
 *   getFeatureCollection: () => featureCollectionState,
 *   onFeatureCollectionChange: setFeatureCollectionState,
 * });
 *
 * // In LLM tool call:
 * const result = await tools.draw_point.execute({ position: [-73.985, 40.748] });
 *
 * // In signal handler (thor → editable-layers bridge in USER code):
 * thor.on('fist', () => tools.delete_feature.execute({ featureIndex: hoveredIndex }));
 * ```
 */
export function createEditTools(config: EditToolsConfig) {
  return {
    draw_point: makeDrawPoint(config),
    draw_polygon: makeDrawPolygon(config),
    delete_feature: makeDeleteFeature(config),
    translate_feature: makeTranslateFeature(config),
    draw_line_string: makeDrawLineString(config),
    draw_rectangle: makeDrawRectangle(config),
    modify_feature: makeModifyFeature(config),
    rotate_feature: makeRotateFeature(config),
    scale_feature: makeScaleFeature(config),
    split_polygon: makeSplitPolygon(config),
    duplicate_feature: makeDuplicateFeature(config)
  };
}

export type {EditToolsConfig};
