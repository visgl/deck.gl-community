/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

/**
 * This file is for external facing export only, do not use this for internal references,
 * as it may cause circular dependencies in Rollup.
 */

import {
  type Axis,
  type Cube,
  type FacetRect,
  type GeographicMark,
  type Legend,
  type LegendRow,
  type LegendRowSymbol,
  type PresenterConfig,
  type PresenterStyle,
  type PreStage,
  type QueuedAnimationOptions,
  type Scene3d,
  type Stage,
  type SymbolMark,
  type StyledLine,
  type TickText,
  type TransitionDurations,
  type Vec3,
  type VegaTextLayerDatum
} from '../interfaces';
import {type Base, type DeckBase, type DeckLayerBase, type LumaBase, type VegaBase} from '../base';
import {type CubeLayerProps} from '../cube-layer/cube-layer';
import {type ViewGlConfig} from '../vega-classes/view-gl';

// alphabetize interfaces  for documentation
export type {
  Axis,
  Base,
  Cube,
  DeckBase,
  DeckLayerBase,
  FacetRect,
  GeographicMark,
  Legend,
  LegendRow,
  LegendRowSymbol,
  LumaBase,
  PreStage,
  PresenterConfig,
  PresenterStyle,
  QueuedAnimationOptions,
  Scene3d,
  Stage,
  SymbolMark,
  StyledLine,
  TickText,
  TransitionDurations,
  VegaBase,
  VegaTextLayerDatum,
  ViewGlConfig
};

// alphabetize types  for documentation
export type {CubeLayerProps, Vec3};
