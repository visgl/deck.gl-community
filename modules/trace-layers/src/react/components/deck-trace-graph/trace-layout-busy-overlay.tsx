import {useCallback, useEffect, useRef, useState} from 'react';

/** Schedules a synchronous trace layout update only after its busy overlay can paint. */
export function useDeferredTraceLayoutUpdate(): DeferredTraceLayoutUpdate {
  const [isLayoutUpdatePending, setIsLayoutUpdatePending] = useState(false);
  const isLayoutUpdatePendingRef = useRef(false);
  const handlesRef = useRef<ScheduledTraceLayoutUpdateHandles>({
    animationFrameId: null,
    timeoutId: null
  });

  /** Cancels frame and task handles that have not begun synchronous layout work yet. */
  const cancelScheduledExpansion = useCallback(() => {
    const {animationFrameId, timeoutId} = handlesRef.current;
    if (
      animationFrameId !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(animationFrameId);
    }
    if (timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
    }
    handlesRef.current = {animationFrameId: null, timeoutId: null};
  }, []);

  useEffect(
    () => () => {
      cancelScheduledExpansion();
      isLayoutUpdatePendingRef.current = false;
    },
    [cancelScheduledExpansion]
  );

  /** Defers one synchronous layout update until the overlay receives a paint opportunity. */
  const scheduleLayoutUpdate = useCallback((update: () => void) => {
    if (isLayoutUpdatePendingRef.current) {
      return;
    }

    isLayoutUpdatePendingRef.current = true;
    setIsLayoutUpdatePending(true);

    /** Runs the queued layout update and always releases the busy interaction gate. */
    const runLayoutUpdate = () => {
      handlesRef.current = {animationFrameId: null, timeoutId: null};
      try {
        update();
      } finally {
        isLayoutUpdatePendingRef.current = false;
        setIsLayoutUpdatePending(false);
      }
    };

    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function' ||
      typeof window.cancelAnimationFrame !== 'function'
    ) {
      runLayoutUpdate();
      return;
    }

    handlesRef.current.animationFrameId = window.requestAnimationFrame(() => {
      handlesRef.current.animationFrameId = null;
      handlesRef.current.timeoutId = window.setTimeout(runLayoutUpdate, 0);
    });
  }, []);

  return {isLayoutUpdatePending, scheduleLayoutUpdate};
}

/** Renders a themed, compositor-friendly busy overlay for trace layout updates. */
export function TraceLayoutBusyOverlay() {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/50"
      data-testid="trace-layout-busy-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 rounded-md border border-border bg-background px-4 py-3 text-foreground shadow-lg">
        <span className="h-5 w-5 shrink-0" style={{transform: 'translateZ(0)'}} aria-hidden="true">
          <span
            className="block h-full w-full animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
            style={{willChange: 'transform'}}
          />
        </span>
        <span className="text-sm">Updating trace layout…</span>
      </div>
    </div>
  );
}

/** Handles retained while one trace layout update waits for its pre-work paint. */
type ScheduledTraceLayoutUpdateHandles = {
  /** Animation-frame handle waiting for the busy overlay's first paint. */
  animationFrameId: number | null;
  /** Task handle waiting to start synchronous trace expansion after that paint. */
  timeoutId: number | null;
};

/** State and dispatcher for one compositor-visible trace layout update. */
type DeferredTraceLayoutUpdate = {
  /** Whether a layout update is waiting to run or rebuilding the trace layout. */
  isLayoutUpdatePending: boolean;
  /** Schedules one layout update after the busy overlay has had a chance to paint. */
  scheduleLayoutUpdate: (update: () => void) => void;
};
