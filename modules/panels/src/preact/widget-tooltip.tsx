/** @jsxImportSource preact */

import type {ComponentChildren} from 'preact';

/** Preferred placement for a deck widget tooltip. */
export type WidgetTooltipPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'right'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left';

/** Props for the shared deck widget tooltip wrapper. */
export type WidgetTooltipProps = {
  /** Visible tooltip label. */
  label: string;
  /** Optional caller-provided tooltip HTML. */
  html?: HTMLElement | string;
  /** Optional keyboard shortcut text rendered as a trailing key chip. */
  shortcutKeyHTML?: string;
  /** Tooltip placement relative to the wrapped control. */
  placement?: WidgetTooltipPlacement;
  /** Control that owns the tooltip. */
  children: ComponentChildren;
};

/** Wraps a deck widget control with an immediate, styled hover/focus tooltip. */
export function WidgetTooltip({
  label,
  html,
  shortcutKeyHTML,
  placement = 'right',
  children
}: WidgetTooltipProps) {
  const tooltipContent =
    html === undefined ? (
      <>
        <span>{label}</span>
        {shortcutKeyHTML ? <kbd>{shortcutKeyHTML}</kbd> : null}
      </>
    ) : typeof html === 'string' ? (
      <span dangerouslySetInnerHTML={{__html: html}} />
    ) : (
      <span ref={element => element?.replaceChildren(html)} />
    );

  return (
    <span className="deck-widget-tooltip-anchor" data-tooltip-placement={placement}>
      <WidgetTooltipStyle />
      {children}
      <span className="deck-widget-tooltip" role="tooltip">
        {tooltipContent}
      </span>
    </span>
  );
}

function WidgetTooltipStyle() {
  return <style>{WIDGET_TOOLTIP_CSS}</style>;
}

const WIDGET_TOOLTIP_CSS = `
.deck-widget-tooltip-anchor {
  position: relative;
  display: inline-flex;
}

.deck-widget-tooltip {
  position: absolute;
  z-index: 2147483647;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  padding: 5px 7px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.94);
  color: white;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
  font: 500 11px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  opacity: 0;
  pointer-events: none;
  transition: opacity 80ms ease, transform 80ms ease;
  white-space: nowrap;
}

.deck-widget-tooltip kbd {
  display: inline-flex;
  align-items: center;
  min-height: 16px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.94);
  font: 600 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.deck-widget-tooltip-anchor:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor:has(:focus-visible) .deck-widget-tooltip {
  opacity: 1;
}

.deck-widget-tooltip-anchor[data-tooltip-placement="right"] .deck-widget-tooltip {
  left: calc(100% + 8px);
  top: 50%;
  transform: translate(-2px, -50%);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="right"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="right"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(0, -50%);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="left"] .deck-widget-tooltip {
  right: calc(100% + 8px);
  top: 50%;
  transform: translate(2px, -50%);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="left"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="left"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(0, -50%);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="top"] .deck-widget-tooltip {
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translate(-50%, 2px);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="top"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="top"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(-50%, 0);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="top-start"] .deck-widget-tooltip {
  bottom: calc(100% + 8px);
  left: 0;
  transform: translate(0, 2px);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="top-start"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="top-start"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(0, 0);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="top-end"] .deck-widget-tooltip {
  bottom: calc(100% + 8px);
  right: 0;
  transform: translate(0, 2px);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="top-end"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="top-end"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(0, 0);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="bottom"] .deck-widget-tooltip {
  left: 50%;
  top: calc(100% + 8px);
  transform: translate(-50%, -2px);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="bottom"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="bottom"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(-50%, 0);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="bottom-start"] .deck-widget-tooltip {
  left: 0;
  top: calc(100% + 8px);
  transform: translate(0, -2px);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="bottom-start"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="bottom-start"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(0, 0);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="bottom-end"] .deck-widget-tooltip {
  right: 0;
  top: calc(100% + 8px);
  transform: translate(0, -2px);
}

.deck-widget-tooltip-anchor[data-tooltip-placement="bottom-end"]:hover .deck-widget-tooltip,
.deck-widget-tooltip-anchor[data-tooltip-placement="bottom-end"]:has(:focus-visible) .deck-widget-tooltip {
  transform: translate(0, 0);
}
`;
