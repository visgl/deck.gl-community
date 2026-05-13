/** @jsxImportSource preact */
import {PanelThemeScope} from './panel-theme-scope';

import type {JSX} from 'preact';
import type {Panel, PanelListContainerProps, PanelTheme} from './panel-types';

export type ColumnPanelProps = {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
};

export type ColumnPanelContainerProps = PanelListContainerProps;

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
    this.content = <ColumnPanelContainer panels={panels} />;
  }
}

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
