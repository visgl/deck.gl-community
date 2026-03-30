/** @jsxImportSource preact */
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsWidgetPanel } from './settings-widget';
import { AccordeonWidgetPanel, TabbedWidgetPanel } from './widget-containers';

import type { SettingsSchema, SettingsState } from '../lib/settings/settings';

const TEST_SCHEMA: SettingsSchema = {
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

const INITIAL_SETTINGS: SettingsState = {
  flags: { enabled: true },
  render: { opacity: 0.4 },
  mode: 'all',
};

function renderSettingsPanel(options?: {
  settings?: SettingsState;
  onSettingsChange?: (settings: SettingsState) => void;
}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const panel = new SettingsWidgetPanel({
    label: 'Visualization settings',
    schema: TEST_SCHEMA,
    settings: options?.settings ?? INITIAL_SETTINGS,
    onSettingsChange: options?.onSettingsChange,
  });

  render(panel.content, root);

  return {
    root,
    cleanup() {
      render(null, root);
      root.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsWidgetPanel', () => {
  it('creates section panels with stable ids and preserves section order', () => {
    const panels = SettingsWidgetPanel.createSectionPanels({
      schema: TEST_SCHEMA,
      settings: INITIAL_SETTINGS,
    });

    expect(Object.keys(panels)).toEqual(['visibility', 'mode']);
    expect(panels.visibility?.title).toBe('Visibility');
    expect(panels.mode?.title).toBe('Mode');
  });

  it('emits updated settings for nested boolean, clamped numeric, and select values', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const { root, cleanup } = renderSettingsPanel({ onSettingsChange: handleSettingsChange });

    const sectionToggles = root.querySelectorAll('button[aria-expanded]');
    const visibilityToggle = sectionToggles[0] as HTMLButtonElement;
    const modeToggle = sectionToggles[1] as HTMLButtonElement;

    visibilityToggle.click();
    await Promise.resolve();

    const checkbox = root.querySelector('input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ enabled: false }),
      }),
    );

    const numberInput = root.querySelector('input[type="number"]');
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

    const select = root.querySelector('select');
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

  it('uses deck widget theme CSS variables for the settings controls', async () => {
    const { root, cleanup } = renderSettingsPanel();
    const sectionToggle = root.querySelector('button[aria-expanded]');
    sectionToggle.click();
    await Promise.resolve();

    const numberInput = root.querySelector('input[type="number"]');
    expect(numberInput.getAttribute('style')).toContain('var(--button-backdrop-filter');

    cleanup();
  });

  it('renders a reusable settings panel for sidebar and modal containers', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const { root, cleanup } = renderSettingsPanel({ onSettingsChange: handleSettingsChange });

    expect(root.textContent).toContain('Visibility');
    expect(root.textContent).toContain('Mode');

    const visibilityToggle = root.querySelectorAll('button[aria-expanded]')[0] as HTMLButtonElement;
    visibilityToggle.click();
    await Promise.resolve();

    const checkbox = root.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ enabled: false }),
      }),
    );

    cleanup();
  });

  it('composes section panels into tabs without duplicating section titles in the body', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new TabbedWidgetPanel({
      id: 'settings-tabs',
      title: 'Settings tabs',
      panels: SettingsWidgetPanel.createSectionPanels({
        schema: TEST_SCHEMA,
        settings: INITIAL_SETTINGS,
        onSettingsChange: handleSettingsChange,
      }),
    });

    render(panel.content, root);

    expect(root.textContent?.match(/Visibility/g)).toHaveLength(1);
    expect(root.textContent).toContain('Mode');

    const checkbox = root.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ enabled: false }),
      }),
    );

    render(null, root);
    root.remove();
  });

  it('composes section panels into accordion items without duplicating section titles in the body', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new AccordeonWidgetPanel({
      id: 'settings-accordion',
      title: 'Settings accordion',
      panels: SettingsWidgetPanel.createSectionPanels({
        schema: TEST_SCHEMA,
        settings: INITIAL_SETTINGS,
        onSettingsChange: handleSettingsChange,
      }),
    });

    render(panel.content, root);

    const visibilityButton = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Visibility'),
    );
    visibilityButton?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await Promise.resolve();

    expect(root.textContent?.match(/Visibility/g)).toHaveLength(1);

    const checkbox = root.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ enabled: false }),
      }),
    );

    render(null, root);
    root.remove();
  });
});
