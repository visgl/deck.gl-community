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

export class GridLayer<DatumT extends GridLineDatum = GridLineDatum> extends CompositeLayer<
  GridLayerProps<DatumT>
> {
  static override layerName = 'GridLayer';

  static override defaultProps: Required<
    Pick<
      GridLayerProps<GridLineDatum>,
      | 'direction'
      | 'width'
      | 'color'
      | 'xMin'
      | 'xMax'
      | 'yMin'
      | 'yMax'
      | 'showLabels'
      | 'labelOffset'
    >
  > = {
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
    const {changeFlags} = params;
    return Boolean(
      changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.viewportChanged
    );
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

    const bounds = this._resolveViewportBounds({xMin, xMax, yMin, yMax});
    const lines = this._createLineSegments(data, direction, bounds);

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

    const textData = this._createLabelData(lines, direction, bounds, getLabel);

    if (!textData.length) {
      return [lineLayer];
    }

    const textLayer = new TextLayer({
      id: `${this.props.id}-labels`,
      data: textData,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getColor: getColor ? (d) => getColor(d.datum) ?? color : () => color,
      getSize: 12,
      sizeUnits: 'pixels',
      getPixelOffset: labelOffset,
      getTextAnchor: () => 'start',
      getAlignmentBaseline: () => 'center',
      background: true,
      backgroundPadding: [4, 2],
      backgroundColor: [255, 255, 255, 200],
      parameters: {
        depthTest: false
      }
    });

    return [lineLayer, textLayer];
  }

  private _resolveViewportBounds(bounds: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  }): {minX: number; maxX: number; minY: number; maxY: number} {
    const viewportBounds = this.context?.viewport?.getBounds?.();
    if (!Array.isArray(viewportBounds) || viewportBounds.length !== 4) {
      return {minX: bounds.xMin, maxX: bounds.xMax, minY: bounds.yMin, maxY: bounds.yMax};
    }

    const [bxMin, byMin, bxMax, byMax] = viewportBounds;
    const minX =
      Number.isFinite(bxMin) && Number.isFinite(bxMax) ? Math.min(bounds.xMin, bxMin) : bounds.xMin;
    const maxX =
      Number.isFinite(bxMin) && Number.isFinite(bxMax) ? Math.max(bounds.xMax, bxMax) : bounds.xMax;
    const minY =
      Number.isFinite(byMin) && Number.isFinite(byMax) ? Math.min(bounds.yMin, byMin) : bounds.yMin;
    const maxY =
      Number.isFinite(byMin) && Number.isFinite(byMax) ? Math.max(bounds.yMax, byMax) : bounds.yMax;

    return {minX, maxX, minY, maxY};
  }

  private _createLineSegments(
    data: readonly DatumT[],
    direction: 'horizontal' | 'vertical',
    bounds: {minX: number; maxX: number; minY: number; maxY: number}
  ): Array<{
    sourcePosition: [number, number];
    targetPosition: [number, number];
    datum: DatumT;
  }> {
    const segments: Array<{
      sourcePosition: [number, number];
      targetPosition: [number, number];
      datum: DatumT;
    }> = [];

    const isHorizontal = direction === 'horizontal';
    for (const datum of data) {
      const position = isHorizontal ? datum.yPosition : datum.xPosition;
      if (typeof position === 'number' && Number.isFinite(position)) {
        if (isHorizontal) {
          segments.push({
            sourcePosition: [bounds.minX, position],
            targetPosition: [bounds.maxX, position],
            datum
          });
        } else {
          segments.push({
            sourcePosition: [position, bounds.minY],
            targetPosition: [position, bounds.maxY],
            datum
          });
        }
      }
    }

    return segments;
  }

  private _createLabelData(
    lines: Array<{
      sourcePosition: [number, number];
      targetPosition: [number, number];
      datum: DatumT;
    }>,
    direction: 'horizontal' | 'vertical',
    bounds: {minX: number; maxX: number; minY: number; maxY: number},
    getLabel?: (datum: DatumT) => string | number | null | undefined
  ): Array<{position: [number, number]; text: string; datum: DatumT}> {
    const labels: Array<{position: [number, number]; text: string; datum: DatumT}> = [];
    const isHorizontal = direction === 'horizontal';

    for (const {datum, sourcePosition} of lines) {
      const rawLabel = getLabel ? getLabel(datum) : (datum.label ?? null);
      if (rawLabel !== null && rawLabel !== undefined && rawLabel !== '') {
        const [sx, sy] = sourcePosition;
        const position: [number, number] = isHorizontal ? [bounds.minX, sy] : [sx, bounds.minY];
        labels.push({position, text: String(rawLabel), datum});
      }
    }

    return labels;
  }
}
