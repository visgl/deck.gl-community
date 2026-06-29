/** @jsxImportSource preact */
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {StudioSettingsPanel, createStudioSettingsPanel} from './studio-settings-panel';

import type {SettingsSchema, SettingsState} from '../../lib/settings/settings';

const TEST_SCHEMA: SettingsSchema = {
  title: 'Visualization Settings',
  sections: [
    {
      id: 'colors',
      name: 'Colors',
      settings: [
        {
          name: 'colorSchemeId',
          label: 'Item Colors',
          description: 'Color items by semantic category',
          type: 'select',
          defaultValue: 'category',
          options: [
            {label: 'Category', value: 'category'},
            {label: 'Item Type', value: 'item-type'}
          ]
        },
        {
          name: 'highlightFadeFactor',
          label: 'Highlight',
          description: 'Background emphasis opacity',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.01,
          sliderDebounceMs: 75,
          defaultValue: 0.2
        }
      ]
    },
    {
      id: 'layout',
      name: 'Layout',
      settings: [
        {
          name: 'maxVisibleRowsUnlimited',
          label: 'Row Limit',
          description: 'Maximum rows per group before collapsing',
          type: 'boolean',
          defaultValue: true
        }
      ]
    },
    {
      id: 'dependencies',
      name: 'Dependencies',
      settings: [
        {
          name: 'localDependencyMode',
          label: 'Local',
          description: 'Same-level dependency visibility',
          type: 'select',
          defaultValue: 'warnings',
          options: ['all', 'warnings', 'none']
        },
        {
          name: 'lineRoutingMode',
          label: 'Shape',
          type: 'select',
          defaultValue: 'straight',
          options: [
            {label: 'Straight', value: 'straight'},
            {label: 'Arc', value: 'curve'}
          ]
        }
      ]
    }
  ]
};

const TEST_APPLICATION_SCHEMA: SettingsSchema = {
  sections: [
    {
      id: 'application',
      name: 'Application',
      settings: [
        {
          name: 'timezone',
          label: 'Timezone',
          description: 'Choose which timezone is used for timeline timestamps.',
          type: 'select',
          defaultValue: 'UTC',
          options: ['UTC', 'Local']
        }
      ]
    }
  ]
};

const TEST_SETTINGS: SettingsState = {
  colorSchemeId: 'category',
  highlightFadeFactor: 0.2,
  maxVisibleRowsUnlimited: true,
  localDependencyMode: 'warnings',
  lineRoutingMode: 'straight',
  timezone: 'UTC'
};

function renderStudioPanel(
  onSettingsChange = vi.fn(),
  props: Partial<Parameters<typeof StudioSettingsPanel>[0]> = {}
) {
  const root = document.createElement('div');
  document.body.append(root);
  render(
    <StudioSettingsPanel
      schema={TEST_SCHEMA}
      applicationSchema={TEST_APPLICATION_SCHEMA}
      settings={TEST_SETTINGS}
      onSettingsChange={onSettingsChange}
      {...props}
    />,
    root
  );
  return root;
}

function getButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function getButtonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('StudioSettingsPanel', () => {
  it('renders schema tabs and exposes a panel factory', () => {
    const root = renderStudioPanel();

    expect(root.textContent).toContain('Colors');
    expect(root.textContent).toContain('Layout');
    expect(root.textContent).toContain('Dependencies');
    expect(root.textContent).toContain('Visualization');
    expect(root.textContent).toContain('Application');
    expect(root.firstElementChild).toBeTruthy();

    const panel = createStudioSettingsPanel({
      schema: TEST_SCHEMA,
      settings: TEST_SETTINGS
    });
    expect(panel).toMatchObject({id: 'studio-settings-panel', title: 'Settings'});
    expect(panel.content).toBeTruthy();
  });

  it('renders application settings in a separate rail group', async () => {
    const onSettingsChange = vi.fn();
    const root = renderStudioPanel(onSettingsChange);

    getButtonByText('Application').click();
    await Promise.resolve();

    expect(root.textContent).toContain('Timezone');
    getButtonByLabel(root, 'Timezone').click();
    await Promise.resolve();
    getButtonByText('Local').click();
    await Promise.resolve();

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      {...TEST_SETTINGS, timezone: 'Local'},
      expect.arrayContaining([expect.objectContaining({name: 'timezone', nextValue: 'Local'})])
    );
  });

  it('collapses navigation into one scrollable settings pane and remembers the mode', async () => {
    const root = renderStudioPanel();
    const collapseToggle = getButtonByLabel(root, 'Collapse settings dialog');
    const header = root.querySelector('[data-studio-settings-drag-handle="true"]') as HTMLElement;

    expect(header.style.height).toBe('58px');
    expect(collapseToggle.getAttribute('aria-pressed')).toBe('false');
    expect(collapseToggle.textContent).toBe('Expanded');
    expect(getButtonByLabel(root, 'Close').getAttribute('data-modal-panel-container-close')).toBe(
      'true'
    );
    expect(root.querySelector('nav[aria-label="Visualization settings sections"]')).toBeTruthy();

    collapseToggle.click();
    await Promise.resolve();

    expect(getButtonByLabel(root, 'Expand settings dialog').textContent).toBe('Compact');
    expect(root.querySelector('nav[aria-label="Visualization settings sections"]')).toBeNull();
    expect(root.querySelector('main[aria-label="All settings sections"]')).toBeTruthy();
    expect(root.textContent).toContain('Item Colors');
    expect(root.textContent).toContain('Row Limit');
    expect(root.textContent).toContain('Timezone');
    expect(root.textContent).not.toContain('Color items by semantic category');
    expect(
      window.localStorage.getItem('deck.gl-community:studio-settings:navigation-collapsed')
    ).toBe('true');

    render(null, root);
    root.remove();
    const reopenedRoot = renderStudioPanel();
    await Promise.resolve();

    expect(getButtonByLabel(reopenedRoot, 'Expand settings dialog').textContent).toBe('Compact');
    getButtonByLabel(reopenedRoot, 'Expand settings dialog').click();
    await Promise.resolve();

    expect(getButtonByLabel(reopenedRoot, 'Collapse settings dialog')).toBeTruthy();
    expect(
      window.localStorage.getItem('deck.gl-community:studio-settings:navigation-collapsed')
    ).toBe('false');
  });

  it('lets callers size compact setting rows from their labels', async () => {
    const root = renderStudioPanel(vi.fn(), {settingRowLayout: 'fit-labels'});
    const expandedRow = getButtonByLabel(root, 'Item Colors').closest<HTMLElement>(
      '[data-studio-setting-row-layout]'
    );

    expect(expandedRow?.dataset.studioSettingRowLayout).toBe('fit-labels');
    expect(expandedRow?.style.gridTemplateColumns).toBe('max-content minmax(180px, 1fr)');

    getButtonByLabel(root, 'Collapse settings dialog').click();
    await Promise.resolve();

    const compactRow = getButtonByLabel(root, 'Item Colors').closest<HTMLElement>(
      '[data-studio-setting-row-layout]'
    );
    expect(compactRow?.style.gridTemplateColumns).toBe('max-content minmax(0px, 1fr)');
  });

  it('emits updated settings for select, boolean, and number controls', async () => {
    const onSettingsChange = vi.fn();
    const root = renderStudioPanel(onSettingsChange);

    getButtonByLabel(root, 'Item Colors').click();
    await Promise.resolve();
    getButtonByText('Item Type').click();
    await Promise.resolve();

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      {...TEST_SETTINGS, colorSchemeId: 'item-type'},
      expect.arrayContaining([
        expect.objectContaining({name: 'colorSchemeId', nextValue: 'item-type'})
      ])
    );

    const numberInput = root.querySelector(
      'input[aria-label="Highlight value"]'
    ) as HTMLInputElement;
    numberInput.value = '0.5';
    numberInput.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      {...TEST_SETTINGS, colorSchemeId: 'item-type', highlightFadeFactor: 0.5},
      expect.arrayContaining([
        expect.objectContaining({name: 'highlightFadeFactor', nextValue: 0.5})
      ])
    );

    getButtonByText('Layout').click();
    await Promise.resolve();
    getButtonByText('Enabled').click();
    await Promise.resolve();

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      {
        ...TEST_SETTINGS,
        colorSchemeId: 'item-type',
        highlightFadeFactor: 0.5,
        maxVisibleRowsUnlimited: false
      },
      expect.arrayContaining([
        expect.objectContaining({name: 'maxVisibleRowsUnlimited', nextValue: false})
      ])
    );
  });

  it('debounces range-slider setting changes while keeping the input responsive', async () => {
    vi.useFakeTimers();
    const onSettingsChange = vi.fn();
    const root = renderStudioPanel(onSettingsChange);

    const rangeInput = root.querySelector(
      'input[aria-label="Highlight slider"]'
    ) as HTMLInputElement;
    await act(async () => {
      rangeInput.value = '0.4';
      rangeInput.dispatchEvent(new Event('input', {bubbles: true}));
      await Promise.resolve();
    });

    expect(onSettingsChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(75);

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      {...TEST_SETTINGS, highlightFadeFactor: 0.4},
      expect.arrayContaining([
        expect.objectContaining({name: 'highlightFadeFactor', nextValue: 0.4})
      ])
    );
  });

  it('renders dependency shape toggles and updates lineRoutingMode on click', async () => {
    const onSettingsChange = vi.fn();
    const root = renderStudioPanel(onSettingsChange);

    getButtonByText('Dependencies').click();
    await Promise.resolve();

    expect(root.textContent).toContain('Straight');
    expect(root.textContent).toContain('Arc');
    expect(root.textContent).not.toContain('Step');
    expect(getButtonByText('Straight').getAttribute('aria-pressed')).toBe('true');
    expect(getButtonByText('Arc').getAttribute('aria-pressed')).toBe('false');

    getButtonByText('Arc').click();
    await Promise.resolve();

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      {...TEST_SETTINGS, lineRoutingMode: 'curve'},
      expect.arrayContaining([
        expect.objectContaining({name: 'lineRoutingMode', nextValue: 'curve'})
      ])
    );
  });
});
