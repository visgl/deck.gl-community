/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';

import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';
import {
  DeviceManager,
  type DeviceManagerController,
  type DeviceManagerState,
  type DeviceType
} from '../device-manager';

/** Backend labels accepted by {@link DeviceTabsWidget}. */
export type DeviceTabsWidgetDevice = 'webgl2' | 'webgpu';

/** Props for {@link DeviceTabsWidget}. */
export type DeviceTabsWidgetProps = WidgetProps & {
  /** Ordered list of backends exposed as tabs. */
  devices?: DeviceTabsWidgetDevice[];
  /** Widget placement anchor. */
  placement?: WidgetPlacement;
  /** Shared device manager instance that drives the widget state. */
  manager?: DeviceManagerController;
};

const DEFAULT_DEVICES: DeviceTabsWidgetDevice[] = ['webgl2', 'webgpu'];

const ROOT_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: '8px',
  pointerEvents: 'auto',
  userSelect: 'none'
};

const TAB_LIST_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  overflow: 'hidden',
  borderRadius: '8px',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)'
};

const TAB_BUTTON_STYLE: JSX.CSSProperties = {
  minWidth: '92px',
  minHeight: '36px',
  padding: '8px 14px',
  border: '0',
  borderRadius: '0',
  background: 'transparent',
  color: '#0f172a',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 700,
  whiteSpace: 'nowrap'
};

const TAB_BUTTON_SELECTED_STYLE: JSX.CSSProperties = {
  background: '#2563eb',
  color: '#ffffff'
};

const TAB_BUTTON_DISABLED_STYLE: JSX.CSSProperties = {
  color: 'rgba(15, 23, 42, 0.45)',
  cursor: 'not-allowed'
};

const MESSAGE_STYLE: JSX.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '8px',
  background: 'rgba(248, 250, 252, 0.96)',
  color: '#334155',
  fontSize: '12px',
  lineHeight: 1.4,
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.1)'
};

function stopDeviceTabsEventPropagation(event: Event): void {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation: () => void}).stopImmediatePropagation();
  }
}

function DeviceTabsWidgetView({
  deviceEntries,
  state,
  availability,
  onSelectDeviceType
}: {
  deviceEntries: Array<{id: DeviceType; title: string}>;
  state: DeviceManagerState;
  availability: Partial<Record<DeviceType, boolean>>;
  onSelectDeviceType: (deviceType: DeviceType) => void;
}) {
  const hasAvailableDevice = deviceEntries.some(entry => availability[entry.id] !== false);

  return (
    <div
      style={ROOT_STYLE}
      onPointerDown={stopDeviceTabsEventPropagation}
      onPointerMove={stopDeviceTabsEventPropagation}
      onPointerUp={stopDeviceTabsEventPropagation}
      onMouseDown={stopDeviceTabsEventPropagation}
      onMouseMove={stopDeviceTabsEventPropagation}
      onMouseUp={stopDeviceTabsEventPropagation}
      onTouchStart={stopDeviceTabsEventPropagation}
      onTouchMove={stopDeviceTabsEventPropagation}
      onTouchEnd={stopDeviceTabsEventPropagation}
      onClick={stopDeviceTabsEventPropagation}
      onContextMenu={stopDeviceTabsEventPropagation}
      onWheel={stopDeviceTabsEventPropagation}
    >
      <div style={TAB_LIST_STYLE} role="tablist" aria-label="Graphics backend">
        {deviceEntries.map(entry => {
          const isSelected = state.deviceType === entry.id;
          const isDisabled = availability[entry.id] === false;
          const label =
            availability[entry.id] === false ? `${entry.title} (unavailable)` : entry.title;

          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              data-device-tab-id={entry.id}
              aria-selected={isSelected ? 'true' : 'false'}
              aria-label={label}
              disabled={isDisabled}
              style={{
                ...TAB_BUTTON_STYLE,
                ...(isSelected ? TAB_BUTTON_SELECTED_STYLE : {}),
                ...(isDisabled ? TAB_BUTTON_DISABLED_STYLE : {})
              }}
              onClick={() => onSelectDeviceType(entry.id)}
            >
              {entry.title}
            </button>
          );
        })}
      </div>
      {!hasAvailableDevice ? (
        <div style={MESSAGE_STYLE} data-device-tabs-message="unavailable">
          No supported graphics backend is available.
        </div>
      ) : null}
      {state.deviceError ? (
        <div style={MESSAGE_STYLE} data-device-tabs-message="error">
          {state.deviceError}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Widget that exposes a compact WebGPU/WebGL tab switcher backed by {@link DeviceManager}.
 *
 * The widget mirrors the behavior of luma.gl's `DeviceTabs` UI while keeping device state in a
 * reusable manager that can also be consumed independently.
 */
export class DeviceTabsWidget extends Widget<DeviceTabsWidgetProps> {
  static defaultProps: Required<DeviceTabsWidgetProps> = {
    ...Widget.defaultProps,
    id: 'device-tabs-widget',
    devices: DEFAULT_DEVICES,
    placement: 'top-right',
    manager: DeviceManager
  };

  className = 'deck-widget-device-tabs';
  placement: WidgetPlacement = DeviceTabsWidget.defaultProps.placement;
  #devices: DeviceTabsWidgetDevice[] = DeviceTabsWidget.defaultProps.devices;
  #manager: DeviceManagerController = DeviceTabsWidget.defaultProps.manager;
  #availability: Partial<Record<DeviceType, boolean>> = {};
  #rootElement: HTMLElement | null = null;
  #unsubscribe: (() => void) | null = null;
  #availabilityRequest = 0;

  /** Creates a device tabs widget. */
  constructor(props: Partial<DeviceTabsWidgetProps> = {}) {
    super({
      ...DeviceTabsWidget.defaultProps,
      ...props
    } as DeviceTabsWidgetProps);
    this.setProps(this.props);
  }

  /** Updates widget configuration and refreshes backend availability. */
  setProps(props: Partial<DeviceTabsWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.devices !== undefined) {
      this.#devices = props.devices.length > 0 ? props.devices : DEFAULT_DEVICES;
    }
    if (props.manager && props.manager !== this.#manager) {
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#manager = props.manager;
    }

    this.#subscribeToManager();
    this.#refreshAvailability().catch(() => {});
    this.#render();
    super.setProps(props);
  }

  /** Starts listening to the shared manager when the widget is mounted. */
  onAdd(): void {
    this.#subscribeToManager();
    this.#refreshAvailability().catch(() => {});
  }

  /** Removes manager subscriptions and unmounts the internal Preact view. */
  onRemove(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  /** Renders the widget into the supplied host element. */
  onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    rootElement.style.margin = '0';
    this.#subscribeToManager();
    this.#render();
  }

  #subscribeToManager(): void {
    if (this.#unsubscribe) {
      return;
    }

    this.#unsubscribe = this.#manager.subscribe(() => {
      this.#render();
    });
  }

  async #refreshAvailability(): Promise<void> {
    const request = ++this.#availabilityRequest;
    const allowedDeviceTypes = getAllowedDeviceTypes(this.#devices);

    const availabilityEntries = await Promise.all(
      allowedDeviceTypes.map(
        async deviceType =>
          [deviceType, await this.#manager.canCreateDeviceType(deviceType)] as const
      )
    );

    if (request !== this.#availabilityRequest) {
      return;
    }

    this.#availability = Object.fromEntries(availabilityEntries);
    this.#render();
    await this.#manager.ensureDeviceType(allowedDeviceTypes);
  }

  #handleSelectDeviceType = (deviceType: DeviceType) => {
    if (this.#availability[deviceType] === false) {
      return;
    }

    this.#manager.setDeviceType(deviceType).catch(() => {});
  };

  #render(): void {
    if (!this.#rootElement) {
      return;
    }

    render(
      <DeviceTabsWidgetView
        deviceEntries={getDeviceEntries(this.#devices)}
        state={this.#manager.getState()}
        availability={this.#availability}
        onSelectDeviceType={this.#handleSelectDeviceType}
      />,
      this.#rootElement
    );
  }
}

function getAllowedDeviceTypes(devices: readonly DeviceTabsWidgetDevice[]): DeviceType[] {
  const deviceTypes = devices.map(device => (device === 'webgl2' ? 'webgl' : 'webgpu'));
  return deviceTypes.filter((deviceType, index) => deviceTypes.indexOf(deviceType) === index);
}

function getDeviceEntries(
  devices: readonly DeviceTabsWidgetDevice[]
): Array<{id: DeviceType; title: string}> {
  return getAllowedDeviceTypes(devices).map(deviceType => ({
    id: deviceType,
    title: deviceType === 'webgl' ? 'WebGL2' : 'WebGPU'
  }));
}
