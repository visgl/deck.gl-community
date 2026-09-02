// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';
import {createPortal} from 'preact/compat';
import {useEffect, useId, useState} from 'preact/hooks';

import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';

/** JSON-safe CSS color or deck.gl-style RGB(A) tuple. Tuple channels use the 0-255 range. */
export type ColorLegendColor =
  | string
  | readonly [red: number, green: number, blue: number]
  | readonly [red: number, green: number, blue: number, alpha: number];

/** One labeled swatch in a categorical legend section. */
export type ColorLegendCategoricalEntry = {
  /** Color rendered by the swatch. */
  readonly color: ColorLegendColor;
  /** Primary category label. */
  readonly label: string;
  /** Optional secondary explanation rendered below the label. */
  readonly description?: string;
  /** Optional accessible hover text shared by the complete row, its label, and its swatch. */
  readonly title?: string;
};

/** One low-to-high stop in a continuous color scale. */
export type ColorLegendContinuousStop = {
  /** Color at this point in the scale. */
  readonly color: ColorLegendColor;
  /** Human-readable value rendered beside the stop. */
  readonly label: string;
};

/** One color in a compact palette strip. */
export type ColorLegendPaletteColor = {
  /** Color rendered in the palette. */
  readonly color: ColorLegendColor;
  /** Optional accessible and hover label for this individual color. */
  readonly label?: string;
};

/** Expandable list of discrete categories. */
export type ColorLegendCategoricalSection = {
  /** Discriminator for a categorical section. */
  readonly type: 'categorical';
  /** Stable JSON identifier used to preserve this section's interaction state. */
  readonly id: string;
  /** Optional heading above this section. */
  readonly title?: string;
  /** Prepared entries, ordered as they should appear. */
  readonly entries: readonly ColorLegendCategoricalEntry[];
  /** Exact category count, including entries omitted from this bounded payload. */
  readonly totalCount?: number;
  /** Number of entries shown before expansion. Defaults to 10. */
  readonly maxVisibleEntries?: number;
  /** Number of prepared entries shown after expansion. Defaults to 100. */
  readonly maxExpandedEntries?: number;
};

/** Vertical gradient with labeled stops. Stops are ordered from low to high. */
export type ColorLegendContinuousSection = {
  /** Discriminator for a continuous section. */
  readonly type: 'continuous';
  /** Stable JSON identifier for this section. */
  readonly id: string;
  /** Optional heading above this section. */
  readonly title?: string;
  /** Gradient stops ordered from the smallest value to the largest value. */
  readonly stops: readonly ColorLegendContinuousStop[];
};

/** Compact row of colors used when individual categories are intentionally not enumerated. */
export type ColorLegendPaletteSection = {
  /** Discriminator for a palette section. */
  readonly type: 'palette';
  /** Stable JSON identifier for this section. */
  readonly id: string;
  /** Optional heading above this section. */
  readonly title?: string;
  /** Optional explanation rendered beside the palette strip. */
  readonly label?: string;
  /** Colors shown from left to right. */
  readonly colors: readonly ColorLegendPaletteColor[];
};

/** One declarative section in a color legend payload. */
export type ColorLegendSection =
  | ColorLegendCategoricalSection
  | ColorLegendContinuousSection
  | ColorLegendPaletteSection;

/** Serializable content rendered by {@link ColorLegendWidget}. */
export type ColorLegendPayload = {
  /** Stable identifier for the selected scheme and its local interaction state. */
  readonly id: string;
  /** Visible legend heading. */
  readonly title: string;
  /** Optional short explanation below the heading. */
  readonly description?: string;
  /** Optional accessible label. Defaults to "{title} legend". */
  readonly ariaLabel?: string;
  /** Ordered categorical, continuous, and palette sections. */
  readonly sections: readonly ColorLegendSection[];
};

/** Props for a deck.gl widget driven by a JSON-safe color legend payload. */
export type ColorLegendWidgetProps = WidgetProps & {
  /** Serializable legend definition prepared by the caller. */
  readonly payload: ColorLegendPayload;
  /** Deck widget placement within the selected view. Defaults to bottom-right. */
  readonly placement?: WidgetPlacement;
  /** Deck view that owns the widget. */
  readonly viewId?: string | null;
  /** Optional action shown as a dismiss button in the legend header. */
  readonly onClose?: () => void;
};

/** Deck.gl widget that renders categorical, continuous, and palette color keys from JSON. */
export class ColorLegendWidget extends Widget<ColorLegendWidgetProps> {
  /** Theme-owned deck widget class attached to the legend host. */
  override className = 'deck-widget-color-legend';
  /** Default corner for floating color legends. */
  override placement: WidgetPlacement = 'bottom-right';

  /** Latest element owned by Preact so it can be cleanly unmounted. */
  #rootElement: HTMLElement | null = null;

  /** Creates a color legend widget from a JSON-safe payload. */
  constructor(props: ColorLegendWidgetProps) {
    super({id: 'color-legend', ...props});
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId ?? this.viewId;
  }

  /** Keeps placement and view ownership synchronized with deck-managed prop updates. */
  override setProps(props: Partial<ColorLegendWidgetProps>): void {
    this.placement = props.placement ?? this.placement;
    if (props.viewId !== undefined) {
      this.viewId = props.viewId;
    }
    super.setProps(props);
  }

  /** Renders the latest declarative payload without inspecting application data. */
  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    rootElement.style.pointerEvents = 'none';
    render(
      <ColorLegendView payload={this.props.payload} onClose={this.props.onClose} />,
      rootElement
    );
  }

  /** Releases the Preact tree when deck.gl removes the widget. */
  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
      this.#rootElement = null;
    }
  }
}

const DEFAULT_VISIBLE_ENTRY_COUNT = 10;
const DEFAULT_EXPANDED_ENTRY_COUNT = 100;

const LEGEND_STYLE: JSX.CSSProperties = {
  pointerEvents: 'none',
  maxWidth: '224px',
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: '1px solid var(--button-stroke, rgba(148, 163, 184, 0.35))',
  borderRadius: 'var(--button-corner-radius, 6px)',
  background: 'var(--menu-background, var(--button-background, rgba(255, 255, 255, 0.95)))',
  color: 'var(--menu-text, var(--button-text, currentColor))',
  boxShadow: 'var(--button-shadow, 0 1px 3px rgba(0, 0, 0, 0.15))',
  fontSize: '12px',
  lineHeight: 1.25,
  transform: 'scale(0.9)',
  transformOrigin: 'bottom right'
};

const HEADER_STYLE: JSX.CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  marginBottom: '6px',
  fontWeight: 500
};

const MUTED_TEXT_STYLE: JSX.CSSProperties = {
  color: 'var(--menu-text-muted, var(--button-icon-idle, currentColor))',
  opacity: 0.78
};

const CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  pointerEvents: 'auto',
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
  padding: 0,
  border: 0,
  borderRadius: '3px',
  background: 'transparent',
  color: 'var(--button-icon-idle, currentColor)',
  cursor: 'pointer',
  opacity: 0,
  transition: 'opacity 120ms ease'
};

const ACTION_BUTTON_STYLE: JSX.CSSProperties = {
  pointerEvents: 'auto',
  appearance: 'none',
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'var(--button-icon-idle, currentColor)',
  font: 'inherit',
  cursor: 'pointer'
};

const ENTRY_TOOLTIP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  zIndex: 2_147_483_647,
  width: 'max-content',
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: '1px solid CanvasText',
  borderRadius: '6px',
  background: 'Canvas',
  color: 'CanvasText',
  boxShadow: 'none',
  fontSize: '12px',
  lineHeight: 1.35,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  pointerEvents: 'none'
};

type ColorLegendViewProps = {
  /** Serializable content to render. */
  readonly payload: ColorLegendPayload;
  /** Optional dismiss action for the legend header. */
  readonly onClose?: () => void;
};

type ColorLegendSectionViewProps = {
  /** Discriminated section to render. */
  readonly section: ColorLegendSection;
  /** Whether this section's complete prepared entry set is visible. */
  readonly isExpanded: boolean;
  /** Updates this section's expansion state. */
  readonly onExpandedChange: (isExpanded: boolean) => void;
};

type CategoricalSectionViewProps = {
  /** Categorical section to render. */
  readonly section: ColorLegendCategoricalSection;
  /** Whether the expanded prepared entry prefix is visible. */
  readonly isExpanded: boolean;
  /** Updates this section's expansion state. */
  readonly onExpandedChange: (isExpanded: boolean) => void;
};

/** Viewport-positioned tooltip state for the single currently hovered legend row. */
type ColorLegendHoveredEntry = {
  /** Immutable categorical section that owned the row when its tooltip opened. */
  readonly section: ColorLegendCategoricalSection;
  /** Immutable legend entry associated with the visible tooltip and focus target. */
  readonly entry: ColorLegendCategoricalEntry;
  /** Full prepared hover text supplied by the categorical legend entry. */
  readonly title: string;
  /** Viewport-relative tooltip anchor position on the horizontal axis. */
  readonly left: number;
  /** Viewport-relative vertical midpoint of the hovered legend row. */
  readonly top: number;
  /** Whether the tooltip should open to the left or right of its anchor. */
  readonly placement: 'left' | 'right';
  /** Maximum tooltip width that still fits inside the current viewport. */
  readonly maxWidth: number;
  /** Resolved legend surface color retained outside the deck theme's DOM scope. */
  readonly backgroundColor: string;
  /** Resolved legend foreground color retained outside the deck theme's DOM scope. */
  readonly color: string;
  /** Resolved legend border color retained outside the deck theme's DOM scope. */
  readonly borderColor: string;
  /** Resolved legend corner radius retained outside the deck theme's DOM scope. */
  readonly borderRadius: string;
  /** Resolved legend shadow retained outside the deck theme's DOM scope. */
  readonly boxShadow: string;
  /** Document that owns the legend row and its clipping-independent portal. */
  readonly ownerDocument: Document;
};

type ContinuousSectionViewProps = {
  /** Continuous scale to render. */
  readonly section: ColorLegendContinuousSection;
};

type PaletteSectionViewProps = {
  /** Compact palette to render. */
  readonly section: ColorLegendPaletteSection;
};

type ColorSwatchProps = {
  /** Color rendered by the swatch. */
  readonly color: ColorLegendColor;
  /** CSS width and height for the square. */
  readonly size?: string;
  /** Optional accessible and hover label. */
  readonly title?: string;
};

/** Preact view for one serializable color legend. */
function ColorLegendView({payload, onClose}: ColorLegendViewProps) {
  const [expandedSectionKey, setExpandedSectionKey] = useState<string | null>(null);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [isCloseFocused, setIsCloseFocused] = useState(false);

  if (payload.sections.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label={payload.ariaLabel ?? `${payload.title} legend`}
      className="deck-widget-color-legend-content"
      data-testid="color-legend"
      style={LEGEND_STYLE}
    >
      <div
        style={HEADER_STYLE}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
      >
        <span>{payload.title}</span>
        {onClose ? (
          <button
            aria-label="Close color legend"
            className="deck-widget-color-legend-close"
            style={{
              ...CLOSE_BUTTON_STYLE,
              opacity: isHeaderHovered || isCloseFocused ? 1 : 0
            }}
            type="button"
            onBlur={() => setIsCloseFocused(false)}
            onClick={onClose}
            onFocus={() => setIsCloseFocused(true)}
          >
            <svg aria-hidden="true" height="12" viewBox="0 0 12 12" width="12">
              <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </button>
        ) : null}
      </div>
      {payload.description ? (
        <div style={{...MUTED_TEXT_STYLE, marginBottom: '7px'}}>{payload.description}</div>
      ) : null}
      <div style={{display: 'flex', flexDirection: 'column', gap: '7px'}}>
        {payload.sections.map(section => {
          const sectionKey = `${payload.id}:${section.id}`;
          return (
            <ColorLegendSectionView
              key={section.id}
              section={section}
              isExpanded={expandedSectionKey === sectionKey}
              onExpandedChange={isExpanded => setExpandedSectionKey(isExpanded ? sectionKey : null)}
            />
          );
        })}
      </div>
    </aside>
  );
}

/** Renders one discriminated legend section. */
function ColorLegendSectionView({
  section,
  isExpanded,
  onExpandedChange
}: ColorLegendSectionViewProps) {
  return (
    <section>
      {section.title ? (
        <div style={{marginBottom: '4px', fontWeight: 500}}>{section.title}</div>
      ) : null}
      {section.type === 'categorical' ? (
        <CategoricalSectionView
          section={section}
          isExpanded={isExpanded}
          onExpandedChange={onExpandedChange}
        />
      ) : section.type === 'continuous' ? (
        <ContinuousSectionView section={section} />
      ) : (
        <PaletteSectionView section={section} />
      )}
    </section>
  );
}

/** Renders a bounded categorical list with optional expansion. */
function CategoricalSectionView({
  section,
  isExpanded,
  onExpandedChange
}: CategoricalSectionViewProps) {
  const [hoveredEntry, setHoveredEntry] = useState<ColorLegendHoveredEntry | null>(null);
  const tooltipId = useId();
  const activeHoveredEntry = hoveredEntry?.section === section ? hoveredEntry : null;

  useEffect(() => {
    const ownerWindow = activeHoveredEntry?.ownerDocument.defaultView;
    if (!ownerWindow) {
      return undefined;
    }

    const dismissTooltip = () => setHoveredEntry(null);
    ownerWindow.addEventListener('scroll', dismissTooltip, true);
    ownerWindow.addEventListener('resize', dismissTooltip);
    return () => {
      ownerWindow.removeEventListener('scroll', dismissTooltip, true);
      ownerWindow.removeEventListener('resize', dismissTooltip);
    };
  }, [activeHoveredEntry]);

  const visibleLimit = normalizeEntryLimit(
    isExpanded ? section.maxExpandedEntries : section.maxVisibleEntries,
    isExpanded ? DEFAULT_EXPANDED_ENTRY_COUNT : DEFAULT_VISIBLE_ENTRY_COUNT
  );
  const visibleEntries = section.entries.slice(0, visibleLimit);
  const totalCount = Math.max(section.totalCount ?? section.entries.length, section.entries.length);
  const hiddenCount = Math.max(0, totalCount - visibleEntries.length);
  const canExpand = !isExpanded && section.entries.length > visibleEntries.length;

  return (
    <>
      <ul
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          maxHeight: isExpanded ? '288px' : undefined,
          margin: 0,
          padding: 0,
          overflowY: isExpanded ? 'auto' : undefined,
          listStyle: 'none',
          pointerEvents: isExpanded ? 'auto' : undefined
        }}
        onScroll={() => setHoveredEntry(null)}
      >
        {visibleEntries.map((entry, index) => (
          <li
            key={`${entry.label}:${index}`}
            style={{
              display: 'flex',
              minWidth: 0,
              alignItems: 'center',
              gap: '6px',
              pointerEvents: entry.title ? 'auto' : undefined
            }}
            aria-describedby={activeHoveredEntry?.entry === entry ? tooltipId : undefined}
            tabIndex={entry.title ? 0 : undefined}
            title={entry.title}
            onMouseEnter={
              entry.title
                ? event =>
                    showColorLegendEntryTooltip(
                      event.currentTarget,
                      entry,
                      section,
                      setHoveredEntry
                    )
                : undefined
            }
            onMouseLeave={entry.title ? () => setHoveredEntry(null) : undefined}
            onFocus={
              entry.title
                ? event =>
                    showColorLegendEntryTooltip(
                      event.currentTarget,
                      entry,
                      section,
                      setHoveredEntry
                    )
                : undefined
            }
            onBlur={entry.title ? () => setHoveredEntry(null) : undefined}
          >
            <ColorSwatch color={entry.color} title={entry.title} />
            <span style={{minWidth: 0, overflow: 'hidden'}}>
              <span
                style={{
                  ...MUTED_TEXT_STYLE,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={entry.title ?? entry.label}
              >
                {entry.label}
              </span>
              {entry.description ? (
                <span
                  style={{...MUTED_TEXT_STYLE, display: 'block', fontSize: '11px', opacity: 0.65}}
                >
                  {entry.description}
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {hiddenCount > 0 ? (
          <li>
            {canExpand ? (
              <button
                aria-label="Show all color categories"
                className="deck-widget-color-legend-action"
                style={ACTION_BUTTON_STYLE}
                type="button"
                onClick={() => onExpandedChange(true)}
              >
                {`+${hiddenCount.toLocaleString()} more`}
              </button>
            ) : (
              <span style={MUTED_TEXT_STYLE}>{`+${hiddenCount.toLocaleString()} more`}</span>
            )}
          </li>
        ) : null}
        {isExpanded ? (
          <li>
            <button
              aria-label="Collapse color categories"
              className="deck-widget-color-legend-action"
              style={ACTION_BUTTON_STYLE}
              type="button"
              onClick={() => onExpandedChange(false)}
            >
              Show less
            </button>
          </li>
        ) : null}
      </ul>
      {activeHoveredEntry
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              data-testid="color-legend-entry-tooltip"
              style={{
                ...ENTRY_TOOLTIP_STYLE,
                background: activeHoveredEntry.backgroundColor,
                color: activeHoveredEntry.color,
                borderColor: activeHoveredEntry.borderColor,
                borderRadius: activeHoveredEntry.borderRadius,
                boxShadow: activeHoveredEntry.boxShadow,
                left: `${activeHoveredEntry.left}px`,
                top: `${activeHoveredEntry.top}px`,
                maxWidth: `${activeHoveredEntry.maxWidth}px`,
                transform:
                  activeHoveredEntry.placement === 'left'
                    ? 'translate(-100%, -50%)'
                    : 'translate(0, -50%)'
              }}
            >
              {activeHoveredEntry.title}
            </span>,
            activeHoveredEntry.ownerDocument.body
          )
        : null}
    </>
  );
}

/** Opens a viewport-clamped tooltip using the resolved theme of its owning legend. */
function showColorLegendEntryTooltip(
  row: HTMLElement,
  entry: ColorLegendCategoricalEntry,
  section: ColorLegendCategoricalSection,
  onShow: (hoveredEntry: ColorLegendHoveredEntry) => void
): void {
  const title = entry.title;
  if (!title) {
    return;
  }

  const bounds = row.getBoundingClientRect();
  const ownerWindow = row.ownerDocument.defaultView;
  const viewportWidth = ownerWindow?.innerWidth ?? bounds.right;
  const maxWidth = Math.min(320, Math.max(0, viewportWidth - 16));
  const placement = bounds.left >= viewportWidth - bounds.right ? 'left' : 'right';
  const left =
    placement === 'left'
      ? Math.min(viewportWidth - 8, Math.max(maxWidth + 8, bounds.left - 8))
      : Math.max(8, Math.min(viewportWidth - maxWidth - 8, bounds.right + 8));
  const legend = row.closest<HTMLElement>('[data-testid="color-legend"]') ?? row;
  const theme = ownerWindow?.getComputedStyle(legend);

  onShow({
    section,
    entry,
    title,
    left,
    top: bounds.top + bounds.height / 2,
    placement,
    maxWidth,
    backgroundColor: theme?.backgroundColor || 'Canvas',
    color: theme?.color || 'CanvasText',
    borderColor: theme?.borderColor || theme?.color || 'CanvasText',
    borderRadius: theme?.borderRadius || '6px',
    boxShadow: theme?.boxShadow || 'none',
    ownerDocument: row.ownerDocument
  });
}

/** Renders one vertical continuous gradient and its high-to-low labels. */
function ContinuousSectionView({section}: ContinuousSectionViewProps) {
  return (
    <div style={{display: 'flex', alignItems: 'stretch', gap: '8px'}}>
      <div
        aria-hidden="true"
        data-testid="color-legend-gradient"
        style={{
          width: '8px',
          minHeight: '64px',
          flexShrink: 0,
          borderRadius: '9999px',
          backgroundImage: formatColorScaleGradient(section.stops)
        }}
      />
      <div
        style={{
          ...MUTED_TEXT_STYLE,
          display: 'flex',
          minHeight: '64px',
          flexDirection: 'column-reverse',
          justifyContent: 'space-between',
          gap: '8px'
        }}
      >
        {section.stops.map((stop, index) => (
          <span key={`${stop.label}:${index}`}>{stop.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Renders a compact strip for palettes whose categories should not be enumerated. */
function PaletteSectionView({section}: PaletteSectionViewProps) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
      <span style={{display: 'flex', flexShrink: 0, gap: '2px'}}>
        {section.colors.map((entry, index) => (
          <ColorSwatch
            key={`${formatLegendColor(entry.color)}:${index}`}
            color={entry.color}
            size="10px"
            title={entry.label}
          />
        ))}
      </span>
      {section.label ? <span style={MUTED_TEXT_STYLE}>{section.label}</span> : null}
    </div>
  );
}

/** Renders one small, non-interactive color sample. */
function ColorSwatch({color, size = '8px', title}: ColorSwatchProps) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-testid="color-legend-swatch"
      role={title ? 'img' : undefined}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '2px',
        backgroundColor: formatLegendColor(color)
      }}
      title={title}
    />
  );
}

/** Normalizes caller-provided entry limits to a safe non-negative integer. */
function normalizeEntryLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? fallback)) : fallback;
}

/** Converts one JSON-safe color value into CSS. */
function formatLegendColor(color: ColorLegendColor): string {
  if (typeof color === 'string') {
    return color;
  }
  const [red, green, blue, alpha = 255] = color;
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
}

/** Creates a bottom-to-top gradient from low-to-high declarative stops. */
function formatColorScaleGradient(stops: readonly ColorLegendContinuousStop[]): string {
  return `linear-gradient(to top, ${stops.map(stop => formatLegendColor(stop.color)).join(', ')})`;
}
