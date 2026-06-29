/** @jsxImportSource preact */
import {useCallback, useMemo} from 'preact/hooks';

import {useControlledStringListState} from '../panels/panel-state';
import {PanelThemeScope} from '../panels/panel-theme-scope';
import {Panel} from '../panels/panel';

import type {JSX} from 'preact';
import type {PanelId, PanelListContainerProps, PanelTheme} from '../panels/panel';

/** Props for the composite `AccordeonPanel` definition. */
export type AccordeonPanelProps = {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
};

/** Props for the rendered accordion panel list. */
export type AccordeonPanelContainerProps = PanelListContainerProps & {
  defaultExpandedPanelIds?: ReadonlyArray<PanelId>;
  expandedPanelIds?: ReadonlyArray<PanelId>;
  onExpandedPanelIdsChange?: (expandedPanelIds: ReadonlyArray<PanelId>) => void;
  allowMultipleExpanded?: boolean;
};

/** Panel definition that renders child panels as expandable accordion sections. */
export class AccordeonPanel extends Panel {
  constructor({
    panels,
    id = 'accordeon-panels',
    title = 'Panels',
    theme = 'inherit'
  }: AccordeonPanelProps) {
    super({id, title, theme, content: <AccordeonPanelContainer panels={panels} />});
  }
}

/** Renders ordered panels as an accordion layout. */
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
