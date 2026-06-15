import {useCallback, useEffect, useMemo, useState} from 'react';

import {commandManager} from '@deck.gl-community/panels';
import {TimeMeasureWidget} from '@deck.gl-community/widgets';
import {buildDeckLayersForTimeMeasure} from '../../../../layers/layers/deck-layers';

import type {TimeMeasureRange, TimeMeasureSelectionState} from '@deck.gl-community/widgets';
import type {WidgetPlacement} from '@deck.gl/core';

/** Creates the Tracevis time-measure widget, overlay layers, and active interaction mode state. */
export function useTimeMeasure(
  minTimeMs: number,
  onTimeRangeSelectionChange: (
    timeRange: {
      startTimeMs: number;
      endTimeMs: number;
    } | null
  ) => void,
  placement?: WidgetPlacement,
  fontFamily?: string,
  enabled = true
) {
  const [timeMeasureSelection, setTimeMeasureSelection] = useState<TimeMeasureSelectionState>(
    () => ({phase: 'idle', cursorTimeMs: null, draftStartTimeMs: null, range: null})
  );
  const timeMeasureRange = timeMeasureSelection.range;
  const [interactionMode, setInteractionMode] = useState<null | 'measure-time'>(null);

  const handleTimeMeasureSelectionChange = useCallback((selection: TimeMeasureSelectionState) => {
    setTimeMeasureSelection(selection);
  }, []);

  const handleTimeMeasureRangeChange = useCallback(
    (range: TimeMeasureRange | null) => {
      setTimeMeasureSelection(previous => ({
        ...previous,
        range,
        phase: range ? 'selected' : previous.phase
      }));
      const adjustedTimeRange = range
        ? {startTimeMs: range.startTimeMs + minTimeMs, endTimeMs: range.endTimeMs + minTimeMs}
        : null;
      onTimeRangeSelectionChange(adjustedTimeRange);
    },
    [minTimeMs, onTimeRangeSelectionChange]
  );

  useEffect(() => {
    handleTimeMeasureRangeChange(null);
  }, [handleTimeMeasureRangeChange]);

  useEffect(() => {
    if (enabled) {
      return;
    }
    setInteractionMode(null);
    handleTimeMeasureRangeChange(null);
  }, [enabled, handleTimeMeasureRangeChange]);

  const handleTimeMeasureActivate = useCallback(() => {
    setInteractionMode('measure-time');
  }, []);

  const handleTimeMeasureDeactivate = useCallback(() => {
    setInteractionMode(null);
  }, []);

  const timeMeasureWidget = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return new TimeMeasureWidget({
      viewId: null,
      eventViewId: ['main', 'header', 'legend'],
      projectionViewId: 'main',
      placement,
      onActivate: handleTimeMeasureActivate,
      onDeactivate: handleTimeMeasureDeactivate,
      onSelectionChange: handleTimeMeasureSelectionChange,
      onRangeChange: handleTimeMeasureRangeChange
    });
  }, [
    enabled,
    handleTimeMeasureActivate,
    handleTimeMeasureDeactivate,
    handleTimeMeasureRangeChange,
    handleTimeMeasureSelectionChange,
    placement
  ]);

  useEffect(() => {
    if (!timeMeasureWidget) {
      return;
    }
    return commandManager.registerCommand({
      id: timeMeasureWidget.commandId,
      label: 'Measure time',
      description: 'Toggles the trace time-measure interaction mode.',
      do: () => TimeMeasureWidget.performAction({widget: timeMeasureWidget})
    });
  }, [timeMeasureWidget]);

  const timeMeasureLayers = useMemo(() => {
    if (!enabled) {
      return [];
    }
    return buildDeckLayersForTimeMeasure({
      timeMeasureRange,
      timeMeasureSelection,
      fontFamily
    });
  }, [enabled, fontFamily, timeMeasureRange, timeMeasureSelection]);

  return {
    timeMeasureLayers,
    timeMeasureWidget,
    interactionMode
  };
}
