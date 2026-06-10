import {CompositeLayer} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';
import {TimeDeltaLayer} from '@deck.gl-community/infovis-layers';

import type {CompositeLayerProps, Layer, LayerProps} from '@deck.gl/core';
import type {TimeDeltaLayerProps} from '@deck.gl-community/infovis-layers';
import type {TimeMeasureSelectionState} from '@deck.gl-community/widgets';

type LineDatum = {sourcePosition: [number, number]; targetPosition: [number, number]};

export type TimeMeasureLayerProps = LayerProps & CompositeLayerProps & _TimeMeasureLayerProps;
export type _TimeMeasureLayerProps = Pick<TimeDeltaLayerProps, 'fontFamily' | 'fontSize'> & {
  layerIdPrefix?: string;
  timeMeasureRange: {startTimeMs: number; endTimeMs: number} | null;
  selectionState?: Pick<TimeMeasureSelectionState, 'phase' | 'cursorTimeMs' | 'draftStartTimeMs'>;
  yMin?: number;
  yMax?: number;
};

export class TimeMeasureLayer extends CompositeLayer<TimeMeasureLayerProps> {
  static layerName = 'TimeMeasureLayer';

  renderLayers(): Layer | Layer[] | null {
    const {
      yMin = 0,
      yMax = 100,
      timeMeasureRange,
      selectionState,
      fontFamily,
      fontSize
    } = this.props;

    const {phase, cursorTimeMs, draftStartTimeMs} = selectionState ?? {
      phase: undefined,
      cursorTimeMs: null,
      draftStartTimeMs: null
    };

    const previewStartVisible = phase === 'selecting-start' && cursorTimeMs !== null;
    const previewStartData: LineDatum[] = previewStartVisible
      ? [{sourcePosition: [cursorTimeMs, yMin], targetPosition: [cursorTimeMs, yMax]}]
      : [];

    const previewStartFixedVisible = phase === 'selecting-end' && draftStartTimeMs !== null;
    const previewStartFixedData: LineDatum[] = previewStartFixedVisible
      ? [{sourcePosition: [draftStartTimeMs, yMin], targetPosition: [draftStartTimeMs, yMax]}]
      : [];

    const previewEndVisible = phase === 'selecting-end' && cursorTimeMs !== null;
    const previewEndData: LineDatum[] = previewEndVisible
      ? [{sourcePosition: [cursorTimeMs, yMin], targetPosition: [cursorTimeMs, yMax]}]
      : [];

    const draftRange =
      phase === 'selecting-end' && draftStartTimeMs !== null && cursorTimeMs !== null
        ? {
            startTimeMs: Math.min(draftStartTimeMs, cursorTimeMs),
            endTimeMs: Math.max(draftStartTimeMs, cursorTimeMs)
          }
        : null;
    const activeRange = timeMeasureRange ?? draftRange;

    return [
      new LineLayer<LineDatum>(
        this.getSubLayerProps({
          id: 'time-measure-preview-start',
          visible: previewStartVisible
        }),
        {
          data: previewStartData,
          getSourcePosition: d => d.sourcePosition,
          getTargetPosition: d => d.targetPosition,
          getColor: [236, 179, 101, 255],
          getWidth: 4,
          widthUnits: 'pixels'
        }
      ),
      new LineLayer<LineDatum>(
        this.getSubLayerProps({
          id: 'time-measure-preview-start-fixed',
          visible: previewStartFixedVisible
        }),
        {
          data: previewStartFixedData,
          getSourcePosition: d => d.sourcePosition,
          getTargetPosition: d => d.targetPosition,
          getColor: [59, 130, 246, 255],
          getWidth: 4,
          widthUnits: 'pixels'
        }
      ),
      new LineLayer<LineDatum>(
        this.getSubLayerProps({
          id: 'time-measure-preview-end',
          visible: previewEndVisible
        }),
        {
          data: previewEndData,
          getSourcePosition: d => d.sourcePosition,
          getTargetPosition: d => d.targetPosition,
          getColor: [236, 179, 101, 255],
          getWidth: 4,
          widthUnits: 'pixels'
        }
      ),
      new TimeDeltaLayer(
        this.getSubLayerProps({
          id: 'time-delta-header',
          visible: Boolean(activeRange) && activeRange!.endTimeMs !== activeRange!.startTimeMs
        }),
        {
          header: true,
          startTimeMs: activeRange?.startTimeMs ?? 0,
          endTimeMs: activeRange?.endTimeMs ?? 0,
          yMin,
          yMax,
          fontFamily,
          fontSize
        }
      ),
      new TimeDeltaLayer(
        this.getSubLayerProps({
          id: 'time-delta',
          visible:
            Boolean(timeMeasureRange) &&
            timeMeasureRange!.endTimeMs !== timeMeasureRange!.startTimeMs
        }),
        {
          header: false,
          startTimeMs: timeMeasureRange?.startTimeMs ?? 0,
          endTimeMs: timeMeasureRange?.endTimeMs ?? 0,
          yMin,
          yMax,
          fontFamily,
          fontSize
        }
      )
    ];
  }
}
