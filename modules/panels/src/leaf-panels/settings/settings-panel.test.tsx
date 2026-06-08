/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {SettingsPanel} from './settings-panel';
import {AccordeonPanel} from '../../composite-panels/accordeon-panel';
import {TabbedPanel} from '../../composite-panels/tabbed-panel';

import type {SettingsSchema, SettingsState} from '../../lib/settings/settings';

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
          sliderDebounceMs: 20,
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
          options: [
            'all',
            {
              label: 'critical-path with a full visible label',
              value: 'critical-path',
              description: 'Only keep critical traces visible.'
            },
            'selected-only'
          ],
          description: 'Control which items remain visible.'
        },
        {
          name: 'sort',
          label: 'Sort',
          type: 'select',
          options: ['newest', 'oldest'],
          description: 'Choose result ordering.'
        }
      ]
    }
  ]
};

const INITIAL_SETTINGS: SettingsState = {
  flags: {enabled: true},
  render: {opacity: 0.4},
  mode: 'all',
  sort: 'newest'
};

function renderSettingsPanel(options?: {
  fontSize?: number | string;
  settings?: SettingsState;
  onSettingsChange?: (settings: SettingsState) => void;
}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const panel = new SettingsPanel({
    label: 'Visualization settings',
    schema: TEST_SCHEMA,
    settings: options?.settings ?? INITIAL_SETTINGS,
    onSettingsChange: options?.onSettingsChange,
    fontSize: options?.fontSize
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

function createDomRect({
  bottom,
  left,
  right,
  top
}: {
  bottom: number;
  left: number;
  right: number;
  top: number;
}): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    toJSON: () => ({}),
    top,
    width: right - left,
    x: left,
    y: top
  } as DOMRect;
}

function clickWithPointer(element: HTMLElement): void {
  element.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
  element.click();
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

    expect(panels.map(panel => panel.id)).toEqual(['visibility', 'mode']);
    expect(panels[0]?.title).toBe('Visibility');
    expect(panels[1]?.title).toBe('Mode');
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
    ).find(button => button.textContent?.includes('critical-path'));
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

  it('uses panel theme CSS variables for the settings controls', async () => {
    const {root, cleanup} = renderSettingsPanel();
    const sectionToggle = getRequiredButton(root, 'button[aria-expanded]');
    sectionToggle.click();
    await Promise.resolve();

    const numberInput = getRequiredInput(root, 'input[type="number"]');
    expect(numberInput.getAttribute('style')).toContain('var(--button-backdrop-filter');
    expect(numberInput.style.height).toBe('28px');
    expect(numberInput.style.padding).toBe('2px 6px');

    cleanup();
  });

  it('applies supported font size overrides to labels and select menu options', async () => {
    const {root, cleanup} = renderSettingsPanel({fontSize: '15px'});
    const visibilityToggle = getRequiredButton(root, 'button[aria-expanded]');
    const modeToggle = root.querySelectorAll('button[aria-expanded]')[1] as HTMLButtonElement;
    visibilityToggle.click();
    modeToggle.click();
    await Promise.resolve();

    const settingLabel = root.querySelector<HTMLElement>(
      '[data-setting-row-for="flags.enabled"] label'
    );
    const numberInput = getRequiredInput(root, 'input[type="number"]');
    const selectButton = getRequiredButton(root, '#settings-panel-input-mode');
    selectButton.click();
    await Promise.resolve();

    const selectOption = document.body.querySelector<HTMLButtonElement>('[role="option"]');
    expect(settingLabel?.style.fontSize).toBe('15px');
    expect(numberInput.style.fontSize).toBe('15px');
    expect(selectButton.style.fontSize).toBe('15px');
    expect(selectOption?.style.fontSize).toBe('15px');

    cleanup();
  });

  it('lets open select menus exceed the control width and renders option descriptions', async () => {
    const {root, cleanup} = renderSettingsPanel();
    const modeToggle = root.querySelectorAll('button[aria-expanded]')[1] as HTMLButtonElement;
    modeToggle.click();
    await Promise.resolve();

    const selectButton = getRequiredButton(root, '#settings-panel-input-mode');
    (selectButton.parentElement as HTMLDivElement).getBoundingClientRect = () =>
      createDomRect({bottom: 44, left: 24, right: 224, top: 12});
    selectButton.click();
    await Promise.resolve();

    const listbox = document.body.querySelector<HTMLDivElement>('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox?.parentElement).toBe(document.body);
    expect(listbox?.style.width).toBe('max-content');
    expect(listbox?.style.minWidth).toBe('200px');
    expect(listbox?.getBoundingClientRect().width).toBeGreaterThan(200);

    const option = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')
    ).find(button => button.textContent?.includes('critical-path'));
    const optionLabel = option?.querySelector<HTMLElement>('[data-select-option-label="true"]');
    const optionDescription = option?.querySelector<HTMLElement>(
      '[data-select-option-description="true"]'
    );
    expect(optionLabel?.textContent).toBe('critical-path with a full visible label');
    expect(optionLabel?.style.whiteSpace).toBe('nowrap');
    expect(optionLabel?.style.textOverflow).toBe('');
    expect(optionDescription?.textContent).toBe('Only keep critical traces visible.');
    expect(optionDescription?.style.fontSize).toBe('11px');

    cleanup();
  });

  it('only opens selects from their buttons and closes other keyboard-opened selects', async () => {
    const {root, cleanup} = renderSettingsPanel();
    const modeToggle = root.querySelectorAll('button[aria-expanded]')[1] as HTMLButtonElement;
    modeToggle.click();
    await Promise.resolve();

    const modeButton = getRequiredButton(root, '#settings-panel-input-mode');
    const sortButton = getRequiredButton(root, '#settings-panel-input-sort');
    const sortLabel = root.querySelector<HTMLElement>('[data-setting-row-for="sort"] label');
    expect(sortLabel).toBeTruthy();
    expect(sortLabel?.getAttribute('for')).toBeNull();

    modeButton.click();
    await Promise.resolve();
    expect(document.body.querySelector('[role="listbox"]')?.id).toBe(
      'settings-panel-input-mode-listbox'
    );

    clickWithPointer(sortLabel as HTMLElement);
    await Promise.resolve();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();

    modeButton.click();
    await Promise.resolve();
    sortButton.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'ArrowDown'}));
    await Promise.resolve();
    expect(document.body.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="listbox"]')?.id).toBe(
      'settings-panel-input-sort-listbox'
    );

    cleanup();
  });

  it('debounces range slider changes when requested by the setting descriptor', async () => {
    vi.useFakeTimers();
    const handleSettingsChange = vi.fn<(settings: SettingsState) => void>();
    const {root, cleanup} = renderSettingsPanel({onSettingsChange: handleSettingsChange});

    try {
      const sectionToggle = getRequiredButton(root, 'button[aria-expanded]');
      sectionToggle.click();
      await Promise.resolve();

      const rangeInput = getRequiredInput(root, 'input[type="range"]');
      rangeInput.value = '0.7';
      rangeInput.dispatchEvent(new Event('input', {bubbles: true}));
      await Promise.resolve();

      expect(handleSettingsChange).not.toHaveBeenCalledWith(
        expect.objectContaining({
          render: expect.objectContaining({opacity: 0.7})
        })
      );

      await vi.advanceTimersByTimeAsync(20);

      expect(handleSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          render: expect.objectContaining({opacity: 0.7})
        })
      );
    } finally {
      cleanup();
      vi.useRealTimers();
    }
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

    const visibilityButton = Array.from(root.querySelectorAll('button')).find(button =>
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
