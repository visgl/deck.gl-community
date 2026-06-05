import {describe, expect, it} from 'vitest';

import {createStudioSettingsWidget, updateStudioSettingsWidget} from './studio-settings-widget';

import type {SettingsSchema, SettingsState} from '@deck.gl-community/panels';

const TEST_SCHEMA: SettingsSchema = {
  sections: [
    {
      id: 'display',
      name: 'Display',
      settings: [
        {
          name: 'showGrid',
          label: 'Show grid',
          type: 'boolean',
          defaultValue: true
        }
      ]
    }
  ]
};

const TEST_SETTINGS: SettingsState = {
  showGrid: true
};

describe('createStudioSettingsWidget', () => {
  it('creates a non-blocking floating modal widget around StudioSettingsPanel', () => {
    const widget = createStudioSettingsWidget({
      schema: TEST_SCHEMA,
      settings: TEST_SETTINGS
    });

    expect(widget.props.presentation).toBe('floating');
    expect(widget.props.dialogPlacement).toBe('left');
    expect(widget.props.title).toBe('Settings');
    expect(widget.props.triggerLabel).toBe('Settings');
    expect(widget.props.hideCloseButton).toBe(true);
    expect(widget.props.draggable).toBe(true);
    expect(widget.props.dragHandleSelector).toBe('[data-studio-settings-drag-handle="true"]');
    expect(widget.props.dialogStyle).toMatchObject({maxWidth: 'calc(100vw - 48px)'});
    expect(widget.props.contentStyle).toMatchObject({padding: 0, overflow: 'visible'});
    expect(widget.props.panel?.id).toBe('studio-settings-panel');
  });

  it('updates an existing widget without replacing the instance', () => {
    const widget = createStudioSettingsWidget({
      schema: TEST_SCHEMA,
      settings: TEST_SETTINGS
    });

    updateStudioSettingsWidget(widget, {
      schema: TEST_SCHEMA,
      settings: {...TEST_SETTINGS, showGrid: false},
      title: 'Display settings',
      triggerLabel: 'Display'
    });

    expect(widget.props.title).toBe('Display settings');
    expect(widget.props.triggerLabel).toBe('Display');
    expect(widget.props.panel?.content).toBeTruthy();
  });

  it('forwards Studio row layout without leaking it into modal props', () => {
    const widget = createStudioSettingsWidget({
      schema: TEST_SCHEMA,
      settings: TEST_SETTINGS,
      settingRowLayout: 'fit-labels'
    });
    const panelContent = widget.props.panel?.content as {props?: {settingRowLayout?: string}};

    expect(panelContent.props?.settingRowLayout).toBe('fit-labels');
    expect((widget.props as Record<string, unknown>).settingRowLayout).toBeUndefined();
  });
});
