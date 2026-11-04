/** @jsxImportSource preact */
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {PANEL_THEME_PRESETS, applyPanelTheme, type PanelThemePreset} from '../src/lib/panel-theme';
import {ensurePanelStylesheet} from '../src/lib/panel-styles';
import {Panel} from '../src/panels/panel';
import {PanelThemeScope} from '../src/panels/panel-theme-scope';
import {TabbedPanel} from '../src/composite-panels/tabbed-panel';
import {SettingsPanel} from '../src/leaf-panels/settings/settings-panel';
import type {SettingsState} from '../src/lib/settings/settings';

class PreviewPanel extends Panel {}

function Fields({id}: {id: string}) {
  const [settings, setSettings] = useState<SettingsState>({
    [`${id}-speed`]: 0.85,
    [`${id}-emission`]: 5.2,
    [`${id}-exposure`]: 0.95,
    [`${id}-adaptive`]: true,
    [`${id}-mode`]: 'exact'
  });
  const panel = new SettingsPanel({
    id,
    schema: {
      sections: [
        {
          name: 'Rendering',
          initiallyCollapsed: false,
          settings: [
            {
              name: `${id}-speed`,
              label: 'Packet Speed',
              type: 'number',
              min: 0,
              max: 2,
              step: 0.05
            },
            {
              name: `${id}-mode`,
              label: 'Transparency',
              type: 'select',
              options: [
                {label: 'Exact A-buffer OIT', value: 'exact'},
                {label: 'Weighted Blended', value: 'weighted'}
              ]
            },
            {name: `${id}-adaptive`, label: 'Adaptive Routing', type: 'boolean'},
            {
              name: `${id}-emission`,
              label: 'Packet Emission',
              type: 'number',
              min: 0,
              max: 10,
              step: 0.1
            },
            {name: `${id}-exposure`, label: 'Exposure', type: 'number', min: 0, max: 2, step: 0.05}
          ]
        }
      ]
    },
    settings,
    onSettingsChange: setSettings
  });
  return <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope>;
}

ensurePanelStylesheet(document);
for (const preset of Object.keys(PANEL_THEME_PRESETS) as PanelThemePreset[]) {
  const article = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = preset;
  const selector = document.createElement('select');
  selector.setAttribute('aria-label', `${preset} preview preset`);
  for (const name of Object.keys(PANEL_THEME_PRESETS))
    selector.add(new Option(name, name, name === preset, name === preset));
  const host = document.createElement('div');
  host.className = 'preview';
  host.dataset.preview = preset;
  applyPanelTheme(host, PANEL_THEME_PRESETS[preset]);
  selector.onchange = () =>
    applyPanelTheme(host, PANEL_THEME_PRESETS[selector.value as PanelThemePreset]);
  article.append(heading, selector, host);
  document.getElementById('app').append(article);
  const inverted = new PreviewPanel({
    id: `${preset}-invert`,
    title: 'Inverted',
    theme: 'invert',
    content: <Fields id={`${preset}-inverted-mode`} />
  });
  const panel = new TabbedPanel({
    id: preset,
    panels: [
      new PreviewPanel({
        id: `${preset}-settings`,
        title: 'Settings',
        content: <Fields id={`${preset}-mode`} />
      }),
      new PreviewPanel({
        id: `${preset}-nested`,
        title: 'Inverse',
        content: (
          <PanelThemeScope panel={inverted}>
            <Fields id={`${preset}-nested-mode`} />
          </PanelThemeScope>
        )
      }),
      new PreviewPanel({id: `${preset}-disabled`, title: 'Disabled', disabled: true, content: null})
    ]
  });
  render(<PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope>, host);
}
