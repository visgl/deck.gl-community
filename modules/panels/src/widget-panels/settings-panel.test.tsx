/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {SettingsPanel} from './settings-panel';
import {AccordeonPanel, TabbedPanel} from './widget-containers';

import type {SettingsSchema, SettingsState} from '../lib/settings/settings';

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

const INITIAL_SETTINGS: SettingsState = {
  flags: {enabled: true},
  render: {opacity: 0.4},
  mode: 'all'
};

function renderSettingsPanel(options?: {
  settings?: SettingsState;
  onSettingsChange?: (settings: SettingsState) => void;
}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const panel = new SettingsPanel({
    label: 'Visualization settings',
    schema: TEST_SCHEMA,
    settings: options?.settings ?? INITIAL_SETTINGS,
    onSettingsChange: options?.onSettingsChange
  });

  render(panel.content, root);
  const cleanup = () => {
    render(null, root);
    root.remove();
  };

  return {
    root,
    cleanup
  };
}

function getRequiredInput(root: ParentNode, selector: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`Expected input matching selector: ${selector}`);
  }
  return input;
}

function getRequiredButton(root: ParentNode, selector: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`Expected button matching selector: ${selector}`);
  }
  return button;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsPanel', () => {
  it('creates section panels with stable ids and preserves section order', () => {
    const panels = SettingsPanel.createSectionPanels({
      schema: TEST_SCHEMA,
      settings: INITIAL_SETTINGS
    });

    expect(Object.keys(panels)).toEqual(['visibility', 'mode']);
    expect(panels.visibility?.title).toBe('Visibility');
    expect(panels.mode?.title).toBe('Mode');
  });

  // eslint-disable-next-line max-statements
  it('emits updated settings for nested boolean, clamped numeric, and select values', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const {root, cleanup} = renderSettingsPanel({onSettingsChange: handleSettingsChange});

    const sectionToggles = root.querySelectorAll('button[aria-expanded]');
    const visibilityToggle = sectionToggles[0] as HTMLButtonElement;
    const modeToggle = sectionToggles[1] as HTMLButtonElement;

    visibilityToggle.click();
    await Promise.resolve();

    const checkbox = getRequiredInput(root, 'input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({enabled: false})
      })
    );

    const numberInput = getRequiredInput(root, 'input[type="number"]');
    numberInput.value = '2';
    numberInput.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        render: expect.objectContaining({opacity: 1})
      })
    );

    modeToggle.click();
    await Promise.resolve();

    expect(root.querySelector('select')).toBeNull();

    const selectButton = getRequiredButton(root, '#settings-panel-input-mode');
    selectButton.click();
    await Promise.resolve();

    const option = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')
    ).find((button) => button.textContent?.includes('critical-path'));
    expect(option).toBeTruthy();
    option?.click();
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'critical-path'
      })
    );

    cleanup();
  });

  it('uses deck widget theme CSS variables for the settings controls', async () => {
    const {root, cleanup} = renderSettingsPanel();
    const sectionToggle = getRequiredButton(root, 'button[aria-expanded]');
    sectionToggle.click();
    await Promise.resolve();

    const numberInput = getRequiredInput(root, 'input[type="number"]');
    expect(numberInput.getAttribute('style')).toContain('var(--button-backdrop-filter');

    cleanup();
  });

  // eslint-disable-next-line max-statements
  it('renders a reusable settings panel for sidebar and modal containers', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const {root, cleanup} = renderSettingsPanel({onSettingsChange: handleSettingsChange});

    expect(root.textContent).toContain('Visibility');
    expect(root.textContent).toContain('Mode');

    const visibilityToggle = root.querySelectorAll('button[aria-expanded]')[0] as HTMLButtonElement;
    visibilityToggle.click();
    await Promise.resolve();

    const checkbox = getRequiredInput(root, 'input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({enabled: false})
      })
    );

    cleanup();
  });

  it('composes section panels into tabs without duplicating section titles in the body', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new TabbedPanel({
      id: 'settings-tabs',
      title: 'Settings tabs',
      panels: SettingsPanel.createSectionPanels({
        schema: TEST_SCHEMA,
        settings: INITIAL_SETTINGS,
        onSettingsChange: handleSettingsChange
      })
    });

    render(panel.content, root);

    expect(root.textContent?.match(/Visibility/g)).toHaveLength(1);
    expect(root.textContent).toContain('Mode');

    const checkbox = getRequiredInput(root, 'input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({enabled: false})
      })
    );

    render(null, root);
    root.remove();
  });

  it('composes section panels into accordion items without duplicating section titles in the body', async () => {
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new AccordeonPanel({
      id: 'settings-accordion',
      title: 'Settings accordion',
      panels: SettingsPanel.createSectionPanels({
        schema: TEST_SCHEMA,
        settings: INITIAL_SETTINGS,
        onSettingsChange: handleSettingsChange
      })
    });

    render(panel.content, root);

    const visibilityButton = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Visibility')
    );
    visibilityButton?.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await Promise.resolve();

    expect(root.textContent?.match(/Visibility/g)).toHaveLength(1);

    const checkbox = getRequiredInput(root, 'input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();

    expect(handleSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({enabled: false})
      })
    );

    render(null, root);
    root.remove();
  });
});
