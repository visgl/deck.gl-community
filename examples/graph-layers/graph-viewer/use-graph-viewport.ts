// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useCallback, useEffect, useRef, useState} from 'react';

import type {GraphEngine, GraphLayoutEventDetail} from '@deck.gl-community/graph-layers';
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

export function useGraphViewport(
  engine: GraphEngine | null,
  {minZoom, maxZoom, viewportPadding, boundsPaddingRatio, initialViewState}: UseGraphViewportOptions
) {
  const [viewState, setViewState] = useState(() => ({
    ...initialViewState
  }));
  const latestBoundsRef = useRef<Bounds2D | null>(null);

  const fitBounds = useCallback(
    (incomingBounds?: Bounds2D | null) => {
      if (!engine) {
        return;
      }

      const bounds = incomingBounds ?? engine.getLayoutBounds();
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
    [engine, boundsPaddingRatio, viewportPadding, minZoom, maxZoom]
  );

  useEffect(() => {
    latestBoundsRef.current = null;
  }, [engine]);

  useEffect(() => {
    if (!engine) {
      return () => undefined;
    }

    const handleLayoutEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as GraphLayoutEventDetail) : undefined;
      fitBounds(detail?.bounds ?? null);
    };

    engine.addEventListener('onLayoutStart', handleLayoutEvent);
    engine.addEventListener('onLayoutChange', handleLayoutEvent);
    engine.addEventListener('onLayoutDone', handleLayoutEvent);

    return () => {
      engine.removeEventListener('onLayoutStart', handleLayoutEvent);
      engine.removeEventListener('onLayoutChange', handleLayoutEvent);
      engine.removeEventListener('onLayoutDone', handleLayoutEvent);
    };
  }, [engine, fitBounds]);

  const {width, height} = viewState as any;

  useEffect(() => {
    if (!engine || !width || !height) {
      return;
    }

    const bounds = latestBoundsRef.current ?? engine.getLayoutBounds();
    if (bounds) {
      fitBounds(bounds);
    }
  }, [engine, fitBounds, width, height]);

  // eslint-disable-next-line @typescript-eslint/no-shadow
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

  return {
    viewState,
    onResize,
    onViewStateChange
  };
}
