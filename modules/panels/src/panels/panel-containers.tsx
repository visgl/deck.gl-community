/** @jsxImportSource preact */
import {createContext} from 'preact';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'preact/hooks';

import {PANEL_THEME_DARK, PANEL_THEME_LIGHT} from '../lib/panel-theme';

import type {ComponentChildren, JSX} from 'preact';

/**
 * Internal panel identifier used by both accordion and tab containers.
 */
type PanelId = string;

/** Light/dark theme modes used for panel-scoped overrides. */
export type PanelThemeMode = 'light' | 'dark';

/** Public theme override options for panels. */
export type PanelTheme = 'inherit' | 'light' | 'dark' | 'invert';

/**
 * Describes one entry in an accordion or tabbed container.
 */
export type Panel = {
  /** Stable id used for expansion/selection bookkeeping. */
  id: PanelId;
  /** Visible heading text for the panel. */
  title: string;
  /** Renderable panel body. */
  content: JSX.Element;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
  /**
   * If true, the panel can not be interacted with and will not switch/expand.
   */
  disabled?: boolean;
  /**
   * If true, keep the panel mounted when collapsed (for preserving internal state).
   */
  keepMounted?: boolean;
};

export type PanelRecord = Record<string, Panel>;

export type AccordeonPanelProps = {
  /**
   * Map of panel IDs to panel definitions.
   */
  panels: PanelRecord;
  /** Optional identifier for the wrapper panel when embedded in another container. */
  id?: string;
  /** Optional heading used by outer overlays when this is rendered as a direct child panel. */
  title?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

export type TabbedPanelProps = {
  /**
   * Map of panel IDs to panel definitions.
   */
  panels: PanelRecord;
  /** Optional identifier for the wrapper panel when embedded in another container. */
  id?: string;
  /** Optional heading used by outer overlays when this is rendered as a direct child panel. */
  title?: string;
  /** Controls whether the tab list wraps onto multiple rows or scrolls horizontally. */
  tabListLayout?: 'wrap' | 'scroll';
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

export type ColumnPanelProps = {
  /**
   * Map of panel IDs to panel definitions.
   */
  panels: PanelRecord;
  /** Optional identifier for the wrapper panel when embedded in another container. */
  id?: string;
  /** Optional heading used by outer overlays when this is rendered as a direct child panel. */
  title?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

export type SplitterPanelOrientation = 'horizontal' | 'vertical';

export type SplitterPanelProps = {
  /**
   * Map of panel IDs to panel definitions.
   */
  panels: PanelRecord;
  /** Optional identifier for the wrapper panel when embedded in another container. */
  id?: string;
  /** Optional heading used by outer overlays when this is rendered as a direct child panel. */
  title?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
  /** Stacking orientation of the split panes. */
  orientation?: SplitterPanelOrientation;
  /** Initial ratio allocated to the first panel. */
  initialSplit?: number;
  /** Whether the split can be changed by dragging the divider. */
  editable?: boolean;
  /** Minimum ratio allocated to the first panel. */
  minSplit?: number;
  /** Maximum ratio allocated to the first panel. */
  maxSplit?: number;
  /** Called while dragging with the updated split ratio. */
  onChange?: (split: number) => void;
  /** Called when dragging starts. */
  onDragStart?: () => void;
  /** Called when dragging ends. */
  onDragEnd?: () => void;
};

export type CustomPanelProps = {
  /** Stable id used for expansion/selection bookkeeping. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /**
   * Called after the host element mounts.
   * Return a cleanup callback to dispose any manual DOM work on unmount.
   */
  onRenderHTML: (rootElement: HTMLElement) => void | (() => void);
  /**
   * If true, the panel can not be interacted with and will not switch/expand.
   */
  disabled?: boolean;
  /**
   * If true, keep the panel mounted when collapsed (for preserving internal state).
   */
  keepMounted?: boolean;
  /** Optional class name applied to the host element. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

export type MarkdownPanelProps = {
  /** Stable id used for expansion/selection bookkeeping. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Markdown source rendered into a small built-in safe subset. */
  markdown: string;
  /**
   * If true, the panel can not be interacted with and will not switch/expand.
   */
  disabled?: boolean;
  /**
   * If true, keep the panel mounted when collapsed (for preserving internal state).
   */
  keepMounted?: boolean;
  /** Optional class name applied to the markdown content host. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

/**
 * Normalizes an object map of panels into an array in insertion order.
 */
function normalizePanelRecordPanels(panels: PanelRecord): Panel[] {
  return Object.keys(panels).map(panelId => {
    const panel = panels[panelId];
    return {
      ...panel,
      id: panelId
    };
  });
}

/**
 * Mounts an imperative HTML host for custom panels.
 */
function CustomPanelContent({
  className,
  onRenderHTML
}: Pick<CustomPanelProps, 'className' | 'onRenderHTML'>) {
  const rootElementRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const rootElement = rootElementRef.current;
    if (!rootElement) {
      return undefined;
    }

    const cleanup = onRenderHTML(rootElement);
    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [onRenderHTML]);

  return <div ref={rootElementRef} className={className} />;
}

/**
 * A wrapper panel that renders child panels in an accordion layout.
 */
export class AccordeonPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;

  constructor({
    panels,
    id = 'accordeon-panels',
    title = 'Panels',
    theme = 'inherit'
  }: AccordeonPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.content = <AccordeonPanelContainer panels={normalizePanelRecordPanels(panels)} />;
  }
}

/**
 * A wrapper panel that renders child panels in a tabbed layout.
 */
export class TabbedPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;

  constructor({
    panels,
    id = 'tabbed-panels',
    title = 'Panels',
    tabListLayout = 'wrap',
    theme = 'inherit'
  }: TabbedPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.content = (
      <TabbedPanelContainer
        panels={normalizePanelRecordPanels(panels)}
        tabListLayout={tabListLayout}
      />
    );
  }
}

/**
 * A wrapper panel that renders child panels in a vertical column.
 */
export class ColumnPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;

  constructor({
    panels,
    id = 'column-panels',
    title = 'Panels',
    theme = 'inherit'
  }: ColumnPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.content = <ColumnPanelContainer panels={normalizePanelRecordPanels(panels)} />;
  }
}

/**
 * A wrapper panel that renders the first child panel in a resizable split view
 * against all remaining child panels.
 */
export class SplitterPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;

  constructor({
    panels,
    id = 'splitter-panels',
    title = 'Panels',
    theme = 'inherit',
    orientation = 'horizontal',
    initialSplit = 0.5,
    editable = true,
    minSplit = 0.05,
    maxSplit = 0.95,
    onChange,
    onDragStart,
    onDragEnd
  }: SplitterPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.content = (
      <SplitterPanelContent
        panels={normalizePanelRecordPanels(panels)}
        orientation={orientation}
        initialSplit={initialSplit}
        editable={editable}
        minSplit={minSplit}
        maxSplit={maxSplit}
        onChange={onChange}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }
}

/**
 * A wrapper panel that renders imperative HTML content into a managed host element.
 */
export class CustomPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;
  disabled?: boolean;
  keepMounted?: boolean;

  constructor({
    id,
    title,
    onRenderHTML,
    disabled,
    keepMounted,
    className,
    theme = 'inherit'
  }: CustomPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.disabled = disabled;
    this.keepMounted = keepMounted;
    this.content = <CustomPanelContent className={className} onRenderHTML={onRenderHTML} />;
  }
}

/**
 * A wrapper panel that renders a minimal built-in Markdown subset without external parsers.
 */
export class MarkdownPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;
  disabled?: boolean;
  keepMounted?: boolean;

  constructor({
    id,
    title,
    markdown,
    disabled,
    keepMounted,
    className,
    theme = 'inherit'
  }: MarkdownPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.disabled = disabled;
    this.keepMounted = keepMounted;
    this.content = (
      <div className={className} style={MARKDOWN_PANEL_STYLE}>
        {renderMarkdownBlocks(markdown)}
      </div>
    );
  }
}

/**
 * Shared props for both container implementations.
 */
export type PanelContentContainerBase = {
  /** Optional class name applied to the outer container. */
  className?: string;
  /** Optional set of panels to render. */
  panels: ReadonlyArray<Panel>;
};

/**
 * Single-panel container props for direct modal/sidebar content rendering.
 */
export type SinglePanelContentContainerProps = {
  /** Optional class name applied to the outer container. */
  className?: string;
  /** The panel to render as raw content. */
  panel: Panel;
};

/**
 * Accordion container properties.
 */
export type AccordeonPanelContainerProps = PanelContentContainerBase & {
  /** Optional uncontrolled default expanded panel ids. */
  defaultExpandedPanelIds?: ReadonlyArray<PanelId>;
  /**
   * Controlled expanded panel ids. If supplied, callers manage expand/collapse state.
   */
  expandedPanelIds?: ReadonlyArray<PanelId>;
  /**
   * Called when user intent changes expanded panel ids.
   */
  onExpandedPanelIdsChange?: (expandedPanelIds: ReadonlyArray<PanelId>) => void;
  /**
   * If false, opening one panel closes all others. Defaults to true.
   */
  allowMultipleExpanded?: boolean;
};

/**
 * Tabs container properties.
 */
export type TabbedPanelContainerProps = PanelContentContainerBase & {
  /** Optional uncontrolled default active tab id. */
  defaultActivePanelId?: PanelId;
  /**
   * Controlled active tab id. If supplied, callers manage active tab state.
   */
  activePanelId?: PanelId;
  /**
   * Called when user intent changes active tab id.
   */
  onActivePanelIdChange?: (activePanelId: PanelId | undefined) => void;
  /** Controls whether the tab list wraps onto multiple rows or scrolls horizontally. */
  tabListLayout?: 'wrap' | 'scroll';
};

/**
 * Column container properties.
 */
export type ColumnPanelContainerProps = PanelContentContainerBase;

type SplitterPanelContentProps = {
  panels: ReadonlyArray<Panel>;
  orientation: SplitterPanelOrientation;
  initialSplit: number;
  editable: boolean;
  minSplit: number;
  maxSplit: number;
  onChange?: (split: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

/** A serialized form describing an accordion panel content container. */
export type PanelAccordeonContentContainer = {
  /** Container variant discriminator. */
  kind: 'accordeon';
  /** Accordion container props. */
  props: AccordeonPanelContainerProps;
};

/** A serialized form describing a tabbed panel content container. */
export type PanelTabbedContentContainer = {
  /** Container variant discriminator. */
  kind: 'tabs';
  /** Tabs container props. */
  props: TabbedPanelContainerProps;
};

/** A serialized form describing a single panel panel content container. */
export type SinglePanelContentContainer = {
  /** Container variant discriminator. */
  kind: 'panel';
  /** Single-panel props. */
  props: SinglePanelContentContainerProps;
};

/** A serialized panel-content-container description consumed by modal and sidebar panel containers. */
export type PanelContentContainer =
  | PanelAccordeonContentContainer
  | PanelTabbedContentContainer
  | SinglePanelContentContainer;

/**
 * Builds a direct-content container for modal-style and sidebar panel shorthands.
 */
export function asPanelContainer(panel: Panel): SinglePanelContentContainer {
  return {
    kind: 'panel',
    props: {
      panel
    }
  };
}

/**
 * Renders an accordion-style panel stack.
 */
export function AccordeonPanelContainer({
  panels,
  className,
  defaultExpandedPanelIds = [],
  expandedPanelIds,
  onExpandedPanelIdsChange,
  allowMultipleExpanded = true
}: AccordeonPanelContainerProps) {
  const [currentExpandedPanelIds, setCurrentExpandedPanelIds] = useControlledStringListState(
    expandedPanelIds,
    defaultExpandedPanelIds
  );

  const expandedPanelIdSet = useMemo(
    () => new Set(currentExpandedPanelIds),
    [currentExpandedPanelIds]
  );

  const effectivePanels = useMemo(() => [...panels], [panels]);

  const handleTogglePanel = useCallback(
    (panelId: PanelId) => {
      const nextPanelIds = new Set(allowMultipleExpanded ? currentExpandedPanelIds : []);
      if (nextPanelIds.has(panelId)) {
        nextPanelIds.delete(panelId);
      } else {
        if (!allowMultipleExpanded) {
          nextPanelIds.clear();
        }
        nextPanelIds.add(panelId);
      }

      const next = [...nextPanelIds];
      setCurrentExpandedPanelIds(next);
      onExpandedPanelIdsChange?.(next);
    },
    [allowMultipleExpanded, currentExpandedPanelIds, onExpandedPanelIdsChange]
  );

  return (
    <div className={className} style={ACCORDEON_CONTAINER_STYLE}>
      {effectivePanels.map(panel => {
        const isExpanded = expandedPanelIdSet.has(panel.id);
        const shouldRenderContent = panel.keepMounted || isExpanded;

        return (
          <section key={panel.id} style={ACCORDION_PANEL_STYLE}>
            <button
              type="button"
              style={{
                ...ACCORDION_HEADING_STYLE,
                cursor: panel.disabled ? 'not-allowed' : 'pointer',
                opacity: panel.disabled ? 0.55 : 1
              }}
              disabled={panel.disabled}
              onPointerDown={event => {
                if (panel.disabled) {
                  event.stopPropagation();
                  return;
                }
                event.preventDefault();
                handleTogglePanel(panel.id);
              }}
            >
              <span>{panel.title}</span>
              <span
                style={{
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 160ms ease'
                }}
              >
                ▸
              </span>
            </button>
            <div
              style={{
                ...ACCORDION_CONTENT_STYLE,
                display: isExpanded ? 'block' : 'none'
              }}
            >
              {shouldRenderContent ? (
                <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Renders a tabbed panel switcher.
 */
export function TabbedPanelContainer({
  panels,
  className,
  defaultActivePanelId,
  activePanelId,
  onActivePanelIdChange,
  tabListLayout = 'wrap'
}: TabbedPanelContainerProps) {
  const [currentActivePanelId, setCurrentActivePanelId] = useControlledStringState(
    activePanelId,
    defaultActivePanelId
  );

  const enabledPanels = useMemo(() => panels.filter(panel => !panel.disabled), [panels]);
  const initialActivePanelId = useMemo(() => {
    const isActivePanelEnabled = currentActivePanelId
      ? enabledPanels.some(panel => panel.id === currentActivePanelId)
      : false;
    return isActivePanelEnabled ? currentActivePanelId : enabledPanels[0]?.id;
  }, [currentActivePanelId, enabledPanels]);

  useEffect(() => {
    const shouldSyncActivePanel = currentActivePanelId !== initialActivePanelId;
    if (!shouldSyncActivePanel || !initialActivePanelId) {
      return;
    }

    setCurrentActivePanelId(initialActivePanelId);
    onActivePanelIdChange?.(initialActivePanelId);
  }, [currentActivePanelId, initialActivePanelId, onActivePanelIdChange, setCurrentActivePanelId]);
  return (
    <div className={className} style={TABBED_CONTAINER_STYLE}>
      <div data-panel-tabs="" style={getTabListStyle(tabListLayout)}>
        {panels.map(panel => {
          const isActive = panel.id === initialActivePanelId;
          return (
            <button
              key={panel.id}
              type="button"
              style={{
                ...TAB_BUTTON_STYLE,
                opacity: panel.disabled ? 0.55 : 1,
                backgroundColor: isActive
                  ? 'var(--button-background, rgba(255, 255, 255, 0.96))'
                  : 'transparent',
                borderColor: isActive
                  ? 'var(--menu-border, rgba(148, 163, 184, 0.35))'
                  : 'transparent',
                color: isActive
                  ? 'var(--button-text, rgb(24, 24, 26))'
                  : 'var(--button-icon-idle, rgb(71, 85, 105))',
                boxShadow: isActive ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none'
              }}
              disabled={panel.disabled}
              onPointerDown={event => {
                if (panel.disabled) {
                  event.stopPropagation();
                  return;
                }
                event.preventDefault();
                setCurrentActivePanelId(panel.id);
                onActivePanelIdChange?.(panel.id);
              }}
            >
              {panel.title}
            </button>
          );
        })}
      </div>
      <div style={TAB_PANEL_STYLE}>
        {panels.map(panel => {
          const isActive = panel.id === initialActivePanelId;

          return (
            <div
              key={panel.id}
              aria-hidden={!isActive}
              style={{
                ...TAB_PANEL_CONTENT_STYLE,
                visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none'
              }}
            >
              <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders child panels in a simple vertical column.
 */
export function ColumnPanelContainer({panels, className}: ColumnPanelContainerProps) {
  const effectivePanels = useMemo(() => [...panels], [panels]);

  return (
    <div className={className} style={COLUMN_CONTAINER_STYLE}>
      {effectivePanels.map((panel, panelIndex) => (
        <section
          key={panel.id}
          style={{
            ...COLUMN_PANEL_STYLE,
            borderTop:
              panelIndex > 0 ? '1px solid var(--menu-border, rgba(148, 163, 184, 0.25))' : 'none',
            opacity: panel.disabled ? 0.55 : 1
          }}
        >
          {panel.title ? <header style={COLUMN_PANEL_HEADER_STYLE}>{panel.title}</header> : null}
          <div style={COLUMN_PANEL_CONTENT_STYLE}>
            <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope>
          </div>
        </section>
      ))}
    </div>
  );
}

function SplitterPanelContent({
  panels,
  orientation,
  initialSplit,
  editable,
  minSplit,
  maxSplit,
  onChange,
  onDragStart,
  onDragEnd
}: SplitterPanelContentProps) {
  const effectivePanels = useMemo(() => [...panels], [panels]);
  const firstPanel = effectivePanels[0];
  const remainingPanels = effectivePanels.slice(1);
  const resolvedMinSplit = normalizeSplitBoundary(minSplit, 0);
  const resolvedMaxSplit = Math.max(resolvedMinSplit, normalizeSplitBoundary(maxSplit, 1));
  const [split, setSplit] = useState(() =>
    clampSplit(initialSplit, resolvedMinSplit, resolvedMaxSplit)
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSplit(clampSplit(initialSplit, resolvedMinSplit, resolvedMaxSplit));
  }, [initialSplit, resolvedMinSplit, resolvedMaxSplit]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const updateSplitFromEvent = useCallback(
    (event: PointerEvent | MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const size = orientation === 'horizontal' ? rect.width : rect.height;
      if (size <= 0) {
        return;
      }

      const offset =
        orientation === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
      const nextSplit = clampSplit(offset / size, resolvedMinSplit, resolvedMaxSplit);
      setSplit(nextSplit);
      onChange?.(nextSplit);
    },
    [onChange, orientation, resolvedMinSplit, resolvedMaxSplit]
  );

  if (!firstPanel) {
    return <div style={SPLITTER_CONTAINER_STYLE(orientation)} />;
  }

  if (remainingPanels.length === 0) {
    return (
      <div style={SPLITTER_CONTAINER_STYLE(orientation)}>
        <div style={SPLITTER_PANE_STYLE(1, orientation)}>
          <PanelThemeScope panel={firstPanel}>{firstPanel.content}</PanelThemeScope>
        </div>
      </div>
    );
  }

  const handlePointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!editable) {
      return;
    }
    event.preventDefault();
    dragCleanupRef.current?.();
    const ownerDocument = event.currentTarget.ownerDocument;
    const handlePointerMove = (moveEvent: PointerEvent | MouseEvent) => {
      updateSplitFromEvent(moveEvent);
    };
    const handlePointerEnd = () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      onDragEnd?.();
    };

    ownerDocument.addEventListener('pointermove', handlePointerMove);
    ownerDocument.addEventListener('pointerup', handlePointerEnd);
    ownerDocument.addEventListener('pointercancel', handlePointerEnd);
    dragCleanupRef.current = () => {
      ownerDocument.removeEventListener('pointermove', handlePointerMove);
      ownerDocument.removeEventListener('pointerup', handlePointerEnd);
      ownerDocument.removeEventListener('pointercancel', handlePointerEnd);
    };
    onDragStart?.();
  };

  return (
    <div ref={containerRef} style={SPLITTER_CONTAINER_STYLE(orientation)}>
      <div style={SPLITTER_PANE_STYLE(split, orientation)}>
        <PanelThemeScope panel={firstPanel}>{firstPanel.content}</PanelThemeScope>
      </div>
      <div
        data-panel-splitter=""
        role="separator"
        aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(resolvedMinSplit * 100)}
        aria-valuemax={Math.round(resolvedMaxSplit * 100)}
        aria-valuenow={Math.round(split * 100)}
        style={SPLITTER_HANDLE_STYLE(orientation, editable)}
        onPointerDown={handlePointerDown}
      />
      <div style={SPLITTER_PANE_STYLE(1 - split, orientation)}>
        <ColumnPanelContainer panels={remainingPanels} />
      </div>
    </div>
  );
}

/**
 * Renders the requested container based on descriptor kind.
 */
export function PanelContentRenderer({container}: {container: PanelContentContainer}) {
  if (container.kind === 'accordeon') {
    return <AccordeonPanelContainer {...container.props} />;
  }
  if (container.kind === 'panel') {
    return (
      <div className={container.props.className}>
        <PanelThemeScope panel={container.props.panel}>
          {container.props.panel.content}
        </PanelThemeScope>
      </div>
    );
  }
  return <TabbedPanelContainer {...container.props} />;
}

const PanelThemeModeContext = createContext<PanelThemeMode | undefined>(undefined);

/**
 * Returns the effective light/dark theme mode for the current panel subtree.
 */
export function useEffectivePanelThemeMode(): PanelThemeMode {
  return useContext(PanelThemeModeContext) ?? 'light';
}

/**
 * Applies a panel-level theme override and exposes the resolved mode to descendants.
 */
function PanelThemeScope({panel, children}: {panel: Panel; children: ComponentChildren}) {
  const inheritedMode = useContext(PanelThemeModeContext);
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const [rootMode, setRootMode] = useState<PanelThemeMode>('light');
  const parentMode = inheritedMode ?? rootMode;
  const resolvedMode = resolvePanelThemeMode(parentMode, panel.theme);

  useLayoutEffect(() => {
    if (!inheritedMode) {
      const hostElement = hostElementRef.current;
      if (!hostElement) {
        return undefined;
      }
      const parentHostElement =
        hostElement.parentElement instanceof HTMLElement ? hostElement.parentElement : hostElement;

      const updateRootMode = () => {
        const inferredMode = inferPanelThemeMode(parentHostElement);
        setRootMode(previousMode => (previousMode === inferredMode ? previousMode : inferredMode));
      };

      updateRootMode();

      const themedContainer = parentHostElement.closest('.deck-panel-container');
      const mutationObserver = new MutationObserver(() => {
        updateRootMode();
      });

      mutationObserver.observe(parentHostElement, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });

      if (themedContainer && themedContainer !== parentHostElement) {
        mutationObserver.observe(themedContainer, {
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      }

      return () => {
        mutationObserver.disconnect();
      };
    }

    return undefined;
  }, [inheritedMode]);

  return (
    <PanelThemeModeContext.Provider value={resolvedMode}>
      <div
        ref={hostElementRef}
        data-panel-theme-mode={resolvedMode}
        style={getPanelThemeScopeStyle(resolvedMode)}
      >
        {children}
      </div>
    </PanelThemeModeContext.Provider>
  );
}

/**
 * Resolves one local panel theme override against its parent effective mode.
 */
function resolvePanelThemeMode(
  parentMode: PanelThemeMode,
  theme: PanelTheme | undefined
): PanelThemeMode {
  if (theme === 'dark') {
    return 'dark';
  }
  if (theme === 'light') {
    return 'light';
  }
  if (theme === 'invert') {
    return parentMode === 'dark' ? 'light' : 'dark';
  }

  return parentMode;
}

/**
 * Builds the inline CSS variable scope for one resolved panel theme mode.
 */
function getPanelThemeScopeStyle(mode: PanelThemeMode): JSX.CSSProperties {
  const themeVariables = mode === 'dark' ? PANEL_THEME_DARK : PANEL_THEME_LIGHT;
  return {...themeVariables} as JSX.CSSProperties;
}

/**
 * Infers the surrounding panel theme mode from resolved CSS variables.
 */
function inferPanelThemeMode(hostElement: HTMLElement): PanelThemeMode {
  const ownerWindow = hostElement.ownerDocument.defaultView;
  if (!ownerWindow) {
    return 'light';
  }

  const computedStyle = ownerWindow.getComputedStyle(hostElement);
  const menuBackground = computedStyle.getPropertyValue('--menu-background').trim();
  const parsedColor = parseThemeColor(menuBackground);
  if (!parsedColor) {
    return 'light';
  }

  return getRelativeLuminance(parsedColor) < 0.5 ? 'dark' : 'light';
}

/**
 * Parses a CSS rgb/rgba/hex color string into numeric channels.
 */
function parseThemeColor(value: string): [number, number, number] | null {
  if (!value) {
    return null;
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16)
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      ];
    }
    return null;
  }

  const channelMatches = value.match(/[\d.]+/g);
  if (!channelMatches || channelMatches.length < 3) {
    return null;
  }

  return [Number(channelMatches[0]), Number(channelMatches[1]), Number(channelMatches[2])];
}

/**
 * Computes relative luminance for an RGB color.
 */
function getRelativeLuminance([red, green, blue]: [number, number, number]): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

/**
 * Keeps local string-state in sync with controlled/uncontrolled props.
 */
function useControlledStringState(
  controlledValue?: PanelId,
  defaultValue?: PanelId
): [PanelId | undefined, (next: PanelId | undefined) => void] {
  const [internalValue, setInternalValue] = useState<PanelId | undefined>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const resolvedValue = isControlled ? controlledValue : internalValue;

  useEffect(() => {
    if (!isControlled) {
      return;
    }
    setInternalValue(controlledValue);
  }, [isControlled, controlledValue]);

  const setValue = useCallback(
    (next: PanelId | undefined) => {
      if (!isControlled) {
        setInternalValue(next);
      }
    },
    [isControlled]
  );

  return [resolvedValue, setValue];
}

/**
 * Renders a Markdown document into a safe built-in subset of block elements.
 */
/* eslint-disable max-statements, no-continue */
function renderMarkdownBlocks(markdown: string): JSX.Element[] {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n');
  const lines = normalizedMarkdown.split('\n');
  const blocks: JSX.Element[] = [];
  const paragraphLines: string[] = [];
  const unorderedListItems: string[] = [];
  const orderedListItems: string[] = [];
  let fencedCodeLines: string[] | undefined;
  let blockIndex = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    const paragraphText = paragraphLines.join(' ');
    const currentBlockKey = `paragraph-${blockIndex++}`;
    blocks.push(
      <p key={currentBlockKey} style={MARKDOWN_PARAGRAPH_STYLE}>
        {renderInlineMarkdown(paragraphText, currentBlockKey)}
      </p>
    );
    paragraphLines.length = 0;
  };

  const flushUnorderedList = () => {
    if (unorderedListItems.length === 0) {
      return;
    }

    const currentBlockIndex = blockIndex++;
    blocks.push(
      <ul key={`unordered-list-${currentBlockIndex}`} style={MARKDOWN_LIST_STYLE}>
        {unorderedListItems.map((item, itemIndex) => (
          <li
            key={`unordered-item-${currentBlockIndex}-${itemIndex}`}
            style={MARKDOWN_LIST_ITEM_STYLE}
          >
            {renderInlineMarkdown(item, `unordered-item-${currentBlockIndex}-${itemIndex}`)}
          </li>
        ))}
      </ul>
    );
    unorderedListItems.length = 0;
  };

  const flushOrderedList = () => {
    if (orderedListItems.length === 0) {
      return;
    }

    const currentBlockIndex = blockIndex++;
    blocks.push(
      <ol key={`ordered-list-${currentBlockIndex}`} style={MARKDOWN_LIST_STYLE}>
        {orderedListItems.map((item, itemIndex) => (
          <li
            key={`ordered-item-${currentBlockIndex}-${itemIndex}`}
            style={MARKDOWN_LIST_ITEM_STYLE}
          >
            {renderInlineMarkdown(item, `ordered-item-${currentBlockIndex}-${itemIndex}`)}
          </li>
        ))}
      </ol>
    );
    orderedListItems.length = 0;
  };

  const flushFencedCodeBlock = () => {
    if (fencedCodeLines === undefined) {
      return;
    }

    blocks.push(
      <pre key={`code-${blockIndex++}`} style={MARKDOWN_CODE_BLOCK_STYLE}>
        <code>{fencedCodeLines.join('\n')}</code>
      </pre>
    );
    fencedCodeLines = undefined;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (fencedCodeLines !== undefined) {
      if (trimmedLine.startsWith('```')) {
        flushFencedCodeBlock();
      } else {
        fencedCodeLines.push(line);
      }
      continue;
    }

    if (trimmedLine.startsWith('```')) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
      fencedCodeLines = [];
      continue;
    }

    if (trimmedLine.length === 0) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
      continue;
    }

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();

      const headingLevel = headingMatch[1].length;
      const headingText = headingMatch[2];
      const HeadingTag = `h${headingLevel}` as keyof JSX.IntrinsicElements;
      const currentBlockKey = `heading-${blockIndex++}`;
      blocks.push(
        <HeadingTag key={currentBlockKey} style={getMarkdownHeadingStyle(headingLevel)}>
          {renderInlineMarkdown(headingText, currentBlockKey)}
        </HeadingTag>
      );
      continue;
    }

    const unorderedListMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (unorderedListMatch) {
      flushParagraph();
      flushOrderedList();
      unorderedListItems.push(unorderedListMatch[1]);
      continue;
    }

    const orderedListMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
    if (orderedListMatch) {
      flushParagraph();
      flushUnorderedList();
      orderedListItems.push(orderedListMatch[1]);
      continue;
    }

    paragraphLines.push(trimmedLine);
  }

  flushParagraph();
  flushUnorderedList();
  flushOrderedList();
  flushFencedCodeBlock();

  return blocks;
}

/**
 * Renders a minimal inline Markdown subset into safe text and inline elements.
 */
// eslint-disable-next-line complexity
function renderInlineMarkdown(source: string, keyPrefix: string): ComponentChildren[] {
  const inlineTokenPattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  const children: ComponentChildren[] = [];
  let match: RegExpExecArray | null;
  let previousIndex = 0;
  let tokenIndex = 0;

  for (match = inlineTokenPattern.exec(source); match; match = inlineTokenPattern.exec(source)) {
    if (match.index > previousIndex) {
      children.push(source.slice(previousIndex, match.index));
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      children.push(
        <a
          key={`${keyPrefix}-link-${tokenIndex}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          style={MARKDOWN_LINK_STYLE}
        >
          {match[2]}
        </a>
      );
    } else if (match[4] !== undefined) {
      children.push(
        <code key={`${keyPrefix}-code-${tokenIndex}`} style={MARKDOWN_INLINE_CODE_STYLE}>
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      children.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`}>{match[5] ?? match[6]}</strong>
      );
    } else if (match[7] !== undefined || match[8] !== undefined) {
      children.push(<em key={`${keyPrefix}-em-${tokenIndex}`}>{match[7] ?? match[8]}</em>);
    }

    previousIndex = match.index + match[0].length;
    tokenIndex += 1;
  }

  if (previousIndex < source.length) {
    children.push(source.slice(previousIndex));
  }

  if (children.length === 0) {
    return [source];
  }

  return children;
}
/* eslint-enable max-statements, no-continue */

/**
 * Returns the heading style for one Markdown heading level.
 */
function getMarkdownHeadingStyle(level: number): JSX.CSSProperties {
  if (level === 1) {
    return MARKDOWN_HEADING_1_STYLE;
  }
  if (level === 2) {
    return MARKDOWN_HEADING_2_STYLE;
  }
  if (level === 3) {
    return MARKDOWN_HEADING_3_STYLE;
  }

  return MARKDOWN_HEADING_4_TO_6_STYLE;
}

/**
 * Normalizes panel id collections for deterministic membership checks and stable state.
 */
function normalizePanelIds(values: ReadonlyArray<PanelId> | undefined): ReadonlyArray<PanelId> {
  if (!values || values.length === 0) {
    return [];
  }
  const deduped: PanelId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = String(value);
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(trimmed);
    }
  }
  return deduped;
}

/**
 * Keeps local list state in sync with controlled/uncontrolled props.
 */
function useControlledStringListState(
  controlledValue?: ReadonlyArray<PanelId>,
  defaultValue?: ReadonlyArray<PanelId>
): [ReadonlyArray<PanelId>, (next: ReadonlyArray<PanelId>) => void] {
  const [internalValue, setInternalValue] = useState<ReadonlyArray<PanelId>>(() =>
    normalizePanelIds(controlledValue ?? defaultValue)
  );
  const isControlled = controlledValue !== undefined;
  const resolvedValue = isControlled ? normalizePanelIds(controlledValue) : internalValue;

  useEffect(() => {
    if (!isControlled) {
      return;
    }
    setInternalValue(normalizePanelIds(controlledValue));
  }, [isControlled, controlledValue]);

  const setValue = useCallback(
    (next: ReadonlyArray<PanelId>) => {
      if (!isControlled) {
        setInternalValue(normalizePanelIds(next));
      }
    },
    [isControlled]
  );

  return [resolvedValue, setValue];
}

/**
 * Shared accordion/tab layout styles.
 */
const ACCORDEON_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const ACCORDION_PANEL_STYLE: JSX.CSSProperties = {
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  overflow: 'hidden'
};

const ACCORDION_HEADING_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: '0',
  margin: '0',
  padding: '10px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  backgroundColor: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: 1.2,
  fontWeight: 700
};

const ACCORDION_CONTENT_STYLE: JSX.CSSProperties = {
  padding: '8px 10px 10px 12px',
  borderTop: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.25)))',
  backgroundColor: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))'
};

const TABBED_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: '220px',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  overflow: 'hidden',
  backgroundColor: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))'
};

function getTabListStyle(tabListLayout: 'wrap' | 'scroll'): JSX.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: tabListLayout === 'wrap' ? 'wrap' : 'nowrap',
    gap: '4px',
    overflowX: tabListLayout === 'scroll' ? 'auto' : 'hidden',
    overflowY: 'hidden',
    background:
      'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
    padding: '4px 6px',
    borderBottom: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.2)))',
    position: 'sticky',
    top: 0,
    zIndex: 1
  };
}

const TAB_BUTTON_STYLE: JSX.CSSProperties = {
  flex: '0 0 auto',
  border: '1px solid transparent',
  borderRadius: '4px',
  margin: 0,
  padding: '4px 8px',
  fontSize: '12px',
  fontWeight: 600,
  lineHeight: 1.25,
  cursor: 'pointer',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  backgroundColor: 'rgba(255, 255, 255, 0.35)',
  whiteSpace: 'nowrap',
  transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease'
};

const TAB_PANEL_STYLE: JSX.CSSProperties = {
  display: 'grid',
  alignItems: 'start',
  padding: '10px',
  overflow: 'auto'
};

const TAB_PANEL_CONTENT_STYLE: JSX.CSSProperties = {
  gridArea: '1 / 1',
  minWidth: 0
};

const COLUMN_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '0'
};

const COLUMN_PANEL_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '10px',
  padding: '12px 0'
};

const COLUMN_PANEL_HEADER_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--button-text, currentColor)',
  padding: '0 2px'
};

const COLUMN_PANEL_CONTENT_STYLE: JSX.CSSProperties = {
  minWidth: 0
};

const SPLITTER_HANDLE_SIZE_PX = 8;

function SPLITTER_CONTAINER_STYLE(orientation: SplitterPanelOrientation): JSX.CSSProperties {
  return {
    display: 'flex',
    flexDirection: orientation === 'horizontal' ? 'row' : 'column',
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    color: 'var(--menu-text, rgb(24, 24, 26))'
  };
}

function SPLITTER_PANE_STYLE(
  split: number,
  orientation: SplitterPanelOrientation
): JSX.CSSProperties {
  const basis = `${split * 100}%`;
  return {
    flex: `0 0 ${basis}`,
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    padding: '0 8px',
    boxSizing: 'border-box'
  };
}

function SPLITTER_HANDLE_STYLE(
  orientation: SplitterPanelOrientation,
  editable: boolean
): JSX.CSSProperties {
  return {
    flex: `0 0 ${SPLITTER_HANDLE_SIZE_PX}px`,
    alignSelf: 'stretch',
    cursor: editable ? (orientation === 'horizontal' ? 'col-resize' : 'row-resize') : 'default',
    background:
      'linear-gradient(var(--menu-border, rgba(148, 163, 184, 0.35)), var(--menu-border, rgba(148, 163, 184, 0.35))) center / 1px 100% no-repeat',
    opacity: editable ? 1 : 0.55,
    touchAction: 'none'
  };
}

function normalizeSplitBoundary(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function clampSplit(value: number, minSplit: number, maxSplit: number): number {
  const normalizedValue = normalizeSplitBoundary(value, 0.5);
  return Math.min(Math.max(normalizedValue, minSplit), maxSplit);
}

const MARKDOWN_PANEL_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '13px',
  lineHeight: '1.5'
};

const MARKDOWN_PARAGRAPH_STYLE: JSX.CSSProperties = {
  margin: '0'
};

const MARKDOWN_LIST_STYLE: JSX.CSSProperties = {
  margin: '0',
  paddingLeft: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px'
};

const MARKDOWN_LIST_ITEM_STYLE: JSX.CSSProperties = {
  margin: '0'
};

const MARKDOWN_CODE_BLOCK_STYLE: JSX.CSSProperties = {
  margin: '0',
  padding: '10px 12px',
  borderRadius: '8px',
  overflowX: 'auto',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.2))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '1.45'
};

const MARKDOWN_INLINE_CODE_STYLE: JSX.CSSProperties = {
  padding: '1px 5px',
  borderRadius: '4px',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.2))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px'
};

const MARKDOWN_LINK_STYLE: JSX.CSSProperties = {
  color: 'var(--button-text, rgb(29, 78, 216))'
};

const MARKDOWN_HEADING_1_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: '20px',
  fontWeight: 700,
  lineHeight: '1.25'
};

const MARKDOWN_HEADING_2_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: '17px',
  fontWeight: 700,
  lineHeight: '1.3'
};

const MARKDOWN_HEADING_3_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: '15px',
  fontWeight: 700,
  lineHeight: '1.35'
};

const MARKDOWN_HEADING_4_TO_6_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: '13px',
  fontWeight: 700,
  lineHeight: '1.4'
};
