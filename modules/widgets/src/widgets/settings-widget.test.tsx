import {afterEach, describe, expect, it, vi} from 'vitest';

import {SettingsWidget} from './settings-widget';

import type {SettingsWidgetSchema, SettingsWidgetState} from './settings-widget';

const TEST_SCHEMA: SettingsWidgetSchema = {
  title: 'Test settings',
  sections: [
    {
      id: 'visibility',
      name: 'Visibility',
      settings: [
        {
          name: 'flags.enabled',
          label: 'Enabled',
          type: 'boolean',
          description: 'Enable rendering for this layer.'
        },
        {
          name: 'render.opacity',
          label: 'Opacity',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.1,
          description: 'Adjust alpha for rendered paths.'
        }
      ]
    },
    {
      id: 'mode',
      name: 'Mode',
      settings: [
        {
          name: 'mode',
          label: 'Mode',
          type: 'select',
          options: ['all', 'critical-path', 'selected-only'],
          description: 'Control which traces remain visible.'
        }
      ]
    }
  ]
};

const INITIAL_SETTINGS: SettingsWidgetState = {
  flags: {enabled: true},
  render: {opacity: 0.4},
  mode: 'all'
};

function renderWidget(options?: {
  settings?: SettingsWidgetState;
  onSettingsChange?: (settings: SettingsWidgetState) => void;
}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const widget = new SettingsWidget({
    label: 'Visualization settings',
    schema: TEST_SCHEMA,
    settings: options?.settings ?? INITIAL_SETTINGS,
    onSettingsChange: options?.onSettingsChange
  });

  widget.onRenderHTML(root);

  const cleanup = () => {
    widget.onRemove();
    root.remove();
  };

  return {
    root,
    widget,
    cleanup
  };
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
}

function clickButton(button: HTMLButtonElement | null): void {
  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
}

function getSectionToggles(root: ParentNode): NodeListOf<HTMLButtonElement> {
  return root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]');
}

function getRequiredInput(root: ParentNode, selector: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`Expected input matching selector: ${selector}`);
  }
  return input;
}

function getRequiredSelect(root: ParentNode, selector: string): HTMLSelectElement {
  const select = root.querySelector<HTMLSelectElement>(selector);
  if (!select) {
    throw new Error(`Expected select matching selector: ${selector}`);
  }
  return select;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsWidget', () => {
  // eslint-disable-next-line max-statements
  it('opens and closes the settings pane and toggles section collapse state', async () => {
    const {root, cleanup} = renderWidget();

    clickButton(root.querySelector<HTMLButtonElement>('button[title="Visualization settings"]'));
    await flushEffects();

    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();

    expect(root.textContent).not.toContain('Enable rendering for this layer.');
    expect(root.querySelector('[data-setting-info-for]')).toBeNull();

    const sectionToggles = getSectionToggles(root);
    expect(sectionToggles.length).toBe(2);

    const visibilityToggle = sectionToggles[0];
    const modeToggle = sectionToggles[1];

    expect(visibilityToggle.getAttribute('aria-expanded')).toBe('false');
    expect(modeToggle.getAttribute('aria-expanded')).toBe('false');

    clickButton(visibilityToggle);
    await flushEffects();
    expect(visibilityToggle.getAttribute('aria-expanded')).toBe('true');

    const enabledSettingRow = root.querySelector('[data-setting-row-for="flags.enabled"]');
    expect(enabledSettingRow).toBeTruthy();
    expect(enabledSettingRow?.getAttribute('title')).toBe('Enable rendering for this layer.');

    clickButton(modeToggle);
    await flushEffects();
    expect(modeToggle.getAttribute('aria-expanded')).toBe('true');

    const modeSettingRow = root.querySelector('[data-setting-row-for="mode"]');
    expect(modeSettingRow?.getAttribute('title')).toBe('Control which traces remain visible.');

    document.body.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await flushEffects();
    expect(root.querySelector('[role="dialog"]')).toBeNull();

    cleanup();
  });

  // eslint-disable-next-line max-statements
  it('emits updated settings for nested boolean, clamped numeric, and select values', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsWidgetState) => void>();
    const {root, cleanup} = renderWidget({onSettingsChange: handleSettingsChange});

    clickButton(root.querySelector<HTMLButtonElement>('button[title="Visualization settings"]'));
    await flushEffects();

    const sectionToggles = getSectionToggles(root);
    const visibilityToggle = sectionToggles[0];
    const modeToggle = sectionToggles[1];

    clickButton(visibilityToggle);
    await flushEffects();

    const checkbox = getRequiredInput(root, 'input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', {bubbles: true}));
    await flushEffects();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({enabled: false})
      })
    );

    const numberInput = getRequiredInput(root, 'input[type="number"]');
    numberInput.value = '2';
    numberInput.dispatchEvent(new Event('change', {bubbles: true}));
    await flushEffects();

    expect(handleSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        render: expect.objectContaining({opacity: 1})
      })
    );

    clickButton(modeToggle);
    await flushEffects();

    const select = getRequiredSelect(root, 'select');
    select.value = 'critical-path';
    select.dispatchEvent(new Event('change', {bubbles: true}));
    await flushEffects();

    expect(handleSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'critical-path'
      })
    );

    cleanup();
  });
});
