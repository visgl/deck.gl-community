/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';
import {PANEL_THEME_PRESETS, applyPanelTheme} from '../lib/panel-theme';
import {ensurePanelStylesheet} from '../lib/panel-styles';
import {Panel} from './panel';
import {PanelThemeScope, useEffectivePanelThemeMode} from './panel-theme-scope';
import {SelectComponent} from '../preact/select-component';

class TestPanel extends Panel {}

function ModeLabel() {
  return <span data-mode-label>{useEffectivePanelThemeMode()}</span>;
}

function mountPanel(host: HTMLElement, theme?: Panel['theme']) {
  const panel = new TestPanel({id: 'outer', title: 'Outer', theme, content: null});
  const child = new TestPanel({id: 'child', title: 'Child', content: null});
  render(
    <PanelThemeScope panel={panel}>
      <PanelThemeScope panel={child}>
        <ModeLabel />
      </PanelThemeScope>
    </PanelThemeScope>,
    host
  );
}

async function settleRender() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  for (const host of document.querySelectorAll('[data-test-host]')) {
    render(null, host);
    host.remove();
  }
});

function createHost() {
  const host = document.createElement('div');
  host.dataset.testHost = '';
  document.body.append(host);
  return host;
}

describe('panel preset inheritance', () => {
  it.each(
    Object.entries(PANEL_THEME_PRESETS)
  )('inherits %s and preserves custom values', async (preset, variables) => {
    const host = createHost();
    applyPanelTheme(host, {...variables, '--panel-padding': '3px'});
    mountPanel(host);
    await settleRender();
    const scopes = [...host.querySelectorAll<HTMLElement>('[data-panel-theme-preset]')];
    expect(scopes.map(scope => scope.dataset.panelThemePreset)).toEqual([preset, preset]);
    expect(getComputedStyle(scopes[1]).getPropertyValue('--panel-padding').trim()).toBe('3px');
    expect(host.querySelector('[data-mode-label]')?.textContent).toBe(
      preset.endsWith('dark') ? 'dark' : 'light'
    );
  });

  it('switches host presets at runtime and removes compact geometry', async () => {
    const host = createHost();
    applyPanelTheme(host, PANEL_THEME_PRESETS['sleek-dark']);
    mountPanel(host);
    await settleRender();
    applyPanelTheme(host, PANEL_THEME_PRESETS.light);
    await settleRender();
    const scope = host.querySelector<HTMLElement>('[data-panel-theme-preset]');
    expect(scope.dataset.panelThemePreset).toBe('light');
    expect(getComputedStyle(scope).getPropertyValue('--panel-padding').trim()).toBe('');
    expect(getComputedStyle(scope).getPropertyValue('--button-size').trim()).toBe('28px');
  });

  it.each([
    'light',
    'dark',
    'sleek-light',
    'sleek-dark'
  ] as const)('honors explicit %s inside a sleek host', async theme => {
    const host = createHost();
    applyPanelTheme(host, PANEL_THEME_PRESETS['sleek-dark']);
    mountPanel(host, theme);
    await settleRender();
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-panel-theme-preset]')].map(
        scope => scope.dataset.panelThemePreset
      )
    ).toEqual([theme, theme]);
  });

  it('inverts within the sleek family, including nested inversion', async () => {
    const host = createHost();
    applyPanelTheme(host, PANEL_THEME_PRESETS['sleek-dark']);
    const inverted = new TestPanel({id: 'invert', title: 'Invert', theme: 'invert', content: null});
    render(
      <PanelThemeScope panel={inverted}>
        <PanelThemeScope panel={inverted}>
          <ModeLabel />
        </PanelThemeScope>
      </PanelThemeScope>,
      host
    );
    await settleRender();
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-panel-theme-preset]')].map(
        scope => scope.dataset.panelThemePreset
      )
    ).toEqual(['sleek-light', 'sleek-dark']);
  });

  it('retains color inference for unmarked hosts', async () => {
    const host = createHost();
    host.style.setProperty('--menu-background', '#101010');
    mountPanel(host);
    await settleRender();
    expect(
      host.querySelector<HTMLElement>('[data-panel-theme-preset]')?.dataset.panelThemeMode
    ).toBe('dark');
  });

  it('themes portaled menus and updates them while open', async () => {
    ensurePanelStylesheet(document);
    const host = createHost();
    applyPanelTheme(host, PANEL_THEME_PRESETS['sleek-dark']);
    const panel = new TestPanel({id: 'select', title: 'Select', content: null});
    render(
      <PanelThemeScope panel={panel}>
        <SelectComponent
          id="mode"
          label="Mode"
          value="fast"
          options={[
            {label: 'Fast', value: 'fast'},
            {label: 'Quality', value: 'quality'}
          ]}
          onValueChange={() => {}}
        />
      </PanelThemeScope>,
      host
    );
    await settleRender();
    host.querySelector('button').click();
    await settleRender();
    const menu = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(menu).toBeTruthy();
    expect(getComputedStyle(menu).color).toBe('rgb(226, 232, 240)');
    expect(getComputedStyle(menu).fontSize).toBe('10px');
    applyPanelTheme(host, PANEL_THEME_PRESETS['sleek-light']);
    await settleRender();
    expect(getComputedStyle(menu).color).toBe('rgb(36, 52, 76)');
  });
});

it('isolates interaction styling at nested preset boundaries', async () => {
  ensurePanelStylesheet(document);
  const host = createHost();
  const sleek = new TestPanel({id: 'sleek', title: 'Sleek', theme: 'sleek-dark', content: null});
  const original = new TestPanel({
    id: 'original',
    title: 'Original',
    theme: 'light',
    content: null
  });
  render(
    <PanelThemeScope panel={sleek}>
      <PanelThemeScope panel={original}>
        <input id="original-input" style={{outline: '3px solid red'}} />
        <PanelThemeScope panel={sleek}>
          <input id="nested-sleek-input" />
        </PanelThemeScope>
      </PanelThemeScope>
    </PanelThemeScope>,
    host
  );
  await settleRender();
  const originalInput = host.querySelector<HTMLInputElement>('#original-input');
  originalInput.focus();
  expect(getComputedStyle(originalInput).outlineColor).toBe('rgb(255, 0, 0)');
  expect(getComputedStyle(originalInput).outlineWidth).toBe('3px');
  const sleekInput = host.querySelector<HTMLInputElement>('#nested-sleek-input');
  sleekInput.focus();
  expect(getComputedStyle(sleekInput).outlineColor).toBe('rgb(139, 180, 255)');
});

it('keeps focus and disabled states visible in sleek panels', async () => {
  ensurePanelStylesheet(document);
  const host = createHost();
  const panel = new TestPanel({id: 'focus', title: 'Focus', theme: 'sleek-dark', content: null});
  render(
    <PanelThemeScope panel={panel}>
      <input aria-label="Name" />
      <button disabled>Disabled</button>
    </PanelThemeScope>,
    host
  );
  await settleRender();
  const input = host.querySelector('input');
  input.focus();
  expect(getComputedStyle(input).outlineWidth).toBe('2px');
  expect(getComputedStyle(input).outlineColor).toBe('rgb(139, 180, 255)');
  expect(getComputedStyle(host.querySelector('button')).opacity).toBe('0.5');
});

it('switches explicit panel presets through setProps and restores host inheritance', async () => {
  const host = createHost();
  applyPanelTheme(host, PANEL_THEME_PRESETS['sleek-light']);
  const panel = new TestPanel({
    id: 'switch',
    title: 'Switch',
    theme: 'sleek-dark',
    content: 'Content'
  });
  panel.rootElement = host;
  panel.updateHTML();
  await settleRender();
  const scope = host.querySelector<HTMLElement>('[data-panel-theme-preset]');
  expect(getComputedStyle(scope).getPropertyValue('--panel-padding').trim()).toBe('4px 6px');
  panel.setProps({theme: 'dark'});
  await settleRender();
  expect(scope.dataset.panelThemePreset).toBe('dark');
  expect(getComputedStyle(scope).getPropertyValue('--panel-padding').trim()).toBe('');
  panel.setProps({theme: 'inherit'});
  await settleRender();
  expect(scope.dataset.panelThemePreset).toBe('sleek-light');
  expect(getComputedStyle(scope).getPropertyValue('--panel-padding').trim()).toBe('4px 6px');
});

it('inherits a custom panel definition and switches back to a built-in theme', async () => {
  const host = createHost();
  mountPanel(host, {
    base: 'sleek-dark',
    variables: {'--panel-accent-color': '#b99aff', '--panel-control-height': '22px'}
  });
  await settleRender();
  const child = host.querySelectorAll<HTMLElement>('[data-panel-theme-preset]')[1];
  expect(getComputedStyle(child).getPropertyValue('--panel-accent-color').trim()).toBe('#b99aff');
  expect(getComputedStyle(child).getPropertyValue('--panel-control-height').trim()).toBe('22px');
  expect(host.querySelector('[data-mode-label]')?.textContent).toBe('dark');
  mountPanel(host, 'light');
  await settleRender();
  expect(getComputedStyle(child).getPropertyValue('--panel-control-height').trim()).toBe('');
});
