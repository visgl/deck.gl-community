/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, expect, it, vi} from 'vitest';
import {TabbedPanel} from '../composite-panels/tabbed-panel';
import {SettingsPanel} from '../leaf-panels/settings/settings-panel';
import {ensurePanelStylesheet} from '../lib/panel-styles';

let host: HTMLDivElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

it.each([
  'sleek-light',
  'sleek-dark'
] as const)('renders a translucent %s surface with themed native controls', theme => {
  ensurePanelStylesheet(document);
  host = document.createElement('div');
  document.body.append(host);
  const onSettingsChange = vi.fn();
  const settings = new SettingsPanel({
    onSettingsChange,
    id: 'glass-settings',
    schema: {
      sections: [
        {
          name: 'Rendering',
          initiallyCollapsed: false,
          settings: [
            {name: 'speed', label: 'Speed', type: 'number', min: 0, max: 1, step: 0.1},
            {name: 'mode', label: 'Transparency', type: 'select', options: ['Exact', 'Weighted']},
            {name: 'enabled', label: 'Enabled', type: 'boolean'}
          ]
        }
      ]
    },
    settings: {speed: 0.5, mode: 'Exact', enabled: true}
  });
  const panel = new TabbedPanel({theme, panels: [settings]});
  panel.onRenderHTML(host);
  const surface = host.querySelector<HTMLElement>('[data-panel-tabs]').parentElement;
  const style = getComputedStyle(surface);
  expect(style.backgroundColor).toMatch(/^rgba\(/);
  expect(style.backdropFilter).toBe('none');
  expect(style.borderRadius).toBe('8px');
  const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const accent = theme === 'sleek-dark' ? 'rgb(134, 203, 189)' : 'rgb(22, 117, 101)';
  expect(getComputedStyle(slider).appearance).toBe('none');
  expect(getComputedStyle(slider).height).toBe('16px');
  expect(slider.value).toBe('0.5');
  expect(getComputedStyle(checkbox).accentColor).toBe(accent);
  const rows = [...host.querySelectorAll<HTMLElement>('[data-setting-row-for]')];
  const centers = rows.map(row => {
    const bounds = row.getBoundingClientRect();
    return bounds.top + bounds.height / 2;
  });
  expect(centers).toHaveLength(3);
  expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1], 1);
  verifySwitch(checkbox, onSettingsChange);
});

function verifySwitch(checkbox: HTMLInputElement, onSettingsChange: ReturnType<typeof vi.fn>) {
  expect(getComputedStyle(checkbox).appearance).toBe('none');
  expect(checkbox.getBoundingClientRect().width).toBeCloseTo(26, 0);
  const thumb = getComputedStyle(checkbox, '::before');
  expect(thumb.backgroundColor).toBe(getComputedStyle(checkbox).accentColor);
  const transform = new DOMMatrix(thumb.transform);
  const thumbCenter = parseFloat(thumb.top) + transform.m42 + parseFloat(thumb.height) / 2;
  expect(thumbCenter).toBeCloseTo(checkbox.clientHeight / 2, 0);
  checkbox.click();
  expect(checkbox.checked).toBe(false);
  expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({enabled: false}));
}

it.each(['sleek-light', 'sleek-dark'] as const)('renders an outlined off switch in %s', theme => {
  ensurePanelStylesheet(document);
  host = document.createElement('div');
  document.body.append(host);
  const settings = new SettingsPanel({
    theme,
    id: 'off-switch',
    schema: {
      sections: [
        {
          name: 'Routing',
          initiallyCollapsed: false,
          settings: [{name: 'enabled', label: 'Enabled', type: 'boolean'}]
        }
      ]
    },
    settings: {enabled: false}
  });
  settings.onRenderHTML(host);
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(checkbox.checked).toBe(false);
  expect(getComputedStyle(checkbox, '::before').backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(checkbox, '::before').borderTopStyle).toBe('solid');
  expect(getComputedStyle(checkbox).borderTopColor).toBe(getComputedStyle(checkbox).accentColor);
});
