/** @jsxImportSource preact */
import {PanelThemeScope} from '../panels/panel-theme-scope';
import {Panel} from '../panels/panel';

import type {JSX} from 'preact';
import type {PanelListContainerProps, PanelTheme} from '../panels/panel';

/** Props for the composite `ColumnPanel` definition. */
export type ColumnPanelProps = {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
};

/** Props for the rendered vertical panel list. */
export type ColumnPanelContainerProps = PanelListContainerProps;

/** Panel definition that renders child panels in one vertical column. */
export class ColumnPanel extends Panel {
  constructor({
    panels,
    id = 'column-panels',
    title = 'Panels',
    theme = 'inherit'
  }: ColumnPanelProps) {
    super({id, title, theme, content: <ColumnPanelContainer panels={panels} />});
  }
}

/** Renders ordered panels in a vertical column. */
export function ColumnPanelContainer({panels, className}: ColumnPanelContainerProps) {
  return (
    <div className={className} style={COLUMN_CONTAINER_STYLE}>
      {panels.map((panel, panelIndex) => (
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
