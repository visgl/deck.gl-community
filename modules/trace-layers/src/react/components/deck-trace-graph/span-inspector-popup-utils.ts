import {TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX} from './cards/trace-span-card/trace-span-card-types';

const SPAN_INSPECTOR_VIEWPORT_PADDING_PX = 12;
export const SPAN_INSPECTOR_DEFAULT_WIDTH_PX = 520;
export const SPAN_INSPECTOR_MIN_WIDTH_PX = 320;

/**
 * Resolve the largest tab-body height that still keeps the popup within the viewport.
 */
export function getSpanInspectorMaxTabBodyHeightPx(
  viewportHeightPx: number,
  container: HTMLDivElement | null,
  currentTabBodyHeightPx: number
): number {
  const containerRect = container?.getBoundingClientRect();
  const totalHeightPx = containerRect?.height ?? currentTabBodyHeightPx;
  const fixedHeightPx = Math.max(0, totalHeightPx - currentTabBodyHeightPx);
  const maxPopupHeightPx = Math.max(
    TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX + fixedHeightPx,
    (containerRect?.bottom ?? viewportHeightPx) - SPAN_INSPECTOR_VIEWPORT_PADDING_PX
  );
  return Math.max(TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX, maxPopupHeightPx - fixedHeightPx);
}

/**
 * Clamp a proposed tab-body height into the supported resize range.
 */
export function clampSpanInspectorTabBodyHeightPx(
  nextTabBodyHeightPx: number,
  minTabBodyHeightPx: number,
  maxTabBodyHeightPx: number
): number {
  return Math.min(maxTabBodyHeightPx, Math.max(minTabBodyHeightPx, nextTabBodyHeightPx));
}

/**
 * Resolve the largest popup width that still keeps the popup within the viewport.
 */
export function getSpanInspectorMaxWidthPx(
  viewportWidthPx: number,
  container: HTMLDivElement | null
): number {
  const containerRect = container?.getBoundingClientRect();
  const resolvedRightPx =
    containerRect?.right != null && Number.isFinite(containerRect.right) && containerRect.right > 0
      ? containerRect.right
      : viewportWidthPx;
  const maxPopupWidthPx = Math.max(
    SPAN_INSPECTOR_MIN_WIDTH_PX,
    resolvedRightPx - SPAN_INSPECTOR_VIEWPORT_PADDING_PX
  );
  return Math.max(SPAN_INSPECTOR_MIN_WIDTH_PX, maxPopupWidthPx);
}

/**
 * Clamp a proposed popup width into the supported resize range.
 */
export function clampSpanInspectorWidthPx(
  nextWidthPx: number,
  minWidthPx: number,
  maxWidthPx: number
): number {
  return Math.min(maxWidthPx, Math.max(minWidthPx, nextWidthPx));
}
