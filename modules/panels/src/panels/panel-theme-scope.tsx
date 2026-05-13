/** @jsxImportSource preact */
import {createContext} from 'preact';
import {useContext, useLayoutEffect, useRef, useState} from 'preact/hooks';

import {PANEL_THEME_DARK, PANEL_THEME_LIGHT} from '../lib/panel-theme';

import type {ComponentChildren, JSX} from 'preact';
import type {Panel, PanelTheme, PanelThemeMode} from './panel-types';

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
export function PanelThemeScope({panel, children}: {panel: Panel; children: ComponentChildren}) {
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

      const mutationObserver = new MutationObserver(() => {
        updateRootMode();
      });

      for (const themeHostElement of getThemeHostElements(parentHostElement)) {
        mutationObserver.observe(themeHostElement, {
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

function getThemeHostElements(hostElement: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  let element: HTMLElement | null = hostElement;
  const documentElement = hostElement.ownerDocument.documentElement;

  while (element) {
    elements.push(element);
    if (element === documentElement) {
      break;
    }
    element = element.parentElement;
  }

  return elements;
}

function getPanelThemeScopeStyle(mode: PanelThemeMode): JSX.CSSProperties {
  const themeVariables = mode === 'dark' ? PANEL_THEME_DARK : PANEL_THEME_LIGHT;
  return {...themeVariables} as JSX.CSSProperties;
}

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

function getRelativeLuminance([red, green, blue]: [number, number, number]): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}
