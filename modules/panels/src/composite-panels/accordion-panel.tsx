/** @jsxImportSource preact */
import {useCallback, useMemo} from 'preact/hooks';

import {useControlledStringListState} from '../panels/panel-state';
import {PanelThemeScope} from '../panels/panel-theme-scope';
import {Panel} from '../panels/panel';
import type {PanelProps} from '../panels/panel';

import type {JSX} from 'preact';
import type {PanelId, PanelListContainerProps, PanelTheme} from '../panels/panel';

/** Props for the composite `AccordionPanel` definition. */
export type AccordionPanelProps = PanelProps & {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
  /** Initially expanded sections when expansion is uncontrolled. */
  defaultExpandedPanelIds?: ReadonlyArray<PanelId>;
  /** Expanded sections when expansion is controlled. */
  expandedPanelIds?: ReadonlyArray<PanelId>;
  /** Called with the requested expanded section ids. */
  onExpandedPanelIdsChange?: (expandedPanelIds: ReadonlyArray<PanelId>) => void;
  /** Whether more than one section may be expanded. Defaults to true. */
  allowMultipleExpanded?: boolean;
};

/** Props for the rendered accordion panel list. */
export type AccordionPanelContainerProps = PanelListContainerProps & {
  defaultExpandedPanelIds?: ReadonlyArray<PanelId>;
  expandedPanelIds?: ReadonlyArray<PanelId>;
  onExpandedPanelIdsChange?: (expandedPanelIds: ReadonlyArray<PanelId>) => void;
  allowMultipleExpanded?: boolean;
};

/** Panel definition that renders child panels as expandable accordion sections. */
export class AccordionPanel extends Panel<AccordionPanelProps> {
  /** Defaults applied before caller props. */
  static defaultProps = {
    ...Panel.defaultProps,
    id: 'accordion-panels',
    title: 'Panels',
    theme: 'inherit'
  } satisfies PanelProps & Partial<AccordionPanelProps>;

  override getChildPanels(): ReadonlyArray<Panel> {
    return this.props.panels;
  }

  /** Renders content from the current public props. */
  override renderContent() {
    const {
      panels,
      defaultExpandedPanelIds,
      expandedPanelIds,
      onExpandedPanelIdsChange,
      allowMultipleExpanded
    } = this.props;
    return (
      <AccordionPanelContainer
        panels={panels}
        defaultExpandedPanelIds={defaultExpandedPanelIds}
        expandedPanelIds={expandedPanelIds}
        onExpandedPanelIdsChange={onExpandedPanelIdsChange}
        allowMultipleExpanded={allowMultipleExpanded}
      />
    );
  }
}

/** Renders ordered panels as an accordion layout. */
export function AccordionPanelContainer({
  panels,
  className,
  defaultExpandedPanelIds = [],
  expandedPanelIds,
  onExpandedPanelIdsChange,
  allowMultipleExpanded = true
}: AccordionPanelContainerProps) {
  const [currentExpandedPanelIds, setCurrentExpandedPanelIds] = useControlledStringListState(
    expandedPanelIds,
    defaultExpandedPanelIds
  );
  const expandedPanelIdSet = useMemo(
    () => new Set(currentExpandedPanelIds),
    [currentExpandedPanelIds]
  );

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
    <div className={className} style={ACCORDION_CONTAINER_STYLE}>
      {panels.map(panel => {
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

const ACCORDION_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--panel-gap, 8px)'
};

const ACCORDION_PANEL_STYLE: JSX.CSSProperties = {
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: 'var(--panel-surface-radius, var(--button-corner-radius, 8px))',
  overflow: 'hidden',
  backgroundColor: 'var(--menu-background, transparent)',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  WebkitBackdropFilter: 'var(--menu-backdrop-filter, unset)'
};

const ACCORDION_HEADING_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: '0',
  margin: '0',
  padding: 'var(--panel-padding, 10px 12px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--panel-gap, 8px)',
  backgroundColor: 'var(--panel-content-background, var(--menu-background, #fff))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: 'var(--panel-font-size, 12px)',
  lineHeight: 1.2,
  fontWeight: 700
};

const ACCORDION_CONTENT_STYLE: JSX.CSSProperties = {
  padding: 'var(--panel-padding, 8px 10px 10px 12px)',
  borderTop: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.25)))',
  backgroundColor: 'var(--panel-content-background, var(--menu-background, #fff))',
  color: 'var(--menu-text, rgb(24, 24, 26))'
};
