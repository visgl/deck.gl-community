/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import {type DeckProps} from '@deck.gl/core';
import type {Color, Position} from './legacy-types';
import type {AlignmentBaseline, TextAnchor} from './text-types';
import {type View} from './view';
import {type Scene} from 'vega';
// import { LightSettings } from '@deck.gl/core';

export interface VegaTextLayerDatum {
  color: Color;
  text: string;
  position: Position;
  size: number;
  angle?: number;
  textAnchor?: TextAnchor;
  alignmentBaseline?: AlignmentBaseline;
  metaData?: any;
}

export interface StyledLine {
  color?: Color;
  sourcePosition: Vec3;
  strokeWidth?: number;
  targetPosition: Vec3;
}

export interface TickText extends VegaTextLayerDatum {
  value: number | string;
}

export type AxisRole = 'x' | 'y' | 'z';

export interface Axis {
  domain: StyledLine;
  ticks: StyledLine[];
  tickText: TickText[];
  title?: VegaTextLayerDatum;
  role?: AxisRole;
}

/**
 * 3 dimensional array of numbers.
 */
export type Vec3 = [number, number, number];

/**
 * Cuboid information. The cube does not need to have equal dimensions.
 */
export interface Cube {
  /**
   * Ordinal position.
   */
  ordinal?: number;

  /**
   * Flag whether this cube is a "placeholder" and is not to be rendered nor contains cube data.
   */
  isEmpty?: boolean;

  color: Color;
  position: Vec3;
  size: Vec3;
}

/** A Vega circle symbol, sized by area in chart coordinates. */
export interface SymbolMark {
  datum: unknown;
  position: Vec3;
  radius: number;
  fillColor: Color;
  strokeColor: Color;
  strokeWidth: number;
}

export interface Path {
  positions: Position[];
  strokeColor: Color;
  strokeWidth: number;
}

export interface Polygon {
  isSymbol?: boolean;
  datum?: unknown;
  positions: Position[];
  strokeColor: Color;
  fillColor: Color;
  strokeWidth: number;
  depth: number;
}
/**
 * Vega Scene plus camera type.
 */
export interface Scene3d extends Scene {
  view: View;
}

/**
 * Rect area and title for a facet.
 */
export interface FacetRect {
  datum: any;
  lines: StyledLine[];
}

/**
 * Data structure containing all that is necessary to present a chart.
 */
export interface Stage {
  backgroundColor?: Color;
  cubeData?: Cube[];
  pathData?: Path[];
  symbolData?: SymbolMark[];
  polygonData?: Polygon[];
  legend?: Legend;
  axes?: {
    x?: Axis[];
    y?: Axis[];
    z?: Axis[];
  };
  textData?: VegaTextLayerDatum[];
  view?: View;
  gridLines?: StyledLine[];
  facets?: FacetRect[];
}

export interface Legend {
  title?: string;
  rows: {[index: number]: LegendRow};
}

export interface LegendRow {
  label?: string;
  value?: string;
  symbol?: LegendRowSymbol;
}

export interface LegendRowSymbol {
  bounds: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  fill: string;
  shape: string;
}

/**
 * Function that can be called prior to presenting the stage.
 */
export interface PreStage {
  (stage: Stage, deckProps: Partial<DeckProps<import('@deck.gl/core').OrbitView[]>>): void;
}

/**
 * Lengths of time for a transition animation.
 */
export interface TransitionDurations {
  color?: number;
  position?: number;
  size?: number;
  view?: number;
}

/**
 * Configuration options to be used by the Presenter.
 */
export interface PresenterConfig {
  transitionDurations?: TransitionDurations;
  preStage?: PreStage;
  getCharacterSet?: (stage: Stage) => string[];
  redraw?: () => void;
  onCubeHover?: (e: Event, cube: Cube) => void;
  onCubeClick?: (e: Event, cube: Cube) => void;
  onLayerClick?: DeckProps<import('@deck.gl/core').OrbitView[]>['onClick'];
  onLegendClick?: (e: Event, legend: Legend, clickedIndex: number) => void;
  onPresent?: () => void;
  shouldViewstateTransition?: () => boolean;
  preLayer?: (stage: Stage) => void;
  onTextClick?: (e: Event, t: VegaTextLayerDatum) => void;
  onTextHover?: (e: Event, t: VegaTextLayerDatum) => boolean;
  getTextColor?: (o: VegaTextLayerDatum) => Color;
  getTextHighlightColor?: (o: VegaTextLayerDatum) => Color;
  getTextHighlightAlphaCutoff?: () => number;
  onSceneRectAssignCubeOrdinal?: (d: object, item?: object) => number | undefined;
  onTargetViewState?: (
    height: number,
    width: number
  ) => {height: number; width: number; newViewStateTarget?: boolean};
  preserveDrawingBuffer?: boolean;
  zAxisZindex?: number;
}

export interface PresenterStyle {
  cssPrefix?: string;
  defaultCubeColor?: Color;
  highlightColor?: Color;
  //    lightSettings?: { [view in View]: LightSettings };
  fontFamily?: string;
}

/**
 * Options to pass to Presenter.queueAnimation()
 */
export interface QueuedAnimationOptions {
  /**
   * Debug label to observe which animation is waiting.
   */
  waitingLabel?: string;

  /**
   * Debug label to observe which handler is invoked.
   */
  handlerLabel?: string;

  /**
   * Function to invoke if animation was interrupted when another animation is queued.
   */
  animationCanceled?: () => void;
}
