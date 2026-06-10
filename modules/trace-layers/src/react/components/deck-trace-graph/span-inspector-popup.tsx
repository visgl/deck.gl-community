import {ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';

import {TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX} from './cards/trace-span-card/trace-span-card-types';
import {
  clampSpanInspectorTabBodyHeightPx,
  clampSpanInspectorWidthPx,
  getSpanInspectorMaxTabBodyHeightPx,
  getSpanInspectorMaxWidthPx,
  SPAN_INSPECTOR_DEFAULT_WIDTH_PX,
  SPAN_INSPECTOR_MIN_WIDTH_PX
} from './span-inspector-popup-utils';

import type {PointerEvent as ReactPointerEvent} from 'react';

/**
 * Props for the pinned Span Inspector shell.
 */
export type SpanInspectorPopupProps = {
  /** Current popup width in pixels. */
  widthPx: number;
  /** Callback used to persist the current session-scoped popup width. */
  onWidthChange: (nextWidthPx: number) => void;
  /** Current resizable tab-body height in pixels. */
  tabBodyHeightPx: number;
  /** Callback used to persist the current session-scoped tab-body height. */
  onTabBodyHeightChange: (nextTabBodyHeightPx: number) => void;
  /** Visible title shown in the popup header. Defaults to the generic span-oriented label. */
  title?: string;
  /** Optional callback invoked when the user asks to hide the popup. */
  onClose?: () => void;
  /** Accessible label for the optional close button. */
  closeLabel?: string;
  /** Inspector content rendered below the title bar. */
  children: ReactNode;
};

/**
 * Render the named pinned popup shell for span/block inspection.
 */
export function SpanInspectorPopup(props: SpanInspectorPopupProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startClientX: number;
    startClientY: number;
    startWidthPx: number;
    startTabBodyHeightPx: number;
    pointerId: number | null;
  } | null>(null);
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const title = props.title ?? 'Span Inspector';
  const closeLabel = props.closeLabel ?? `Close ${title}`;

  const clampWidthPx = useCallback((nextWidthPx: number) => {
    const maxWidthPx = getSpanInspectorMaxWidthPx(window.innerWidth, containerRef.current);
    return clampSpanInspectorWidthPx(nextWidthPx, SPAN_INSPECTOR_MIN_WIDTH_PX, maxWidthPx);
  }, []);

  const clampTabBodyHeightPx = useCallback(
    (nextTabBodyHeightPx: number) => {
      const maxTabBodyHeightPx = getSpanInspectorMaxTabBodyHeightPx(
        window.innerHeight,
        containerRef.current,
        props.tabBodyHeightPx
      );
      return clampSpanInspectorTabBodyHeightPx(
        nextTabBodyHeightPx,
        TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX,
        maxTabBodyHeightPx
      );
    },
    [props.tabBodyHeightPx]
  );

  useLayoutEffect(() => {
    const clampedWidthPx = clampWidthPx(props.widthPx);
    if (clampedWidthPx !== props.widthPx) {
      props.onWidthChange(clampedWidthPx);
    }

    const clampedTabBodyHeightPx = clampTabBodyHeightPx(props.tabBodyHeightPx);
    if (clampedTabBodyHeightPx !== props.tabBodyHeightPx) {
      props.onTabBodyHeightChange(clampedTabBodyHeightPx);
    }
  }, [
    clampTabBodyHeightPx,
    clampWidthPx,
    props.onTabBodyHeightChange,
    props.onWidthChange,
    props.tabBodyHeightPx,
    props.widthPx
  ]);

  useEffect(() => {
    const handleWindowResize = () => {
      const clampedWidthPx = clampWidthPx(props.widthPx);
      if (clampedWidthPx !== props.widthPx) {
        props.onWidthChange(clampedWidthPx);
      }

      const clampedTabBodyHeightPx = clampTabBodyHeightPx(props.tabBodyHeightPx);
      if (clampedTabBodyHeightPx !== props.tabBodyHeightPx) {
        props.onTabBodyHeightChange(clampedTabBodyHeightPx);
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [
    clampTabBodyHeightPx,
    clampWidthPx,
    props.onTabBodyHeightChange,
    props.onWidthChange,
    props.tabBodyHeightPx,
    props.widthPx
  ]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const deltaX = dragState.startClientX - event.clientX;
      const deltaY = dragState.startClientY - event.clientY;
      props.onWidthChange(clampWidthPx(dragState.startWidthPx + deltaX));
      props.onTabBodyHeightChange(clampTabBodyHeightPx(dragState.startTabBodyHeightPx + deltaY));
    };

    const stopResizing = () => {
      const dragState = dragStateRef.current;
      if (dragState?.pointerId != null) {
        const resizeHandle = resizeHandleRef.current;
        if (resizeHandle?.hasPointerCapture?.(dragState.pointerId)) {
          resizeHandle.releasePointerCapture(dragState.pointerId);
        }
      }
      dragStateRef.current = null;
      setIsResizing(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopResizing();
      }
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove, {capture: true});
    window.addEventListener('pointerup', stopResizing, {capture: true});
    window.addEventListener('pointercancel', stopResizing, {capture: true});
    window.addEventListener('keydown', handleKeyDown, {capture: true});
    window.addEventListener('blur', stopResizing);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove, {capture: true});
      window.removeEventListener('pointerup', stopResizing, {capture: true});
      window.removeEventListener('pointercancel', stopResizing, {capture: true});
      window.removeEventListener('keydown', handleKeyDown, {capture: true});
      window.removeEventListener('blur', stopResizing);
    };
  }, [
    clampTabBodyHeightPx,
    clampWidthPx,
    isResizing,
    props.onTabBodyHeightChange,
    props.onWidthChange
  ]);

  /**
   * Start a resize interaction from the top-left handle.
   */
  function handleResizeHandlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    dragStateRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidthPx: props.widthPx,
      startTabBodyHeightPx: props.tabBodyHeightPx,
      pointerId
    };
    if (pointerId != null) {
      try {
        event.currentTarget.setPointerCapture?.(pointerId);
      } catch {
        // Synthetic browser tests can dispatch pointerdown without creating an active pointer.
      }
    }
    setIsResizing(true);
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={containerRef}
      data-testid="span-inspector-popup"
      className="relative overflow-hidden rounded-sm bg-muted text-foreground shadow-md pointer-events-auto"
      style={{width: `${props.widthPx || SPAN_INSPECTOR_DEFAULT_WIDTH_PX}px`}}
    >
      <div className="relative border-b border-white/10 px-3 py-1.5 pl-10 pr-9">
        <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {title}
        </div>
        <button
          ref={resizeHandleRef}
          type="button"
          data-testid="span-inspector-resize-handle"
          aria-label={`Resize ${title}`}
          onPointerDown={handleResizeHandlePointerDown}
          onLostPointerCapture={() => {
            dragStateRef.current = null;
            setIsResizing(false);
          }}
          className={`absolute left-0.5 top-0.5 flex h-5 w-5 items-start justify-start rounded-br-sm text-white/70 transition-colors ${
            isResizing ? 'cursor-nwse-resize bg-white/10' : 'cursor-nwse-resize hover:bg-white/8'
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="ml-0.5 mt-0.5 h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.35"
          >
            <path d="M11 1L4 8" className="opacity-80" />
            <path d="M8 1L4 5" className="opacity-65" />
            <path d="M5 1L4 2" className="opacity-50" />
          </svg>
        </button>
        {props.onClose && (
          <button
            type="button"
            aria-label={closeLabel}
            data-testid="span-inspector-close"
            onClick={event => {
              event.stopPropagation();
              props.onClose?.();
            }}
            onPointerDown={event => event.stopPropagation()}
            className="absolute right-1.5 top-1 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.6"
            >
              <path d="M3 3l6 6" />
              <path d="M9 3L3 9" />
            </svg>
          </button>
        )}
      </div>
      {props.children}
    </div>
  );
}
