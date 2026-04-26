/** @jsxImportSource preact */
// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Stats} from '@probe.gl/stats';
import {
  AccordeonPanel,
  BinaryDataPanel,
  ColumnPanel,
  CustomPanel,
  KeyboardShortcutsPanel,
  MarkdownPanel,
  PANEL_THEME_DARK,
  PANEL_THEME_LIGHT,
  PanelBox,
  PanelFullScreen,
  PanelManager,
  PanelModal,
  PanelSidebar,
  SettingsPanel,
  StatsPanel,
  TabbedPanel,
  TextEditorPanel,
  ToastWidget,
  ToolbarWidget,
  applyPanelTheme,
  toastManager
} from '../../../modules/panels/src';

import type {KeyboardShortcut, SettingsSchema, SettingsState} from '../../../modules/panels/src';

export type PanelDocsExampleHighlight =
  | 'widget-panels'
  | 'markdown-panel'
  | 'binary-data-panel'
  | 'custom-panel'
  | 'stats-panel'
  | 'settings-panel'
  | 'keyboard-shortcuts-panel'
  | 'text-editor-panel'
  | 'accordeon-panel'
  | 'tabbed-panel'
  | 'column-panel'
  | 'panel-box'
  | 'panel-modal'
  | 'panel-sidebar'
  | 'panel-full-screen';

export function mountPanelDocsExample(
  container: HTMLElement,
  {highlight = 'widget-panels'}: {highlight?: PanelDocsExampleHighlight} = {}
): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const sceneElement = container.ownerDocument.createElement('div');
  const panelElement = container.ownerDocument.createElement('div');
  const overlayElement = container.ownerDocument.createElement('div');
  const themeControlElement = container.ownerDocument.createElement('div');

  rootElement.append(sceneElement, panelElement, overlayElement, themeControlElement);
  container.replaceChildren(rootElement);

  const state = {
    theme: 'light' as 'light' | 'dark'
  };

  applyStyle(rootElement, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    isolation: 'isolate',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
  });
  applyStyle(sceneElement, {position: 'absolute', inset: '0'});
  applyStyle(panelElement, {
    position: 'absolute',
    top: '20px',
    left: '20px',
    width: 'min(420px, calc(100% - 40px))',
    maxHeight: 'calc(100% - 40px)',
    overflow: 'auto',
    pointerEvents: 'auto'
  });
  applyStyle(overlayElement, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none'
  });
  applyStyle(themeControlElement, {
    position: 'absolute',
    top: '20px',
    right: '20px',
    zIndex: '5',
    pointerEvents: 'auto'
  });

  const panelManager = new PanelManager({parentElement: rootElement});
  const toolbar = new ToolbarWidget({
    id: 'panel-docs-toolbar',
    placement: 'bottom-left',
    items: [
      {
        kind: 'action',
        id: 'toast',
        label: 'Toast',
        onClick: () => {
          toastManager.toast({
            type: 'info',
            title: HIGHLIGHT_TITLES[highlight],
            message: 'Standalone panels example'
          });
        }
      }
    ]
  });
  const toast = new ToastWidget({
    id: 'panel-docs-toast',
    placement: 'bottom-right',
    showBorder: true
  });

  sync();

  return () => {
    panelManager.finalize();
    container.replaceChildren();
  };

  function sync() {
    applyPanelTheme(rootElement, state.theme === 'dark' ? PANEL_THEME_DARK : PANEL_THEME_LIGHT);
    applyStyle(rootElement, {
      background:
        state.theme === 'dark'
          ? 'linear-gradient(180deg, #111827 0%, #0f172a 100%)'
          : 'linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%)'
    });

    renderThemeControl(themeControlElement, state.theme, theme => {
      state.theme = theme;
      sync();
    });
    renderScene(sceneElement, highlight, state.theme);
    panelManager.setProps({
      components: [
        ...buildHighlightComponents(highlight, panelElement, overlayElement),
        toolbar,
        toast
      ]
    });
  }
}

const HIGHLIGHT_TITLES: Record<PanelDocsExampleHighlight, string> = {
  'widget-panels': 'Using Panels',
  'markdown-panel': 'MarkdownPanel',
  'binary-data-panel': 'BinaryDataPanel',
  'custom-panel': 'CustomPanel',
  'stats-panel': 'StatsPanel',
  'settings-panel': 'SettingsPanel',
  'keyboard-shortcuts-panel': 'KeyboardShortcutsPanel',
  'text-editor-panel': 'TextEditorPanel',
  'accordeon-panel': 'AccordeonPanel',
  'tabbed-panel': 'TabbedPanel',
  'column-panel': 'ColumnPanel',
  'panel-box': 'PanelBox',
  'panel-modal': 'PanelModal',
  'panel-sidebar': 'PanelSidebar',
  'panel-full-screen': 'PanelFullScreen'
};

const SETTINGS_SCHEMA: SettingsSchema = {
  title: 'Example Settings',
  sections: [
    {
      id: 'display',
      name: 'Display',
      settings: [
        {
          name: 'display.opacity',
          label: 'Opacity',
          type: 'number',
          min: 0.2,
          max: 1,
          step: 0.1
        },
        {
          name: 'display.labels',
          label: 'Show labels',
          type: 'boolean'
        }
      ]
    }
  ]
};

const SETTINGS_STATE: SettingsState = {
  display: {
    opacity: 0.8,
    labels: true
  }
};

const SHORTCUTS: KeyboardShortcut[] = [
  {key: '/', commandKey: true, name: 'Search', description: 'Open search'},
  {key: 'Escape', name: 'Close', description: 'Close the current panel'},
  {key: 't', name: 'Theme', description: 'Toggle theme'}
];

function buildHighlightComponents(
  highlight: PanelDocsExampleHighlight,
  panelElement: HTMLElement,
  overlayElement: HTMLElement
): Array<PanelBox | PanelModal | PanelSidebar | PanelFullScreen> {
  const panel = buildHighlightPanel(highlight);
  const title = HIGHLIGHT_TITLES[highlight];

  switch (highlight) {
    case 'panel-modal':
      return [
        new PanelModal({
          id: 'panel-docs-modal',
          title,
          panel,
          defaultOpen: false,
          hideTrigger: false,
          triggerLabel: 'Open panel',
          _container: overlayElement
        })
      ];

    case 'panel-sidebar':
      return [
        new PanelSidebar({
          id: 'panel-docs-sidebar',
          title,
          panel,
          defaultOpen: false,
          side: 'left',
          widthPx: 360,
          triggerLabel: 'Open sidebar',
          button: true,
          _container: overlayElement
        })
      ];

    case 'panel-full-screen':
      return [
        new PanelFullScreen({
          id: 'panel-docs-full-screen',
          title,
          panel,
          marginPx: 16,
          _container: overlayElement
        })
      ];

    case 'panel-box':
    default:
      return [
        new PanelBox({
          id: 'panel-docs-box',
          _container: panelElement,
          widthPx: 420,
          collapsible: false,
          title,
          panel
        })
      ];
  }
}

// eslint-disable-next-line complexity
function buildHighlightPanel(highlight: PanelDocsExampleHighlight) {
  switch (highlight) {
    case 'markdown-panel':
      return new MarkdownPanel({
        id: 'markdown',
        title: 'Overview',
        markdown: [
          'A small built-in markdown subset.',
          '',
          '- Headings',
          '- Lists',
          '- Inline emphasis'
        ].join('\n')
      });

    case 'binary-data-panel':
      return new BinaryDataPanel({
        id: 'binary-data',
        title: 'Binary Data',
        data: new Uint8Array([
          0x47, 0x4c, 0x42, 0x02, 0x18, 0x00, 0x00, 0x00, 0x4a, 0x53, 0x4f, 0x4e, 0x7b, 0x22, 0x61,
          0x73, 0x73, 0x65, 0x74, 0x22, 0x3a, 0x7b, 0x7d, 0x7d, 0x00, 0x01, 0x02, 0x7e
        ]),
        rowByteLength: 8,
        maxByteLength: 24
      });

    case 'custom-panel':
      return new CustomPanel({
        id: 'custom',
        title: 'Imperative Content',
        onRenderHTML: rootElement => {
          const document = rootElement.ownerDocument;
          const wrapper = document.createElement('div');
          const title = document.createElement('div');
          const bar = document.createElement('div');
          title.textContent = 'Rendered directly into a DOM host';
          applyStyle(title, {
            fontSize: '13px',
            fontWeight: '700',
            color: 'var(--button-text)'
          });
          applyStyle(bar, {
            marginTop: '10px',
            height: '10px',
            borderRadius: '999px',
            background:
              'linear-gradient(90deg, var(--range-decoration-active-color), var(--button-icon-idle))'
          });
          wrapper.append(title, bar);
          rootElement.replaceChildren(wrapper);
        }
      });

    case 'stats-panel': {
      const stats = new Stats({
        id: 'Cache',
        stats: [{name: 'Visible Tiles'}, {name: 'Cached Tiles'}]
      });
      stats.get('Visible Tiles').addCount(12);
      stats.get('Cached Tiles').addCount(36);
      return new StatsPanel({
        id: 'stats',
        title: 'Cache Stats',
        stats,
        labels: {'Visible Tiles': 'Visible', 'Cached Tiles': 'Cached'}
      });
    }

    case 'settings-panel':
      return new SettingsPanel({
        id: 'settings',
        title: 'Settings',
        schema: SETTINGS_SCHEMA,
        settings: SETTINGS_STATE
      });

    case 'keyboard-shortcuts-panel':
      return new KeyboardShortcutsPanel({
        keyboardShortcuts: SHORTCUTS
      });

    case 'text-editor-panel':
      return new TextEditorPanel({
        id: 'editor',
        title: 'Editor',
        value: JSON.stringify({theme: 'light', layers: 3}, null, 2),
        language: 'json'
      });

    case 'accordeon-panel':
      return new AccordeonPanel({
        id: 'accordeon',
        title: 'Sections',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Collapsible sections built from child panels.'
          }),
          details: new MarkdownPanel({
            id: 'details',
            title: 'Details',
            markdown: 'Each section stays composable and reusable.'
          })
        }
      });

    case 'tabbed-panel':
      return new TabbedPanel({
        id: 'tabs',
        title: 'Tabs',
        panels: {
          first: new MarkdownPanel({
            id: 'first',
            title: 'First',
            markdown: 'Tabbed layout keeps one panel active at a time.'
          }),
          second: new MarkdownPanel({
            id: 'second',
            title: 'Second',
            markdown: 'Useful when multiple panels share the same footprint.'
          })
        }
      });

    case 'column-panel':
      return new ColumnPanel({
        id: 'column',
        title: 'Column',
        panels: {
          intro: new MarkdownPanel({
            id: 'intro',
            title: 'Intro',
            markdown: 'Column layouts keep all child panels visible.'
          }),
          notes: new MarkdownPanel({
            id: 'notes',
            title: 'Notes',
            markdown: 'They work well for grouped summaries and sidebars.'
          })
        }
      });

    case 'panel-box':
      return new ColumnPanel({
        id: 'panel-box-content',
        title: 'Details',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: 'Overview',
            markdown: 'A fixed standalone panel container.'
          }),
          notes: new MarkdownPanel({
            id: 'notes',
            title: 'Notes',
            markdown: 'Use `PanelBox` when content should stay visible.'
          })
        }
      });

    case 'panel-modal':
      return new ColumnPanel({
        id: 'panel-modal-content',
        title: 'Details',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: 'Overview',
            markdown: 'A modal panel container for secondary content.'
          }),
          notes: new MarkdownPanel({
            id: 'notes',
            title: 'Notes',
            markdown: 'Use `PanelModal` when content should open on demand.'
          })
        }
      });

    case 'panel-sidebar':
      return new ColumnPanel({
        id: 'panel-sidebar-content',
        title: 'Inspector',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: 'Overview',
            markdown: 'A sidebar panel container for persistent controls.'
          }),
          notes: new MarkdownPanel({
            id: 'notes',
            title: 'Notes',
            markdown: 'Use `PanelSidebar` to keep content reachable while the scene stays visible.'
          })
        }
      });

    case 'panel-full-screen':
      return new ColumnPanel({
        id: 'panel-full-screen-content',
        title: 'Workspace',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: 'Overview',
            markdown: 'A full-screen panel container for focused workflows.'
          }),
          notes: new MarkdownPanel({
            id: 'notes',
            title: 'Notes',
            markdown:
              'Use `PanelFullScreen` when the panel layout should dominate the available space.'
          })
        }
      });

    case 'widget-panels':
    default:
      return new ColumnPanel({
        id: 'overview',
        title: 'Panels',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: 'Overview',
            markdown: 'Panels compose into reusable standalone UI without deck.gl.'
          }),
          tabs: new TabbedPanel({
            id: 'tabs',
            title: 'Composite Panels',
            panels: {
              column: new MarkdownPanel({
                id: 'column-tab',
                title: 'Column',
                markdown: 'Use `ColumnPanel` to keep multiple panels visible.'
              }),
              accordeon: new MarkdownPanel({
                id: 'accordeon-tab',
                title: 'Accordeon',
                markdown: 'Use `AccordeonPanel` for collapsible sections.'
              })
            }
          })
        }
      });
  }
}

function renderScene(
  sceneElement: HTMLElement,
  highlight: PanelDocsExampleHighlight,
  theme: 'light' | 'dark'
) {
  const document = sceneElement.ownerDocument;
  const wrapper = document.createElement('div');
  const title = document.createElement('div');
  const subtitle = document.createElement('div');
  const showSceneTitle = highlight === 'widget-panels';

  applyStyle(wrapper, {position: 'absolute', inset: '0'});
  if (showSceneTitle) {
    applyStyle(title, {
      position: 'absolute',
      left: '24px',
      top: '24px',
      fontSize: 'clamp(28px, 4vw, 46px)',
      lineHeight: '1.02',
      fontWeight: '800',
      color: theme === 'dark' ? '#e2e8f0' : '#0f172a',
      maxWidth: 'min(48vw, 520px)'
    });
    title.textContent = 'Standalone Panels';
  }

  applyStyle(subtitle, {
    position: 'absolute',
    left: '24px',
    top: showSceneTitle ? '86px' : '24px',
    maxWidth: 'min(44vw, 460px)',
    fontSize: '15px',
    lineHeight: '1.45',
    color: theme === 'dark' ? 'rgba(226, 232, 240, 0.78)' : 'rgba(15, 23, 42, 0.72)'
  });
  subtitle.textContent = 'Standalone panel example with light/dark panel themes.';

  if (showSceneTitle) {
    wrapper.append(title);
  }
  wrapper.append(subtitle);
  sceneElement.replaceChildren(wrapper);
}

function renderThemeControl(
  rootElement: HTMLElement,
  theme: 'light' | 'dark',
  onThemeChange: (theme: 'light' | 'dark') => void
) {
  const document = rootElement.ownerDocument;
  const wrapper = document.createElement('div');
  const title = document.createElement('div');
  const row = document.createElement('div');

  applyStyle(wrapper, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: '10px',
    background: 'var(--menu-background)',
    color: 'var(--menu-text)',
    boxShadow: 'var(--menu-shadow)',
    border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))',
    minWidth: '172px'
  });
  title.textContent = 'Panel theme';
  applyStyle(title, {fontSize: '12px', fontWeight: '700', color: 'var(--button-text)'});
  applyStyle(row, {display: 'flex', gap: '8px'});

  for (const themeName of ['light', 'dark'] as const) {
    const button = document.createElement('button');
    const isActive = theme === themeName;
    button.type = 'button';
    button.textContent = themeName === 'light' ? 'Light' : 'Dark';
    applyStyle(button, {
      flex: '1 1 0',
      border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))',
      borderRadius: '8px',
      padding: '8px 10px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '700',
      background: isActive ? 'var(--button-background)' : 'transparent',
      color: 'var(--button-text)',
      boxShadow: isActive ? 'var(--button-shadow)' : 'none'
    });
    button.onclick = () => onThemeChange(themeName);
    row.append(button);
  }

  wrapper.append(title, row);
  rootElement.replaceChildren(wrapper);
}

function applyStyle(element: HTMLElement, style: Record<string, string>) {
  Object.assign(element.style, style);
}
