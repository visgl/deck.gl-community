// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createStudioSettingsPanel} from '@deck.gl-community/panels';

import {ModalPanelWidget} from './modal-widget';

import type {StudioSettingsPanelProps} from '@deck.gl-community/panels';
import type {ModalPanelWidgetProps} from './modal-widget';
import type {JSX} from 'preact';

const STUDIO_SETTINGS_DRAG_HANDLE_SELECTOR = '[data-studio-settings-drag-handle="true"]';
const STUDIO_SETTINGS_DIALOG_STYLE: JSX.CSSProperties = {
  maxWidth: 'calc(100vw - 48px)'
};
const STUDIO_SETTINGS_CONTENT_STYLE: JSX.CSSProperties = {
  padding: 0,
  overflow: 'visible'
};

/** Props accepted by the floating Studio settings deck widget factory. */
export type StudioSettingsWidgetProps = StudioSettingsPanelProps &
  Omit<ModalPanelWidgetProps, 'panel'>;

/** Creates a floating deck widget that hosts the Studio settings panel. */
export function createStudioSettingsWidget(props: StudioSettingsWidgetProps): ModalPanelWidget {
  return new ModalPanelWidget(buildStudioSettingsWidgetProps(props));
}

/** Updates an existing Studio settings widget without replacing the deck widget instance. */
export function updateStudioSettingsWidget(
  widget: ModalPanelWidget,
  props: StudioSettingsWidgetProps
): void {
  widget.setProps(buildStudioSettingsWidgetProps(props));
}

function buildStudioSettingsWidgetProps(props: StudioSettingsWidgetProps): ModalPanelWidgetProps {
  const {
    schema,
    applicationSchema,
    fontFamily,
    settings,
    onSettingsChange,
    presetLabel,
    settingRowLayout,
    ...modalProps
  } = props;
  const title = modalProps.title ?? 'Settings';
  return {
    ...modalProps,
    id: modalProps.id ?? 'studio-settings',
    placement: modalProps.placement ?? 'top-left',
    title,
    dialogPlacement: modalProps.dialogPlacement ?? 'left',
    triggerLabel: modalProps.triggerLabel ?? title,
    dialogStyle: {
      ...STUDIO_SETTINGS_DIALOG_STYLE,
      ...modalProps.dialogStyle
    },
    contentStyle: {
      ...STUDIO_SETTINGS_CONTENT_STYLE,
      ...modalProps.contentStyle
    },
    showTitleBar: modalProps.showTitleBar ?? false,
    hideCloseButton: modalProps.hideCloseButton ?? true,
    presentation: modalProps.presentation ?? 'floating',
    draggable: modalProps.draggable ?? true,
    dragHandleSelector: modalProps.dragHandleSelector ?? STUDIO_SETTINGS_DRAG_HANDLE_SELECTOR,
    panel: createStudioSettingsPanel({
      schema,
      applicationSchema,
      fontFamily,
      settings,
      onSettingsChange,
      presetLabel,
      settingRowLayout
    })
  };
}
