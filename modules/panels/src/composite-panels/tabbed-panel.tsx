/** @jsxImportSource preact */
import {useEffect, useMemo} from 'preact/hooks';

import {useControlledStringState} from '../panels/panel-state';
import {PanelThemeScope} from '../panels/panel-theme-scope';
import {Panel} from '../panels/panel';

import type {JSX} from 'preact';
import type {PanelId, PanelListContainerProps, PanelTheme} from '../panels/panel';

/** Props for the composite `TabbedPanel` definition. */
export type TabbedPanelProps = {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  tabListLayout?: 'wrap' | 'scroll';
  theme?: PanelTheme;
};

/** Props for the rendered tabbed panel list. */
export type TabbedPanelContainerProps = PanelListContainerProps & {
  defaultActivePanelId?: PanelId;
  activePanelId?: PanelId;
  onActivePanelIdChange?: (activePanelId: PanelId | undefined) => void;
  tabListLayout?: 'wrap' | 'scroll';
};

/** Panel definition that renders child panels behind a tab strip. */
export class TabbedPanel extends Panel {
  constructor({
    panels,
    id = 'tabbed-panels',
    title = 'Panels',
    tabListLayout = 'wrap',
    theme = 'inherit'
  }: TabbedPanelProps) {
    super({
      id,
      title,
      theme,
      content: <TabbedPanelContainer panels={panels} tabListLayout={tabListLayout} />
    });
  }
}

/** Renders ordered panels as a tabbed layout. */
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
