/** @jsxImportSource preact */
import {createContext} from 'preact';
import {useContext, useLayoutEffect, useRef, useState} from 'preact/hooks';

import {
  PANEL_THEME_PRESETS,
  resolvePanelThemeVariables,
  type PanelThemePreset
} from '../lib/panel-theme';

import {ensurePanelStylesheet} from '../lib/panel-styles';

import type {ComponentChildren, JSX} from 'preact';
import type {Panel, PanelTheme, PanelThemeMode} from './panel';

const PanelThemePresetContext = createContext<PanelThemePreset | undefined>(undefined);

/**
 * Returns the effective light/dark theme mode for the current panel subtree.
 */
export function useEffectivePanelThemeMode(): PanelThemeMode {
  return getPanelThemeMode(useContext(PanelThemePresetContext) ?? 'light');
}

/**
 * Applies a panel-level theme override and exposes the resolved mode to descendants.
 */
export function PanelThemeScope({panel, children}: {panel: Panel; children?: ComponentChildren}) {
  const inheritedPreset = useContext(PanelThemePresetContext);
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const [hasHostPreset, setHasHostPreset] = useState(false);
  const [rootPreset, setRootPreset] = useState<PanelThemePreset>('light');
  const parentPreset = inheritedPreset ?? rootPreset;
  const resolvedPreset = resolvePanelThemePreset(parentPreset, panel.theme);

  useLayoutEffect(() => {
    if (hostElementRef.current) {
      ensurePanelStylesheet(hostElementRef.current.ownerDocument);
    }
    if (!inheritedPreset) {
      const hostElement = hostElementRef.current;
      if (!hostElement) {
        return undefined;
      }
      const parentHostElement =
        hostElement.parentElement instanceof HTMLElement ? hostElement.parentElement : hostElement;

      const updateRootPreset = () => {
        const marker = parentHostElement.ownerDocument.defaultView
          ?.getComputedStyle(parentHostElement)
          .getPropertyValue('--panel-preset')
          .trim();
        setHasHostPreset(Boolean(marker && Object.hasOwn(PANEL_THEME_PRESETS, marker)));
        const inferredPreset = inferPanelThemePreset(parentHostElement);
        setRootPreset(previousPreset =>
          previousPreset === inferredPreset ? previousPreset : inferredPreset
        );
      };

      updateRootPreset();

      const mutationObserver = new MutationObserver(() => {
        updateRootPreset();
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
  }, [inheritedPreset]);

  return (
    <PanelThemePresetContext.Provider value={resolvedPreset}>
      <div
        ref={hostElementRef}
        data-panel-theme-mode={getPanelThemeMode(resolvedPreset)}
        data-panel-theme-preset={resolvedPreset}
        style={
          (!panel.theme || panel.theme === 'inherit') && (inheritedPreset || hasHostPreset)
            ? undefined
            : getPanelThemeScopeStyle(resolvedPreset, panel.theme)
        }
      >
        {children}
      </div>
    </PanelThemePresetContext.Provider>
  );
}

function getPanelThemeMode(preset: PanelThemePreset): PanelThemeMode {
  return preset === 'dark' || preset === 'sleek-dark' ? 'dark' : 'light';
}

function resolvePanelThemePreset(
  parentPreset: PanelThemePreset,
  theme: PanelTheme | undefined
): PanelThemePreset {
  if (typeof theme === 'object') {
    return theme.base;
  }
  if (theme && theme !== 'inherit' && theme !== 'invert') {
    return theme;
  }
  if (theme === 'invert') {
    const mode = getPanelThemeMode(parentPreset) === 'dark' ? 'light' : 'dark';
    return parentPreset.startsWith('sleek-') ? `sleek-${mode}` : mode;
  }
  return parentPreset;
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

function getPanelThemeScopeStyle(preset: PanelThemePreset, theme?: PanelTheme): JSX.CSSProperties {
  const themeVariables =
    typeof theme === 'object' ? resolvePanelThemeVariables(theme) : PANEL_THEME_PRESETS[preset];
  return {...themeVariables} as JSX.CSSProperties;
}

function inferPanelThemePreset(hostElement: HTMLElement): PanelThemePreset {
  const ownerWindow = hostElement.ownerDocument.defaultView;
  if (!ownerWindow) {
    return 'light';
  }

  const computedStyle = ownerWindow.getComputedStyle(hostElement);
  const preset = computedStyle.getPropertyValue('--panel-preset').trim();
  if (Object.hasOwn(PANEL_THEME_PRESETS, preset)) {
    return preset as PanelThemePreset;
  }
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
