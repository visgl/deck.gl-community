import type {PickingInfo, Viewport} from '@deck.gl/core';

/** Stable widget id used to keep the shared context menu in the full-canvas container. */
export const DECK_TRACE_GRAPH_CONTEXT_MENU_WIDGET_ID = 'tracevis-context-menu';

/** Minimap viewport geometry needed to resolve an empty context-menu gesture. */
export type DeckTraceGraphOverviewContextViewport = Pick<
  Viewport,
  'id' | 'x' | 'y' | 'width' | 'height' | 'unproject'
>;

/** Absolute overview range used to clamp a context-menu time selection. */
export type DeckTraceGraphOverviewContextRange = {
  /** Inclusive absolute start timestamp in milliseconds. */
  readonly startTimeMs?: number;
  /** Inclusive absolute end timestamp in milliseconds. */
  readonly endTimeMs?: number;
};

/**
 * Resolves the minimap viewport for a context-menu pointer, including empty picks.
 */
export function resolveDeckTraceGraphOverviewContextViewport(params: {
  /** Deck picking payload captured for the context-menu gesture. */
  readonly pickInfo: Pick<PickingInfo, 'viewport' | 'x' | 'y'>;
  /** Live minimap viewport used when an empty deck.gl pick omits its viewport. */
  readonly minimapViewport?: DeckTraceGraphOverviewContextViewport;
}): DeckTraceGraphOverviewContextViewport | null {
  if (params.pickInfo.viewport?.id === 'minimap') {
    return params.pickInfo.viewport;
  }
  if (
    params.minimapViewport?.id !== 'minimap' ||
    !isPointerWithinViewport(params.pickInfo, params.minimapViewport)
  ) {
    return null;
  }
  return params.minimapViewport;
}

/**
 * Resolves an absolute time from a minimap context-menu pointer location.
 */
export function resolveDeckTraceGraphOverviewContextTimeMs(params: {
  /** Deck picking payload captured for the context-menu gesture. */
  readonly pickInfo: Pick<PickingInfo, 'coordinate' | 'viewport' | 'x' | 'y'>;
  /** Live minimap viewport used when an empty deck.gl pick omits its viewport. */
  readonly minimapViewport?: DeckTraceGraphOverviewContextViewport;
  /** Absolute timestamp represented by world-space x=0. */
  readonly originTimeMs: number;
  /** Full absolute overview range used to enable and clamp the action. */
  readonly overviewTimeRange?: DeckTraceGraphOverviewContextRange;
}): number | null {
  const minimapViewport = resolveDeckTraceGraphOverviewContextViewport({
    pickInfo: params.pickInfo,
    minimapViewport: params.minimapViewport
  });
  if (!minimapViewport) {
    return null;
  }
  const startTimeMs = params.overviewTimeRange?.startTimeMs;
  const endTimeMs = params.overviewTimeRange?.endTimeMs;
  if (
    !Number.isFinite(startTimeMs) ||
    !Number.isFinite(endTimeMs) ||
    !Number.isFinite(params.originTimeMs)
  ) {
    return null;
  }

  const pointerCoordinate =
    Number.isFinite(params.pickInfo.x) && Number.isFinite(params.pickInfo.y)
      ? minimapViewport.unproject([params.pickInfo.x, params.pickInfo.y])
      : null;
  const worldX = pointerCoordinate?.[0] ?? params.pickInfo.coordinate?.[0];
  if (!Number.isFinite(worldX)) {
    return null;
  }

  const minimumTimeMs = Math.min(startTimeMs as number, endTimeMs as number);
  const maximumTimeMs = Math.max(startTimeMs as number, endTimeMs as number);
  return Math.min(Math.max(params.originTimeMs + (worldX as number), minimumTimeMs), maximumTimeMs);
}

/**
 * Returns whether a pointer is inside the supplied viewport's canvas rectangle.
 */
function isPointerWithinViewport(
  pickInfo: Pick<PickingInfo, 'x' | 'y'>,
  viewport: DeckTraceGraphOverviewContextViewport
): boolean {
  return (
    Number.isFinite(pickInfo.x) &&
    Number.isFinite(pickInfo.y) &&
    pickInfo.x >= viewport.x &&
    pickInfo.x <= viewport.x + viewport.width &&
    pickInfo.y >= viewport.y &&
    pickInfo.y <= viewport.y + viewport.height
  );
}
