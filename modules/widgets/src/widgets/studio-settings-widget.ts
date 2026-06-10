import {createStudioSettingsPanel} from '@deck.gl-community/panels';

import {ModalPanelWidget} from '../panel-widgets/panel-widget';

import type {StudioSettingsPanelProps} from '@deck.gl-community/panels';
import type {ModalPanelWidgetProps} from '../panel-widgets/panel-widget';
import type {JSX} from 'preact';

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

/** Builds modal widget props around the panel-owned Studio settings surface. */
function buildStudioSettingsWidgetProps(props: StudioSettingsWidgetProps): ModalPanelWidgetProps {
  const {
    schema,
    applicationSchema,
    fontFamily,
    settings,
    onSettingsChange,
    presetLabel,
    settingRowLayout,
    ...widgetProps
  } = props;
  const title = props.title ?? 'Settings';

  return {
    ...widgetProps,
    id: props.id ?? 'studio-settings',
    placement: props.placement ?? 'top-left',
    title,
    dialogPlacement: props.dialogPlacement ?? 'left',
    triggerLabel: props.triggerLabel ?? title,
    triggerIcon: STUDIO_SETTINGS_TRIGGER_ICON,
    dialogStyle: {...STUDIO_SETTINGS_DIALOG_STYLE, ...props.dialogStyle},
    contentStyle: {...STUDIO_SETTINGS_CONTENT_STYLE, ...props.contentStyle},
    showTitleBar: false,
    hideCloseButton: true,
    presentation: 'floating',
    draggable: true,
    dragHandleSelector: STUDIO_SETTINGS_DRAG_HANDLE_SELECTOR,
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

const STUDIO_SETTINGS_DRAG_HANDLE_SELECTOR = '[data-studio-settings-drag-handle="true"]';
const STUDIO_SETTINGS_TRIGGER_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1a7.2 7.2 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.6-.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>'
)}`;
const STUDIO_SETTINGS_DIALOG_STYLE: JSX.CSSProperties = {
  maxWidth: 'calc(100vw - 48px)'
};
const STUDIO_SETTINGS_CONTENT_STYLE: JSX.CSSProperties = {
  padding: 0,
  overflow: 'visible'
};
