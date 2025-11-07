// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type UpdateParameters} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';

export type GridLineDatum = {
  /** Optional label associated with the grid line. */
  label?: string | number;
  /** Horizontal grid lines use the yPosition value. */
  yPosition?: number | null;
  /** Vertical grid lines use the xPosition value. */
  xPosition?: number | null;
};

export type GridLayerProps<DatumT extends GridLineDatum = GridLineDatum> = CompositeLayerProps & {
  /** Collection of grid line definitions. */
  data: readonly DatumT[];
  /** Direction in which to draw grid lines. */
  direction?: 'horizontal' | 'vertical';
  /** Minimum X coordinate for grid lines. */
  xMin?: number;
  /** Maximum X coordinate for grid lines. */
  xMax?: number;
  /** Minimum Y coordinate for grid lines. */
  yMin?: number;
  /** Maximum Y coordinate for grid lines. */
  yMax?: number;
  /** Width of the grid lines in screen pixels. */
  width?: number;
  /** RGBA color for grid lines. */
  color?: [number, number, number, number];
  /** Optional accessor for line labels. */
  getLabel?: (d: DatumT) => string | number | null | undefined;
  /** Optional accessor for per-datum colors. */
  getColor?: (d: DatumT) => [number, number, number, number] | null | undefined;
  /** Optional accessor for per-datum widths. */
  getWidth?: (d: DatumT) => number | null | undefined;
  /** Whether to render labels alongside the grid lines. */
  showLabels?: boolean;
  /** Pixel offset applied to rendered labels. */
  labelOffset?: [number, number];
};

const DEFAULT_COLOR: [number, number, number, number] = [200, 200, 200, 255];
const DEFAULT_WIDTH = 1;
const DEFAULT_OFFSET: [number, number] = [8, 0];
const DEFAULT_MIN = -1e6;
const DEFAULT_MAX = 1e6;

export class GridLayer<DatumT extends GridLineDatum = GridLineDatum> extends CompositeLayer<GridLayerProps<DatumT>> {
  static override layerName = 'GridLayer';

  static override defaultProps: Required<Pick<GridLayerProps<GridLineDatum>, 'direction' | 'width' | 'color' | 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'showLabels' | 'labelOffset'>> = {
    direction: 'horizontal',
    width: DEFAULT_WIDTH,
    color: DEFAULT_COLOR,
    xMin: DEFAULT_MIN,
    xMax: DEFAULT_MAX,
    yMin: DEFAULT_MIN,
    yMax: DEFAULT_MAX,
    showLabels: true,
    labelOffset: DEFAULT_OFFSET
  } as const;

  override shouldUpdateState(params: UpdateParameters<this>): boolean {
    return params.changeFlags.dataChanged || params.changeFlags.propsChanged || params.changeFlags.viewportChanged;
  }

  override renderLayers() {
    const {
      data,
      direction = 'horizontal',
      xMin = DEFAULT_MIN,
      xMax = DEFAULT_MAX,
      yMin = DEFAULT_MIN,
      yMax = DEFAULT_MAX,
      color = DEFAULT_COLOR,
      width = DEFAULT_WIDTH,
      getLabel,
      getColor,
      getWidth,
      showLabels = true,
      labelOffset = DEFAULT_OFFSET
    } = this.props;

    const viewport = this.context?.viewport;
    const bounds = viewport?.getBounds?.();

    let [minX, minY, maxX, maxY] = [xMin, yMin, xMax, yMax];
    if (Array.isArray(bounds) && bounds.length === 4) {
      const [bxMin, byMin, bxMax, byMax] = bounds;
      if (Number.isFinite(bxMin) && Number.isFinite(bxMax)) {
        minX = Math.min(minX, bxMin);
        maxX = Math.max(maxX, bxMax);
      }
      if (Number.isFinite(byMin) && Number.isFinite(byMax)) {
        minY = Math.min(minY, byMin);
        maxY = Math.max(maxY, byMax);
      }
    }

    const isHorizontal = direction === 'horizontal';

    const lines = data
      .map((datum) => {
        const position = isHorizontal ? datum.yPosition : datum.xPosition;
        if (!Number.isFinite(position as number)) {
          return null;
        }
        if (isHorizontal) {
          return {
            sourcePosition: [minX, position as number],
            targetPosition: [maxX, position as number],
            datum
          };
        }
        return {
          sourcePosition: [position as number, minY],
          targetPosition: [position as number, maxY],
          datum
        };
      })
      .filter(Boolean) as Array<{
        sourcePosition: [number, number];
        targetPosition: [number, number];
        datum: DatumT;
      }>;

    if (!lines.length) {
      return [];
    }

    const lineLayer = new LineLayer({
      id: `${this.props.id}-lines`,
      data: lines,
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getColor: getColor ? (d) => getColor(d.datum) ?? color : () => color,
      getWidth: getWidth ? (d) => getWidth(d.datum) ?? width : () => width,
      widthUnits: 'pixels',
      parameters: {
        depthTest: false
      }
    });

    if (!showLabels) {
      return [lineLayer];
    }

    const textData = lines
      .map(({datum, sourcePosition, targetPosition}) => {
        const label = getLabel ? getLabel(datum) : datum.label ?? null;
        if (label === null || label === undefined || label === '') {
          return null;
        }
        const [sx, sy] = sourcePosition;
        const [tx, ty] = targetPosition;
        const position: [number, number] = isHorizontal ? [tx, ty] : [sx, sy];
        return {
          position,
          text: String(label)
        };
      })
      .filter(Boolean) as Array<{position: [number, number]; text: string}>;

    if (!textData.length) {
      return [lineLayer];
    }

    const textLayer = new TextLayer({
      id: `${this.props.id}-labels`,
      data: textData,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getColor: color,
      getSize: 12,
      sizeUnits: 'pixels',
      getPixelOffset: labelOffset,
      background: true,
      backgroundPadding: [4, 2],
      backgroundColor: [255, 255, 255, 200],
      parameters: {
        depthTest: false
      }
    });

    return [lineLayer, textLayer];
  }
}
