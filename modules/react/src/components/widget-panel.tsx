// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import {h, render as renderPreact} from 'preact';
import {DarkTheme, LightTheme} from '@deck.gl/widgets';
import {
  WidgetContainerRenderer,
  type WidgetContainer,
  type WidgetPanel as WidgetPanelDefinition
} from '../../../panels/src';

import type {CSSProperties, ReactElement} from 'react';

/**
 * Theme modes supported by the React `WidgetPanel` host.
 */
export type WidgetPanelThemeMode = 'inherit' | 'light' | 'dark';

type WidgetPanelWithPanelProps = {
  /**
   * One panel definition imported from `@deck.gl-community/panels`.
   */
  panel: WidgetPanelDefinition;
  container?: never;
};

type WidgetPanelWithContainerProps = {
  /**
   * One full container definition imported from `@deck.gl-community/panels`.
   */
  container: WidgetContainer;
  panel?: never;
};

/**
 * Props for the React `WidgetPanel` component.
 */
export type WidgetPanelProps = (WidgetPanelWithPanelProps | WidgetPanelWithContainerProps) & {
  /**
   * Theme mode applied to the widget host.
   *
   * Use `inherit` to leave widget CSS variables unset and let outer styles win.
   */
  themeMode?: WidgetPanelThemeMode;
  /**
   * Optional class name applied to the outer React host.
   */
  className?: string;
  /**
   * Optional inline styles applied to the outer React host.
   */
  style?: CSSProperties;
  /**
   * Whether to render a framed widget-style surface around the content.
   * Defaults to `true`.
   */
  framed?: boolean;
};

/**
 * Renders one widget panel or widget container inside a React tree.
 *
 * This is primarily intended for documentation pages, MDX content, and other
 * React surfaces that want to reuse the panel composition model from
 * `@deck.gl-community/panels` without creating a standalone `PanelManager`.
 */
export function WidgetPanel({
  panel,
  container,
  themeMode = 'light',
  className,
  style,
  framed = true
}: WidgetPanelProps): ReactElement {
  const mountElementRef = React.useRef<HTMLDivElement | null>(null);
  const resolvedContainer = React.useMemo<WidgetContainer>(() => {
    if (container) {
      return container;
    }

    return {
      kind: 'column',
      props: {
        panels: [panel]
      }
    };
  }, [container, panel]);

  React.useEffect(() => {
    const mountElement = mountElementRef.current;
    if (!mountElement) {
      return undefined;
    }

    renderPreact(h(WidgetContainerRenderer, {container: resolvedContainer}), mountElement);
    return () => {
      renderPreact(null, mountElement);
    };
  }, [resolvedContainer]);

  return (
    <div
      className={['deck-widget-container', 'deck-react-widget-panel', className]
        .filter(Boolean)
        .join(' ')}
      style={getHostStyle(themeMode, framed, style)}
    >
      <div ref={mountElementRef} />
    </div>
  );
}

function getHostStyle(
  themeMode: WidgetPanelThemeMode,
  framed: boolean,
  style: CSSProperties | undefined
): CSSProperties {
  const themeVariables =
    themeMode === 'dark'
      ? (DarkTheme as CSSProperties)
      : themeMode === 'light'
        ? (LightTheme as CSSProperties)
        : {};

  return {
    ...themeVariables,
    ...(framed ? HOST_FRAME_STYLE : HOST_UNFRAMED_STYLE),
    ...style
  };
}

const HOST_FRAME_STYLE: CSSProperties = {
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: '12px',
  background: 'var(--menu-background, rgba(255, 255, 255, 0.96))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0 18px 40px rgba(15, 23, 42, 0.12))',
  padding: '16px',
  maxWidth: '100%',
  overflow: 'hidden'
};

const HOST_UNFRAMED_STYLE: CSSProperties = {
  maxWidth: '100%'
};
