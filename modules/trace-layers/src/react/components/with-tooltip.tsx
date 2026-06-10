import {ReactNode, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {cn} from './ui';

import type {CSSProperties, Dispatch, FocusEvent, MouseEvent, SetStateAction} from 'react';

/** Visual treatment applied to the tooltip popup. */
export type WithTooltipVariant = 'neutral' | 'brand';

/** Props for the lightweight Tracevis tooltip wrapper. */
export type WithTooltipProps = {
  /** Tooltip body shown while the wrapped content is hovered or focused. */
  tooltip?: ReactNode;
  /** Text copied when the tooltip is open and the user presses Cmd/Ctrl-C. */
  copyText?: string;
  /** Wrapped content that owns the tooltip interaction target. */
  children: ReactNode;
  /** Optional class name added to the tooltip popup. */
  className?: string;
  /** Compatibility flag matching the old infovis API; Tracevis always wraps with one anchor. */
  asChild?: boolean;
  /** Optional visual style for the tooltip popup. */
  variant?: WithTooltipVariant;
};

const MAX_TOOLTIP_LINE_LENGTH = 80;
const TOOLTIP_TARGET_OFFSET_PX = 4;
const TOOLTIP_VIEWPORT_PADDING_PX = 8;

const TOOLTIP_VARIANT_CLASS_NAMES: Record<WithTooltipVariant, string> = {
  brand: 'bg-primary text-primary-foreground',
  neutral: 'bg-zinc-900 text-white dark:bg-zinc-900 dark:text-white'
};

/** Viewport-fixed tooltip popup coordinates. */
type TooltipPosition = {
  /** Left edge of the tooltip in viewport pixels. */
  left: number;
  /** Top edge of the tooltip in viewport pixels. */
  top: number;
};

/**
 * Wrap content with a small hover/focus tooltip without depending on private UI packages.
 */
export function WithTooltip({
  tooltip,
  copyText,
  children,
  className,
  asChild: _asChild = true,
  variant = 'neutral'
}: WithTooltipProps) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    if (!open || !copyText) {
      return undefined;
    }

    const abortController = new AbortController();
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        void navigator.clipboard?.writeText(copyText);
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', handleKeyDown, {
      signal: abortController.signal
    });
    return () => abortController.abort();
  }, [copyText, open]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    updateTooltipPosition(rootRef.current, tooltipRef.current, setTooltipPosition);
    return undefined;
  }, [open, tooltip]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const updatePosition = () =>
      updateTooltipPosition(rootRef.current, tooltipRef.current, setTooltipPosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, tooltip]);

  if (!tooltip) {
    return <>{children}</>;
  }

  const showTooltip = () => {
    if (!open) {
      setTooltipPosition(null);
    }
    setOpen(true);
  };

  const closeTooltip = () => {
    setOpen(false);
    setTooltipPosition(null);
  };

  const handleMouseOut = (event: MouseEvent<HTMLSpanElement>) => {
    if (containsEventTarget(rootRef.current, event.relatedTarget)) {
      return;
    }
    closeTooltip();
  };

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (containsEventTarget(rootRef.current, event.relatedTarget)) {
      return;
    }
    closeTooltip();
  };

  const tooltipStyle = getTooltipStyle(tooltipPosition);

  return (
    <span
      ref={rootRef}
      aria-describedby={open ? tooltipId : undefined}
      className="relative inline-flex max-w-full align-middle"
      onBlur={handleBlur}
      onFocus={showTooltip}
      onMouseOut={handleMouseOut}
      onMouseOver={showTooltip}
    >
      {children}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className={cn(
                'pointer-events-none fixed z-[2147483647] max-w-[32rem] whitespace-pre-wrap break-words rounded-md border border-border px-2 py-1 text-left text-xs shadow-md',
                TOOLTIP_VARIANT_CLASS_NAMES[variant],
                className
              )}
              style={tooltipStyle}
            >
              {renderTooltipContent(tooltip)}
            </span>,
            getTooltipPortalRoot()
          )
        : null}
    </span>
  );
}

/** Returns the portal root that can render above normal app clipping containers. */
function getTooltipPortalRoot(): Element {
  return document.fullscreenElement ?? document.body;
}

/** Returns inline styles for a tooltip while its measured position is pending or ready. */
function getTooltipStyle(position: TooltipPosition | null): CSSProperties {
  if (!position) {
    return {
      left: 0,
      top: 0,
      visibility: 'hidden'
    };
  }

  return {
    left: position.left,
    top: position.top
  };
}

/**
 * Measures and stores a viewport-clamped fixed tooltip position.
 */
function updateTooltipPosition(
  trigger: HTMLElement | null,
  tooltip: HTMLElement | null,
  setTooltipPosition: Dispatch<SetStateAction<TooltipPosition | null>>
): void {
  const nextPosition = getTooltipPosition(trigger, tooltip);
  setTooltipPosition(currentPosition =>
    areTooltipPositionsEqual(currentPosition, nextPosition) ? currentPosition : nextPosition
  );
}

/** Computes a viewport-clamped fixed tooltip position for a trigger element. */
function getTooltipPosition(
  trigger: HTMLElement | null,
  tooltip: HTMLElement | null
): TooltipPosition | null {
  if (!trigger || !tooltip || typeof window === 'undefined') {
    return null;
  }

  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const usableTooltipWidth = Math.min(
    tooltipRect.width,
    Math.max(0, viewportWidth - TOOLTIP_VIEWPORT_PADDING_PX * 2)
  );
  const usableTooltipHeight = Math.min(
    tooltipRect.height,
    Math.max(0, viewportHeight - TOOLTIP_VIEWPORT_PADDING_PX * 2)
  );
  const desiredLeft = triggerRect.left + triggerRect.width / 2 - usableTooltipWidth / 2;
  const maxLeft = Math.max(
    TOOLTIP_VIEWPORT_PADDING_PX,
    viewportWidth - usableTooltipWidth - TOOLTIP_VIEWPORT_PADDING_PX
  );
  const left = clamp(desiredLeft, TOOLTIP_VIEWPORT_PADDING_PX, maxLeft);
  const aboveTop = triggerRect.top - usableTooltipHeight - TOOLTIP_TARGET_OFFSET_PX;
  const belowTop = triggerRect.bottom + TOOLTIP_TARGET_OFFSET_PX;
  const hasRoomAbove = aboveTop >= TOOLTIP_VIEWPORT_PADDING_PX;
  const hasRoomBelow =
    belowTop + usableTooltipHeight <= viewportHeight - TOOLTIP_VIEWPORT_PADDING_PX;
  const desiredTop = hasRoomAbove || !hasRoomBelow ? aboveTop : belowTop;
  const maxTop = Math.max(
    TOOLTIP_VIEWPORT_PADDING_PX,
    viewportHeight - usableTooltipHeight - TOOLTIP_VIEWPORT_PADDING_PX
  );

  return {
    left,
    top: clamp(desiredTop, TOOLTIP_VIEWPORT_PADDING_PX, maxTop)
  };
}

function areTooltipPositionsEqual(
  left: TooltipPosition | null,
  right: TooltipPosition | null
): boolean {
  return left?.left === right?.left && left?.top === right?.top;
}

function renderTooltipContent(tooltip: ReactNode): ReactNode {
  if (typeof tooltip !== 'string') {
    return tooltip;
  }

  return wrapTooltipText(tooltip, MAX_TOOLTIP_LINE_LENGTH)
    .split('\n')
    .map((line, index, lines) => (
      <span key={`${index}-${line}`}>
        {line}
        {index < lines.length - 1 ? <br /> : null}
      </span>
    ));
}

function wrapTooltipText(text: string, maxLength: number): string {
  return text
    .split('\n')
    .flatMap(line => {
      if (line.length <= maxLength) {
        return [line];
      }

      const wrapped: string[] = [];
      for (let start = 0; start < line.length; start += maxLength) {
        wrapped.push(line.slice(start, start + maxLength));
      }
      return wrapped;
    })
    .join('\n');
}

/** Clamps a number to an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsEventTarget(root: HTMLElement | null, target: EventTarget | null): boolean {
  return target instanceof Node && root?.contains(target) === true;
}
