// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useMemo} from 'react';

import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {PolygonLayer, ScatterplotLayer} from '@deck.gl/layers';

import type {GraphEngine, Node} from '@deck.gl-community/graph-layers';

type GraphViewState = {
  target?: [number, number] | [number, number, number];
  zoom?: number;
  width?: number;
  height?: number;
};

type MiniMapPoint = {
  node: Node;
  position: [number, number];
  isChainRepresentative: boolean;
  isCollapsedChain: boolean;
};

type MiniMapProps = {
  engine: GraphEngine | null;
  revision: number;
  mainViewState: GraphViewState;
  width: number;
  height: number;
  onRecenter: (target: [number, number]) => void;
};

const DEFAULT_VIEW_STATE = {
  target: [0, 0, 0] as [number, number, number],
  zoom: 0,
  width: 1,
  height: 1
};

const COLOR_DEFAULT = [148, 163, 184, 180];
const COLOR_COLLAPSED = [248, 113, 113, 255];
const COLOR_EXPANDED_CHAIN = [251, 191, 36, 230];
const COLOR_SELECTED = [37, 99, 235, 255];
const COLOR_HOVERED = [16, 185, 129, 255];
const COLOR_DRAGGING = [59, 130, 246, 255];
const COLOR_DEFAULT_OUTLINE = [71, 85, 105, 200];
const COLOR_COLLAPSED_OUTLINE = [220, 38, 38, 255];
const COLOR_EXPANDED_CHAIN_OUTLINE = [217, 119, 6, 255];

const VIEWPORT_FILL_COLOR = [59, 130, 246, 45];
const VIEWPORT_STROKE_COLOR = [59, 130, 246, 180];

const MINI_MAP_VIEW_ID = 'graph-mini-map-view';

export function MiniMap({engine, revision, mainViewState, width, height, onRecenter}: MiniMapProps) {
  const data = useMemo<MiniMapPoint[]>(() => {
    if (!engine) {
      return [];
    }

    const nodes = engine.getNodes();
    return nodes
      .map((node) => {
        const position = engine.getNodePosition(node);
        if (!position) {
          return null;
        }
        const chainId = node.getPropertyValue('collapsedChainId');
        const collapsedNodeIds = node.getPropertyValue('collapsedNodeIds');
        const representativeId = node.getPropertyValue('collapsedChainRepresentativeId');
        const isCollapsedChain = Boolean(node.getPropertyValue('isCollapsedChain'));
        const isChainRepresentative =
          chainId !== null &&
          chainId !== undefined &&
          Array.isArray(collapsedNodeIds) &&
          collapsedNodeIds.length > 1 &&
          representativeId === node.getId();

        return {
          node,
          position: position as [number, number],
          isChainRepresentative,
          isCollapsedChain
        };
      })
      .filter(Boolean) as MiniMapPoint[];
  }, [engine, revision]);

  const bounds = useMemo(() => {
    if (!data.length) {
      return null;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const point of data) {
      const [x, y] = point.position;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return null;
    }

    return {minX, minY, maxX, maxY};
  }, [data]);

  const miniMapViewState = useMemo(() => {
    if (!bounds) {
      return {...DEFAULT_VIEW_STATE, width, height};
    }

    const padding = 24;
    const effectiveWidth = Math.max(width - padding, 1);
    const effectiveHeight = Math.max(height - padding, 1);

    const spanX = Math.max(bounds.maxX - bounds.minX, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1);

    const scaleX = effectiveWidth / spanX;
    const scaleY = effectiveHeight / spanY;
    const scale = Math.max(Math.min(scaleX, scaleY), 1e-3);
    const zoom = Math.log(scale);

    return {
      target: [
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        0
      ] as [number, number, number],
      zoom,
      width,
      height
    };
  }, [bounds, width, height]);

  const viewportPolygon = useMemo(() => {
    const zoom = mainViewState.zoom;
    const viewWidth = mainViewState.width;
    const viewHeight = mainViewState.height;

    if (
      !Number.isFinite(zoom) ||
      !Number.isFinite(viewWidth) ||
      !Number.isFinite(viewHeight) ||
      viewWidth === undefined ||
      viewHeight === undefined
    ) {
      return null;
    }

    const scale = Math.exp(zoom as number);
    if (!Number.isFinite(scale) || scale <= 0) {
      return null;
    }

    const target = Array.isArray(mainViewState.target) ? mainViewState.target : [0, 0, 0];
    const targetX = target[0] ?? 0;
    const targetY = target[1] ?? 0;

    const halfWidth = (viewWidth as number) / (2 * scale);
    const halfHeight = (viewHeight as number) / (2 * scale);

    return [
      [targetX - halfWidth, targetY - halfHeight],
      [targetX + halfWidth, targetY - halfHeight],
      [targetX + halfWidth, targetY + halfHeight],
      [targetX - halfWidth, targetY + halfHeight]
    ];
  }, [mainViewState]);

  const scatterplotLayer = useMemo(() => {
    if (!data.length) {
      return null;
    }

    return new ScatterplotLayer<MiniMapPoint>({
      id: 'mini-map-nodes',
      data,
      pickable: false,
      radiusUnits: 'pixels',
      stroked: true,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1,
      parameters: {depthTest: false},
      getPosition: (d) => d.position,
      getRadius: (d) => {
        const base = d.isChainRepresentative ? 7 : 5;
        const state = d.node.getState();
        if (state === 'selected') {
          return base + 4;
        }
        if (state === 'hover') {
          return base + 2;
        }
        if (state === 'dragging') {
          return base + 3;
        }
        return base;
      },
      getFillColor: (d) => {
        const state = d.node.getState();
        if (state === 'selected') {
          return COLOR_SELECTED;
        }
        if (state === 'hover') {
          return COLOR_HOVERED;
        }
        if (state === 'dragging') {
          return COLOR_DRAGGING;
        }
        if (d.isChainRepresentative) {
          return d.isCollapsedChain ? COLOR_COLLAPSED : COLOR_EXPANDED_CHAIN;
        }
        return COLOR_DEFAULT;
      },
      getLineColor: (d) => {
        const state = d.node.getState();
        if (state === 'selected') {
          return COLOR_SELECTED;
        }
        if (state === 'hover') {
          return COLOR_HOVERED;
        }
        if (state === 'dragging') {
          return COLOR_DRAGGING;
        }
        if (d.isChainRepresentative) {
          return d.isCollapsedChain ? COLOR_COLLAPSED_OUTLINE : COLOR_EXPANDED_CHAIN_OUTLINE;
        }
        return COLOR_DEFAULT_OUTLINE;
      },
      updateTriggers: {
        getRadius: revision,
        getFillColor: revision,
        getLineColor: revision
      }
    });
  }, [data, revision]);

  const viewBoundsLayer = useMemo(() => {
    if (!viewportPolygon) {
      return null;
    }

    return new PolygonLayer({
      id: 'mini-map-viewport',
      data: [{polygon: viewportPolygon}],
      getPolygon: (d) => d.polygon,
      stroked: true,
      filled: true,
      parameters: {depthTest: false},
      getFillColor: VIEWPORT_FILL_COLOR,
      getLineColor: VIEWPORT_STROKE_COLOR,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1.5
    });
  }, [viewportPolygon]);

  const handleClick = useCallback(
    (info: any) => {
      if (!onRecenter) {
        return;
      }
      const viewport = info?.viewport;
      let coordinate = info?.coordinate as [number, number] | undefined;
      if (!coordinate && viewport && typeof info?.x === 'number' && typeof info?.y === 'number') {
        coordinate = viewport.unproject([info.x, info.y]);
      }
      if (!coordinate) {
        return;
      }
      const [x, y] = coordinate;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      onRecenter([x, y]);
    },
    [onRecenter]
  );

  const layers = useMemo(() => {
    const result = [] as any[];
    if (scatterplotLayer) {
      result.push(scatterplotLayer);
    }
    if (viewBoundsLayer) {
      result.push(viewBoundsLayer);
    }
    return result;
  }, [scatterplotLayer, viewBoundsLayer]);

  return (
    <DeckGL
      style={{width: '100%', height: '100%'}}
      controller={false}
      views={[new OrthographicView({id: MINI_MAP_VIEW_ID, controller: false})]}
      viewState={{...miniMapViewState, id: MINI_MAP_VIEW_ID}}
      layers={layers}
      getCursor={() => 'pointer'}
      onClick={handleClick}
    />
  );
}
