// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import {
  PANEL_THEME_PRESETS,
  resolvePanelThemeVariables,
  mountPanel,
  type PanelMount,
  type PanelThemePreset,
  type PanelThemeDefinition,
  type Panel as PanelDefinition
} from '@deck.gl-community/panels';

import type {CSSProperties, ReactElement} from 'react';

/**
 * Theme modes supported by the React `Panel` host.
 */
export type PanelHostThemeMode = 'inherit' | 'light' | 'dark';

/**
 * Props for the React `Panel` component.
 */
export type PanelProps = {
  /** One panel definition imported from `@deck.gl-community/panels`. */
  panel: PanelDefinition;
  /**
   * Theme mode applied to the panel host.
   *
   * Use `inherit` to leave panel CSS variables unset and let outer styles win.
   */
  themeMode?: PanelHostThemeMode;
  /** Preset or custom definition from panels. Takes precedence over themeMode. */
  theme?: PanelThemePreset | PanelThemeDefinition | 'inherit';
  /**
   * Optional class name applied to the outer React host.
   */
  className?: string;
  /**
   * Optional inline styles applied to the outer React host.
   */
  style?: CSSProperties;
  /**
   * Whether to render a framed panel surface around the content.
   * Defaults to `true`.
   */
  framed?: boolean;
};

/**
 * Renders one deck-independent panel definition inside a React tree.
 *
 * This is primarily intended for documentation pages, MDX content, and other
 * React surfaces that want to reuse the panel composition model from
 * `@deck.gl-community/panels` without creating a standalone `PanelManager`.
 */
export function Panel({
  panel,
  themeMode = 'light',
  theme,
  className,
  style,
  framed = true
}: PanelProps): ReactElement {
  const mountElementRef = React.useRef<HTMLDivElement | null>(null);

  const panelMountRef = React.useRef<PanelMount | null>(null);
  React.useEffect(() => {
    const element = mountElementRef.current;
    if (!element) return undefined;
    const panelMount = mountPanel(null, element, {showTitle: true});
    panelMountRef.current = panelMount;
    return () => {
      panelMountRef.current = null;
      panelMount.finalize();
    };
  }, []);
  React.useEffect(() => {
    panelMountRef.current?.setPanel(panel);
  });

  return (
    <div
      className={['deck-react-panel', className].filter(Boolean).join(' ')}
      style={getHostStyle(theme ?? themeMode, framed, style)}
    >
      <div ref={mountElementRef} />
    </div>
  );
}

function getHostStyle(
  theme: PanelThemePreset | PanelThemeDefinition | 'inherit',
  framed: boolean,
  style: CSSProperties | undefined
): CSSProperties {
  const themeVariables =
    typeof theme === 'object'
      ? (resolvePanelThemeVariables(theme) as CSSProperties)
      : theme === 'inherit'
        ? {}
        : (PANEL_THEME_PRESETS[theme] as CSSProperties);

  return {
    ...themeVariables,
    ...(framed ? HOST_FRAME_STYLE : HOST_UNFRAMED_STYLE),
    ...style
  };
}

const HOST_FRAME_STYLE: CSSProperties = {
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: 'var(--panel-surface-radius, 12px)',
  background: 'var(--menu-background, rgba(255, 255, 255, 0.96))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0 18px 40px rgba(15, 23, 42, 0.12))',
  padding: 'var(--panel-padding, 16px)',
  maxWidth: '100%',
  overflow: 'hidden'
};

const HOST_UNFRAMED_STYLE: CSSProperties = {
  maxWidth: '100%'
};
