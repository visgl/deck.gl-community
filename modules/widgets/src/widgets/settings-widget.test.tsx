import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsWidget } from './settings-widget';

import type { SettingsWidgetSchema, SettingsWidgetState } from './settings-widget';

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
          description: 'Enable rendering for this layer.',
        },
        {
          name: 'render.opacity',
          label: 'Opacity',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.1,
          description: 'Adjust alpha for rendered paths.',
        },
      ],
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
          description: 'Control which traces remain visible.',
        },
      ],
    },
  ],
};

const INITIAL_SETTINGS: SettingsWidgetState = {
  flags: { enabled: true },
  render: { opacity: 0.4 },
  mode: 'all',
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
    onSettingsChange: options?.onSettingsChange,
  });

  widget.onRenderHTML(root);

  return {
    root,
    widget,
    cleanup() {
      widget.onRemove();
      root.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsWidget', () => {
  it('opens and closes the settings pane and toggles section collapse state', async () => {
    const { root, cleanup } = renderWidget();

    const openButton = root.querySelector('button[title="Visualization settings"]');
    expect(openButton).toBeTruthy();

    (openButton as HTMLButtonElement).click();
    await Promise.resolve();

    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();

    expect(root.textContent).not.toContain('Enable rendering for this layer.');
    expect(root.querySelector('[data-setting-info-for]')).toBeNull();

    const sectionToggles = root.querySelectorAll('button[aria-expanded]');
    expect(sectionToggles.length).toBe(2);

    const visibilityToggle = sectionToggles[0] as HTMLButtonElement;
    const modeToggle = sectionToggles[1] as HTMLButtonElement;

    expect(visibilityToggle.getAttribute('aria-expanded')).toBe('false');
    expect(modeToggle.getAttribute('aria-expanded')).toBe('false');

    visibilityToggle.click();
    await Promise.resolve();
    expect(visibilityToggle.getAttribute('aria-expanded')).toBe('true');

    const enabledSettingRow = root.querySelector('[data-setting-row-for="flags.enabled"]') as
      | HTMLElement
      | undefined;
    expect(enabledSettingRow).toBeTruthy();
    expect(enabledSettingRow?.getAttribute('title')).toBe('Enable rendering for this layer.');

    modeToggle.click();
    await Promise.resolve();
    expect(modeToggle.getAttribute('aria-expanded')).toBe('true');

    const modeSettingRow = root.querySelector('[data-setting-row-for="mode"]') as
      | HTMLElement
      | undefined;
    expect(modeSettingRow?.getAttribute('title')).toBe('Control which traces remain visible.');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(root.querySelector('[role="dialog"]')).toBeNull();

    cleanup();
  });

  it('emits updated settings for nested boolean, clamped numeric, and select values', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsWidgetState) => void>();
    const { root, cleanup } = renderWidget({ onSettingsChange: handleSettingsChange });

    (root.querySelector('button[title="Visualization settings"]') as HTMLButtonElement).click();
    await Promise.resolve();

    const sectionToggles = root.querySelectorAll('button[aria-expanded]');
    const visibilityToggle = sectionToggles[0] as HTMLButtonElement;
    const modeToggle = sectionToggles[1] as HTMLButtonElement;

    visibilityToggle.click();
    await Promise.resolve();

    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ enabled: false }),
      }),
    );

    const numberInput = root.querySelector('input[type="number"]') as HTMLInputElement;
    numberInput.value = '2';
    numberInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        render: expect.objectContaining({ opacity: 1 }),
      }),
    );

    modeToggle.click();
    await Promise.resolve();

    const select = root.querySelector('select') as HTMLSelectElement;
    select.value = 'critical-path';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'critical-path',
      }),
    );

    cleanup();
  });
});
