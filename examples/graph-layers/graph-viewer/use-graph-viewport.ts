// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useCallback, useEffect, useRef, useState} from 'react';

import type {GraphEngine, GraphLayout, GraphLayoutEventDetail} from '@deck.gl-community/graph-layers';
import type {Bounds2D} from '@math.gl/types';

type UseGraphViewportOptions = {
  minZoom: number;
  maxZoom: number;
  viewportPadding: number;
  boundsPaddingRatio: number;
  initialViewState: {
    target: [number, number];
    zoom: number;
  };
};

const EPSILON = 1e-6;

type LayoutEventSource = GraphEngine | GraphLayout | null;

function getEventSourceBounds(source: LayoutEventSource): Bounds2D | null {
  if (!source) {
    return null;
  }

  if ('getLayoutBounds' in source && typeof source.getLayoutBounds === 'function') {
    return source.getLayoutBounds();
  }

  if ('getBounds' in source && typeof source.getBounds === 'function') {
    return source.getBounds();
  }

  return null;
}

export function useGraphViewport(
  eventSource: LayoutEventSource,
  {minZoom, maxZoom, viewportPadding, boundsPaddingRatio, initialViewState}: UseGraphViewportOptions
) {
  const [viewState, setViewState] = useState(() => ({
    ...initialViewState
  }));
  const latestBoundsRef = useRef<Bounds2D | null>(null);

  const fitBounds = useCallback(
    (incomingBounds?: Bounds2D | null) => {
      if (!eventSource) {
        return;
      }

      const bounds = incomingBounds ?? getEventSourceBounds(eventSource);
      if (!bounds) {
        return;
      }

      const [[minX, minY], [maxX, maxY]] = bounds;
      if (
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return;
      }

      latestBoundsRef.current = [
        [minX, minY],
        [maxX, maxY]
      ];

      setViewState((prev) => {
        const {width, height} = prev as any;
        if (!width || !height) {
          return prev;
        }

        const target: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
        const spanX = Math.max(maxX - minX, EPSILON);
        const spanY = Math.max(maxY - minY, EPSILON);
        const paddingRatio = Math.max(boundsPaddingRatio, 0);
        const paddedSpanX = spanX * (1 + paddingRatio);
        const paddedSpanY = spanY * (1 + paddingRatio);
        const innerWidth = Math.max(1, width - viewportPadding * 2);
        const innerHeight = Math.max(1, height - viewportPadding * 2);
        const scale = Math.min(innerWidth / paddedSpanX, innerHeight / paddedSpanY);
        const zoom = Math.min(Math.max(minZoom, Math.log2(Math.max(scale, EPSILON))), maxZoom);

        if (!Number.isFinite(zoom)) {
          return prev;
        }

        const prevTarget = (prev as any).target as [number, number] | undefined;
        const targetUnchanged =
          Array.isArray(prevTarget) &&
          Math.abs(prevTarget[0] - target[0]) < EPSILON &&
          Math.abs(prevTarget[1] - target[1]) < EPSILON;
        const zoomUnchanged = prev.zoom !== undefined && Math.abs(prev.zoom - zoom) < EPSILON;

        if (targetUnchanged && zoomUnchanged) {
          return prev;
        }

        return {
          ...prev,
          target,
          zoom
        };
      });
    },
    [eventSource, boundsPaddingRatio, viewportPadding, minZoom, maxZoom]
  );

  useEffect(() => {
    latestBoundsRef.current = null;
  }, [eventSource]);

  const handleLayoutEvent = useCallback(
    (detail?: GraphLayoutEventDetail) => {
      fitBounds(detail?.bounds ?? null);
    },
    [fitBounds]
  );

  useEffect(() => {
    if (!eventSource || 'getLayoutBounds' in (eventSource as GraphEngine)) {
      return () => undefined;
    }

    const layout = eventSource as GraphLayout;
    const previous = layout.getProps();

    layout.setProps({
      onLayoutStart: (detail) => {
        handleLayoutEvent(detail);
        previous.onLayoutStart?.(detail);
      },
      onLayoutChange: (detail) => {
        handleLayoutEvent(detail);
        previous.onLayoutChange?.(detail);
      },
      onLayoutDone: (detail) => {
        handleLayoutEvent(detail);
        previous.onLayoutDone?.(detail);
      }
    });

    return () => {
      layout.setProps({
        onLayoutStart: previous.onLayoutStart,
        onLayoutChange: previous.onLayoutChange,
        onLayoutDone: previous.onLayoutDone,
        onLayoutError: previous.onLayoutError
      });
    };
  }, [eventSource, handleLayoutEvent]);

  const {width, height} = viewState as any;

  useEffect(() => {
    if (!eventSource || !width || !height) {
      return;
    }

    const bounds = latestBoundsRef.current ?? getEventSourceBounds(eventSource);
    if (bounds) {
      fitBounds(bounds);
    }
  }, [eventSource, fitBounds, width, height]);

  const onResize = useCallback(({width, height}: {width: number; height: number}) => {
    setViewState((prev) => ({
      ...prev,
      width,
      height
    }));
  }, []);

  const onViewStateChange = useCallback(({viewState: nextViewState}: {viewState: any}) => {
    setViewState((prev) => ({
      ...nextViewState,
      width: (prev as any)?.width,
      height: (prev as any)?.height
    }));
  }, []);

  const layoutCallbacks = {
    onLayoutStart: handleLayoutEvent,
    onLayoutChange: handleLayoutEvent,
    onLayoutDone: handleLayoutEvent
  } as const;

  return {
    viewState,
    onResize,
    onViewStateChange,
    fitBounds,
    layoutCallbacks
  };
}
