// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useMemo, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {h, render as renderPreact} from 'preact';
import {
  _ThemeWidget as ThemeWidget,
  DarkTheme,
  LightTheme
} from '@deck.gl/widgets';
import {
  AccordeonWidgetPanel,
  BoxWidget,
  ColumnWidgetPanel,
  CustomWidgetPanel,
  KeyboardSettingsWidgetPanel,
  MarkdownWidgetPanel,
  ModalWidget,
  SettingsWidgetPanel,
  SidebarWidget,
  TabbedWidgetPanel,
  type KeyboardShortcut,
  type SettingsWidgetSchema,
  type SettingsWidgetState
} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

type PaletteName = 'ember' | 'lagoon' | 'mono';
type FocusCluster = 'all' | 'north' | 'south';

type ExampleSettings = {
  render: {
    opacity: number;
    radiusScale: number;
    showLabels: boolean;
  };
  theme: {
    palette: PaletteName;
  };
  focus: {
    cluster: FocusCluster;
  };
};

type PointDatum = {
  id: string;
  label: string;
  cluster: Exclude<FocusCluster, 'all'>;
  position: [number, number];
  weight: number;
};

const INITIAL_VIEW_STATE: {
  target: [number, number];
  zoom: number;
} = {
  target: [0, 0],
  zoom: 0
};

const VIEW = new OrthographicView({id: 'ortho'});

const POINTS: PointDatum[] = [
  {id: 'aurora', label: 'Aurora', cluster: 'north', position: [-180, 140], weight: 1.4},
  {id: 'comet', label: 'Comet', cluster: 'north', position: [-70, 120], weight: 1.1},
  {id: 'signal', label: 'Signal', cluster: 'north', position: [40, 150], weight: 1.3},
  {id: 'harbor', label: 'Harbor', cluster: 'north', position: [170, 110], weight: 0.95},
  {id: 'echo', label: 'Echo', cluster: 'south', position: [-160, -90], weight: 1.2},
  {id: 'vector', label: 'Vector', cluster: 'south', position: [-20, -130], weight: 1.45},
  {id: 'pulse', label: 'Pulse', cluster: 'south', position: [90, -100], weight: 1.15},
  {id: 'delta', label: 'Delta', cluster: 'south', position: [200, -140], weight: 1.35}
];

const PALETTES: Record<
  PaletteName,
  {
    background: string;
    panel: string;
    text: string;
    subtitle: string;
    pointFill: [number, number, number, number];
    pointFillAlt: [number, number, number, number];
    pointStroke: [number, number, number, number];
    label: [number, number, number, number];
  }
> = {
  ember: {
    background: 'linear-gradient(180deg, #fff7ed 0%, #ffe4d6 48%, #ffd1bf 100%)',
    panel: 'rgba(255, 251, 245, 0.92)',
    text: '#5b2c13',
    subtitle: '#8d4d2d',
    pointFill: [239, 68, 68, 220],
    pointFillAlt: [249, 115, 22, 220],
    pointStroke: [120, 53, 15, 255],
    label: [91, 44, 19, 255]
  },
  lagoon: {
    background: 'linear-gradient(180deg, #ecfeff 0%, #cffafe 45%, #bae6fd 100%)',
    panel: 'rgba(239, 255, 255, 0.92)',
    text: '#164e63',
    subtitle: '#0f766e',
    pointFill: [14, 165, 233, 215],
    pointFillAlt: [20, 184, 166, 220],
    pointStroke: [8, 47, 73, 255],
    label: [8, 47, 73, 255]
  },
  mono: {
    background: 'linear-gradient(180deg, #f5f5f5 0%, #e5e7eb 52%, #d4d4d8 100%)',
    panel: 'rgba(250, 250, 250, 0.92)',
    text: '#18181b',
    subtitle: '#52525b',
    pointFill: [63, 63, 70, 220],
    pointFillAlt: [113, 113, 122, 220],
    pointStroke: [24, 24, 27, 255],
    label: [24, 24, 27, 255]
  }
};

const INITIAL_SETTINGS: ExampleSettings = {
  render: {
    opacity: 0.78,
    radiusScale: 1.15,
    showLabels: true
  },
  theme: {
    palette: 'ember'
  },
  focus: {
    cluster: 'all'
  }
};

const SETTINGS_SCHEMA: SettingsWidgetSchema = {
  title: 'Panel controls',
  sections: [
    {
      id: 'render',
      name: 'Render',
      description: 'Tune how the canvas points are drawn.',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'render.opacity',
          label: 'Opacity',
          type: 'number',
          min: 0.2,
          max: 1,
          step: 0.05,
          description: 'Adjust point alpha for the active layer.'
        },
        {
          name: 'render.radiusScale',
          label: 'Radius scale',
          type: 'number',
          min: 0.4,
          max: 2.4,
          step: 0.1,
          description: 'Scale the rendered point radius.'
        },
        {
          name: 'render.showLabels',
          label: 'Show labels',
          type: 'boolean',
          description: 'Toggle text labels for each point.'
        }
      ]
    },
    {
      id: 'theme',
      name: 'Theme',
      description: 'Swap between a few contrasting visual palettes.',
      settings: [
        {
          name: 'theme.palette',
          label: 'Palette',
          type: 'select',
          options: [
            {label: 'Ember', value: 'ember'},
            {label: 'Lagoon', value: 'lagoon'},
            {label: 'Monochrome', value: 'mono'}
          ],
          description: 'Update the canvas and panel accent colors.'
        }
      ]
    },
    {
      id: 'focus',
      name: 'Focus',
      description: 'Filter the visible point cluster.',
      settings: [
        {
          name: 'focus.cluster',
          label: 'Visible cluster',
          type: 'select',
          options: [
            {label: 'All clusters', value: 'all'},
            {label: 'North only', value: 'north'},
            {label: 'South only', value: 'south'}
          ],
          description: 'Limit the scene to one cluster.'
        }
      ]
    }
  ]
};

const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    key: '/',
    commandKey: true,
    name: 'Show help',
    description: 'Open the shortcut and panel reference.',
    badges: ['Global']
  },
  {
    key: 'ArrowLeft',
    name: 'Shift focus left',
    description: 'Move the selection horizontally.',
    badges: ['Canvas'],
    displayPair: {
      id: 'focus-horizontal',
      position: 'primary',
      description: 'Shift the focus ring horizontally.'
    }
  },
  {
    key: 'ArrowRight',
    name: 'Shift focus right',
    description: 'Move the selection horizontally.',
    badges: ['Canvas'],
    displayPair: {
      id: 'focus-horizontal',
      position: 'secondary',
      description: 'Shift the focus ring horizontally.'
    }
  },
  {
    key: 'f',
    name: 'Toggle sidebar',
    description: 'Show the persistent control rail.',
    badges: ['Panels']
  },
  {
    key: 'm',
    name: 'Open modal',
    description: 'Open the tabbed detail panels.',
    badges: ['Panels']
  }
];

const THEME_WIDGET_ICON_OVERRIDES = `
  .widget-panels-example .deck-widget.deck-widget-theme .deck-widget-button {
    width: var(--button-size, 28px);
    height: var(--button-size, 28px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--button-stroke, rgba(255, 255, 255, 0.3));
    border-radius: var(--button-corner-radius, 8px);
    box-shadow: var(--button-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25));
  }

  .widget-panels-example .deck-widget.deck-widget-theme .deck-widget-button > button {
    width: calc(var(--button-size, 28px) - 2px);
    height: calc(var(--button-size, 28px) - 2px);
    display: block;
    padding: 0;
    border: var(--button-inner-stroke, unset);
    border-radius: calc(var(--button-corner-radius, 8px) - 1px);
    background: var(--button-background, #fff);
    backdrop-filter: var(--button-backdrop-filter, unset);
    cursor: pointer;
  }

  .widget-panels-example .deck-widget.deck-widget-theme .deck-widget-icon {
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--button-icon-idle, #616166);
    background-position: center;
    background-repeat: no-repeat;
    mask-position: center;
    -webkit-mask-position: center;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-size: 70%;
    -webkit-mask-size: 70%;
  }

  .widget-panels-example .deck-widget.deck-widget-theme .deck-widget-button > button:hover .deck-widget-icon {
    background-color: var(--button-icon-hover, rgb(24, 24, 26));
  }

  .widget-panels-example .deck-widget.deck-widget-theme button.deck-widget-sun .deck-widget-icon {
    mask-image: var(
      --icon-sun,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="black" stroke="black"><g><circle cx="12" cy="12" r="6" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>')
    );
    -webkit-mask-image: var(
      --icon-sun,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="black" stroke="black"><g><circle cx="12" cy="12" r="6" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>')
    );
    mask-size: contain;
    -webkit-mask-size: contain;
  }

  .widget-panels-example .deck-widget.deck-widget-theme button.deck-widget-moon .deck-widget-icon {
    mask-image: var(
      --icon-moon,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="black" mask="url(%23moon-mask)" /><mask id="moon-mask" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" fill="white" /><circle cx="24" cy="10" r="12" fill="black"/></mask></svg>')
    );
    -webkit-mask-image: var(
      --icon-moon,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="black" mask="url(%23moon-mask)" /><mask id="moon-mask" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" fill="white" /><circle cx="24" cy="10" r="12" fill="black"/></mask></svg>')
    );
  }
`;

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleSettingsChange = useCallback((nextSettings: SettingsWidgetState) => {
    setSettings(nextSettings as ExampleSettings);
  }, []);

  const palette = PALETTES[settings.theme.palette];

  const filteredPoints = useMemo(() => {
    if (settings.focus.cluster === 'all') {
      return POINTS;
    }

    return POINTS.filter((point) => point.cluster === settings.focus.cluster);
  }, [settings.focus.cluster]);

  const layers = useMemo(() => {
    const circleLayer = new ScatterplotLayer<PointDatum>({
      id: 'widget-panel-points',
      data: filteredPoints,
      getPosition: (point) => point.position,
      getFillColor: (point) => (point.cluster === 'north' ? palette.pointFill : palette.pointFillAlt),
      getLineColor: palette.pointStroke,
      opacity: settings.render.opacity,
      lineWidthMinPixels: 2,
      stroked: true,
      radiusUnits: 'pixels',
      radiusMinPixels: 6,
      radiusMaxPixels: 56,
      getRadius: (point) => point.weight * 20 * settings.render.radiusScale,
      updateTriggers: {
        getFillColor: [palette.pointFill, palette.pointFillAlt],
        getLineColor: [palette.pointStroke],
        getRadius: [settings.render.radiusScale]
      },
      pickable: false
    });

    const labelLayer = settings.render.showLabels
      ? new TextLayer<PointDatum>({
          id: 'widget-panel-labels',
          data: filteredPoints,
          getPosition: (point) => point.position,
          getText: (point) => point.label,
          getColor: palette.label,
          getSize: 14,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          getPixelOffset: (point) => [0, -(point.weight * 20 * settings.render.radiusScale + 8)],
          updateTriggers: {
            getColor: [palette.label],
            getPixelOffset: [settings.render.radiusScale]
          },
          pickable: false
        })
      : null;

    return labelLayer ? [circleLayer, labelLayer] : [circleLayer];
  }, [filteredPoints, palette, settings.render.opacity, settings.render.radiusScale, settings.render.showLabels]);

  const sidebarPanel = useMemo(() => {
    const summary = new MarkdownWidgetPanel({
      id: 'summary',
      title: 'Summary',
      markdown: [
        'This sidebar uses an accordion container with reusable panel definitions.',
        '',
        `- Active palette: **${settings.theme.palette}**`,
        `- Visible cluster: **${settings.focus.cluster}**`,
        `- Labels: **${settings.render.showLabels ? 'on' : 'off'}**`
      ].join('\n')
    });

    return new AccordeonWidgetPanel({
      id: 'sidebar-controls',
      title: 'Sidebar controls',
      panels: {
        summary,
        ...SettingsWidgetPanel.createSectionPanels({
          schema: SETTINGS_SCHEMA,
          settings,
          onSettingsChange: handleSettingsChange
        })
      }
    });
  }, [handleSettingsChange, settings]);

  const modalPanel = useMemo(
    () =>
      new TabbedWidgetPanel({
        id: 'modal-panels',
        title: 'Modal panels',
        panels: {
          overview: new MarkdownWidgetPanel({
            id: 'overview',
            title: 'Overview',
            markdown: [
              'The modal uses the same panel API, but arranged as tabs instead of an accordion.',
              '',
              '- `SidebarWidget` keeps persistent controls within reach.',
              '- `ModalWidget` groups secondary context into a compact dialog.',
              '- `SettingsWidgetPanel` can be reused in either container.'
            ].join('\n')
          }),
          shortcuts: new KeyboardSettingsWidgetPanel({
            keyboardShortcuts: KEYBOARD_SHORTCUTS
          }),
          settings: new SettingsWidgetPanel({
            id: 'modal-settings',
            label: 'Panel controls',
            schema: SETTINGS_SCHEMA,
            settings,
            onSettingsChange: handleSettingsChange
          })
        }
      }),
    [handleSettingsChange, settings]
  );

  const infoBoxPanel = useMemo(
    () =>
      new ColumnWidgetPanel({
        id: 'widget-panels-box',
        title: 'Widget Panels',
        panels: {
          summary: new MarkdownWidgetPanel({
            id: 'summary',
            title: '',
            markdown: [
              'This example pairs a persistent sidebar with a tabbed modal. Both are assembled from the same reusable panel primitives in [@deck.gl-community/widgets](/deck.gl-community/docs/modules/widgets).',
              '',
              'Use the sidebar to edit the live scene. Open the modal to compare a tabbed layout with the same settings and shortcut panels.'
            ].join('\n')
          }),
          actions: new CustomWidgetPanel({
            id: 'actions',
            title: '',
            onRenderHTML: hostElement => {
              renderPreact(
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '10px'
                    }
                  },
                  [
                    h(
                      'button',
                      {
                        key: 'open-modal',
                        type: 'button',
                        onClick: () => setIsModalOpen(true),
                        style: {
                          border: 0,
                          borderRadius: 999,
                          background: 'var(--button-text, rgb(24, 24, 26))',
                          color: 'var(--menu-background, #fff)',
                          padding: '10px 14px',
                          cursor: 'pointer',
                          fontSize: 14,
                          fontWeight: 700
                        }
                      },
                      'Open Modal'
                    ),
                    h(
                      'button',
                      {
                        key: 'toggle-sidebar',
                        type: 'button',
                        onClick: () => setIsSidebarOpen(open => !open),
                        style: {
                          border: '1px solid var(--button-text, rgb(24, 24, 26))',
                          borderRadius: 999,
                          background: 'transparent',
                          color: 'var(--button-text, rgb(24, 24, 26))',
                          padding: '10px 14px',
                          cursor: 'pointer',
                          fontSize: 14,
                          fontWeight: 700
                        }
                      },
                      isSidebarOpen ? 'Close Sidebar' : 'Open Sidebar'
                    )
                  ]
                ),
                hostElement
              );

              return () => renderPreact(null, hostElement);
            }
          })
        }
      }),
    [isSidebarOpen]
  );

  const widgets = useMemo(
    () => [
      new ThemeWidget({
        id: 'widget-theme',
        placement: 'top-left',
        initialThemeMode: 'light',
        lightModeTheme: {
          ...LightTheme,
          // '--button-size': '34px',
          // '--button-background': 'rgba(255, 255, 255, 0.96)',
          // '--button-inner-stroke': '1px solid rgba(91, 44, 19, 0.18)',
          // '--button-shadow': '0 8px 24px rgba(15, 23, 42, 0.16)'
        },
        darkModeTheme: {
          ...DarkTheme,
          // '--button-size': '34px',
          // '--button-background': 'rgba(24, 24, 27, 0.96)',
          // '--button-inner-stroke': '1px solid rgba(255, 255, 255, 0.12)',
          // '--button-shadow': '0 8px 24px rgba(15, 23, 42, 0.28)'
        }
      }),
      new ModalWidget({
        id: 'widget-panel-modal',
        placement: 'top-left',
        title: 'Modal panels',
        triggerLabel: 'Open modal panels',
        panel: modalPanel,
        hideTrigger: true,
        open: isModalOpen,
        onOpenChange: setIsModalOpen
      }),
      new SidebarWidget({
        id: 'widget-panel-sidebar',
        placement: 'top-right',
        side: 'right',
        widthPx: 380,
        title: 'Sidebar panels',
        triggerLabel: 'Toggle sidebar panels',
        panel: sidebarPanel,
        hideTrigger: false,
        button: true,
        open: isSidebarOpen,
        onOpenChange: setIsSidebarOpen
      }),
      new BoxWidget({
        id: 'widget-panel-box',
        placement: 'bottom-left',
        title: 'Widget Panels',
        widthPx: 360,
        panel: infoBoxPanel
      })
    ],
    [infoBoxPanel, isModalOpen, isSidebarOpen, modalPanel, sidebarPanel]
  );

  return (
    <div
      className="widget-panels-example"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: '100%',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 16
      }}
    >
      <style>{THEME_WIDGET_ICON_OVERRIDES}</style>
      <DeckGL
        views={VIEW}
        initialViewState={INITIAL_VIEW_STATE}
        controller={{dragMode: 'pan'}}
        layers={layers}
        widgets={widgets}
        style={{position: 'absolute', inset: '0', background: palette.background}}
      />
    </div>
  );
}
