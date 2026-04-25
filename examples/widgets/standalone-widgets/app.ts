// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {DarkTheme, LightTheme} from '@deck.gl/widgets';
import {h, render} from 'preact';
import {
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  TabbedPanel,
  ToastWidget,
  ToolbarWidget,
  WidgetContainerRenderer,
  WidgetHost,
  asPanelContainer,
  toastManager
} from '../../../modules/panels/src';

import '@deck.gl/widgets/stylesheet.css';

type PaletteName = 'lagoon' | 'sunset' | 'mono';
type FocusName = 'overview' | 'alerts' | 'shipments';

type ExampleState = {
  darkMode: boolean;
  palette: PaletteName;
  focus: FocusName;
};

const PALETTES: Record<
  PaletteName,
  {
    background: string;
    halo: string;
    accent: string;
    muted: string;
  }
> = {
  lagoon: {
    background:
      'radial-gradient(circle at top, rgba(103, 232, 249, 0.28), transparent 36%), linear-gradient(180deg, #e0f2fe 0%, #dbeafe 48%, #e0fbff 100%)',
    halo: 'rgba(6, 182, 212, 0.22)',
    accent: '#0f766e',
    muted: '#155e75'
  },
  sunset: {
    background:
      'radial-gradient(circle at top, rgba(251, 146, 60, 0.28), transparent 34%), linear-gradient(180deg, #fff7ed 0%, #ffedd5 50%, #fee2e2 100%)',
    halo: 'rgba(234, 88, 12, 0.22)',
    accent: '#c2410c',
    muted: '#9a3412'
  },
  mono: {
    background:
      'radial-gradient(circle at top, rgba(113, 113, 122, 0.2), transparent 36%), linear-gradient(180deg, #f5f5f5 0%, #e5e7eb 46%, #d4d4d8 100%)',
    halo: 'rgba(63, 63, 70, 0.2)',
    accent: '#27272a',
    muted: '#52525b'
  }
};

const FOCUS_LABELS: Record<FocusName, string> = {
  overview: 'Overview',
  alerts: 'Alerts',
  shipments: 'Shipments'
};

const FOCUS_NOTES: Record<FocusName, string> = {
  overview: 'Traffic and queue depth are stable across the full route.',
  alerts: 'Three stops need attention before the next dispatch window.',
  shipments: 'Southbound shipments are trending ahead of schedule.'
};

const DOT_LAYOUT: Record<
  FocusName,
  Array<{label: string; left: string; top: string; size: number}>
> = {
  overview: [
    {label: 'North', left: '20%', top: '22%', size: 18},
    {label: 'East', left: '66%', top: '26%', size: 16},
    {label: 'South', left: '40%', top: '64%', size: 20},
    {label: 'West', left: '74%', top: '58%', size: 14}
  ],
  alerts: [
    {label: 'Dock 2', left: '28%', top: '28%', size: 24},
    {label: 'Dock 5', left: '58%', top: '34%', size: 18},
    {label: 'Gate 1', left: '70%', top: '64%', size: 20}
  ],
  shipments: [
    {label: 'A17', left: '24%', top: '26%', size: 16},
    {label: 'B04', left: '48%', top: '36%', size: 18},
    {label: 'C12', left: '64%', top: '54%', size: 22},
    {label: 'D03', left: '38%', top: '70%', size: 14}
  ]
};

export function mountStandaloneWidgetsExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const sceneElement = container.ownerDocument.createElement('div');
  const panelElement = container.ownerDocument.createElement('div');
  const footerElement = container.ownerDocument.createElement('div');

  rootElement.append(sceneElement, panelElement, footerElement);
  container.replaceChildren(rootElement);

  applyElementStyle(rootElement, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    isolation: 'isolate',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
  });

  applyElementStyle(sceneElement, {
    position: 'absolute',
    inset: '0'
  });

  applyElementStyle(panelElement, {
    position: 'absolute',
    top: '20px',
    left: '20px',
    width: 'min(360px, calc(100% - 40px))',
    maxHeight: 'calc(100% - 80px)',
    overflow: 'auto',
    pointerEvents: 'auto'
  });

  applyElementStyle(footerElement, {
    position: 'absolute',
    left: '20px',
    right: '20px',
    bottom: '20px',
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0',
    color: 'rgba(15, 23, 42, 0.72)'
  });

  const host = new WidgetHost({parentElement: rootElement});
  const state: ExampleState = {
    darkMode: false,
    palette: 'lagoon',
    focus: 'overview'
  };

  const toolbarWidget = new ToolbarWidget({
    id: 'standalone-toolbar',
    placement: 'bottom-left',
    items: buildToolbarItems(state, sync)
  });

  const toastWidget = new ToastWidget({
    id: 'standalone-toast',
    placement: 'bottom-right',
    showBorder: true
  });

  host.setProps({widgets: [toolbarWidget, toastWidget]});
  sync();

  return () => {
    render(null, panelElement);
    host.finalize();
    container.replaceChildren();
  };

  function sync() {
    const palette = PALETTES[state.palette];
    const themeVariables = state.darkMode ? DarkTheme : LightTheme;

    applyElementStyle(rootElement, {
      ...themeVariables,
      background: palette.background
    });

    footerElement.textContent = `No Deck instance. Shared widget classes. DOM host only.`;
    footerElement.style.color = state.darkMode
      ? 'rgba(226, 232, 240, 0.76)'
      : 'rgba(15, 23, 42, 0.72)';

    renderScene(sceneElement, state);
    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(buildDashboardPanel(state, sync))
      }),
      panelElement
    );

    toolbarWidget.setProps({
      items: buildToolbarItems(state, sync)
    });
  }

  function buildToolbarItems(currentState: ExampleState, rerender: () => void) {
    return [
      {
        kind: 'toggle-group' as const,
        id: 'focus',
        label: 'Focus',
        selectedId: currentState.focus,
        options: [
          {id: 'overview', label: 'Overview'},
          {id: 'alerts', label: 'Alerts'},
          {id: 'shipments', label: 'Shipments'}
        ],
        onSelect: (focusId: string) => {
          currentState.focus = focusId as FocusName;
          rerender();
        }
      },
      {
        kind: 'action' as const,
        id: 'theme',
        label: currentState.darkMode ? 'Light mode' : 'Dark mode',
        active: currentState.darkMode,
        onClick: () => {
          currentState.darkMode = !currentState.darkMode;
          rerender();
        }
      },
      {
        kind: 'action' as const,
        id: 'notify',
        label: 'Notify',
        onClick: () => {
          toastManager.toast({
            type: 'info',
            title: FOCUS_LABELS[currentState.focus],
            message: FOCUS_NOTES[currentState.focus]
          });
        }
      },
      {
        kind: 'badge' as const,
        id: 'mode',
        label: `${FOCUS_LABELS[currentState.focus]} / ${currentState.palette}`
      }
    ];
  }
}

function buildDashboardPanel(state: ExampleState, sync: () => void) {
  return new ColumnPanel({
    id: 'standalone-dashboard',
    title: 'Standalone panels',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary-panel',
        title: 'Summary',
        markdown: [
          `**Focus:** ${FOCUS_LABELS[state.focus]}`,
          '',
          `**Palette:** ${state.palette}`,
          '',
          `**Theme:** ${state.darkMode ? 'Dark' : 'Light'}`,
          '',
          FOCUS_NOTES[state.focus]
        ].join('\n')
      }),
      palette: new CustomPanel({
        id: 'palette-panel',
        title: 'Palette',
        onRenderHTML: (rootElement) => renderPaletteControls(rootElement, state, sync)
      }),
      details: new TabbedPanel({
        id: 'details-tabs',
        title: 'Details',
        panels: {
          overview: new MarkdownPanel({
            id: 'overview-tab',
            title: 'Overview',
            markdown: [
              `The host is a plain \`HTMLElement\` wired through \`WidgetHost\`.`,
              '',
              `Current focus is **${FOCUS_LABELS[state.focus]}** with the **${state.palette}** palette.`,
              '',
              `The panel model is rendered directly through \`WidgetContainerRenderer\` outside deck.gl.`
            ].join('\n')
          }),
          structure: new MarkdownPanel({
            id: 'structure-tab',
            title: 'Composition',
            markdown: [
              `- \`WidgetHost\` mounts toolbar and toast widgets`,
              `- \`ColumnPanel\` groups reusable panel content`,
              `- \`TabbedPanel\` still works without a Deck instance`,
              `- toolbar callbacks update local app state and trigger re-rendering`
            ].join('\n')
          })
        }
      })
    }
  });
}

function renderPaletteControls(rootElement: HTMLElement, state: ExampleState, sync: () => void) {
  const document = rootElement.ownerDocument;
  const wrapper = document.createElement('div');
  applyElementStyle(wrapper, {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  });

  const description = document.createElement('div');
  description.textContent = 'Pick a palette for the standalone scene.';
  applyElementStyle(description, {
    fontSize: '13px',
    lineHeight: '1.4',
    color: 'var(--button-text, currentColor)'
  });

  const buttonRow = document.createElement('div');
  applyElementStyle(buttonRow, {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  });

  for (const paletteName of Object.keys(PALETTES) as PaletteName[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = paletteName;
    const isActive = state.palette === paletteName;
    applyElementStyle(button, {
      border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))',
      borderRadius: '8px',
      padding: '8px 10px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '700',
      background: isActive ? 'var(--button-background, rgba(255,255,255,0.96))' : 'transparent',
      color: 'var(--button-text, currentColor)',
      boxShadow: isActive ? 'var(--button-shadow)' : 'none'
    });
    button.onclick = () => {
      state.palette = paletteName;
      sync();
    };
    buttonRow.append(button);
  }

  wrapper.append(description, buttonRow);
  rootElement.replaceChildren(wrapper);

  return () => {
    for (const button of buttonRow.querySelectorAll('button')) {
      button.onclick = null;
    }
  };
}

function renderScene(sceneElement: HTMLElement, state: ExampleState) {
  const document = sceneElement.ownerDocument;
  const palette = PALETTES[state.palette];
  const wrapper = document.createElement('div');
  const title = document.createElement('div');
  const subtitle = document.createElement('div');
  const stage = document.createElement('div');

  applyElementStyle(wrapper, {
    position: 'absolute',
    inset: '0'
  });

  applyElementStyle(title, {
    position: 'absolute',
    left: '24px',
    top: '24px',
    maxWidth: 'min(52vw, 520px)',
    fontSize: 'clamp(28px, 4vw, 48px)',
    lineHeight: '1.02',
    fontWeight: '800',
    color: palette.accent
  });
  title.textContent = 'Standalone widgets over plain HTML';

  applyElementStyle(subtitle, {
    position: 'absolute',
    left: '24px',
    top: '86px',
    maxWidth: 'min(42vw, 460px)',
    fontSize: '15px',
    lineHeight: '1.45',
    color: palette.muted
  });
  subtitle.textContent = FOCUS_NOTES[state.focus];

  applyElementStyle(stage, {
    position: 'absolute',
    inset: '0'
  });

  for (const dot of DOT_LAYOUT[state.focus]) {
    const dotElement = document.createElement('div');
    const labelElement = document.createElement('div');
    applyElementStyle(dotElement, {
      position: 'absolute',
      left: dot.left,
      top: dot.top,
      width: `${dot.size * 4}px`,
      height: `${dot.size * 4}px`,
      marginLeft: `${-dot.size * 2}px`,
      marginTop: `${-dot.size * 2}px`,
      borderRadius: '999px',
      background: palette.halo,
      boxShadow: `0 0 0 1px ${palette.accent}22 inset`
    });
    applyElementStyle(labelElement, {
      position: 'absolute',
      inset: `${dot.size}px`,
      borderRadius: '999px',
      background: palette.accent,
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: '700'
    });
    labelElement.textContent = dot.label;
    dotElement.append(labelElement);
    stage.append(dotElement);
  }

  wrapper.append(title, subtitle, stage);
  sceneElement.replaceChildren(wrapper);
}

function applyElementStyle(
  element: HTMLElement,
  styles: Partial<CSSStyleDeclaration> | Record<string, string>
) {
  Object.assign(element.style, styles);
}
