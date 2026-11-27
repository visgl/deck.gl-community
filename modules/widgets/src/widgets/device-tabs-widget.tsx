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
} from '../lib/device-manager/device-manager';

/** Backend labels accepted by {@link DeviceTabsWidget}. */
export type DeviceTabsWidgetDevice = 'webgl2' | 'webgpu';

/** Props for {@link DeviceTabsWidget}. */
export type DeviceTabsWidgetProps = WidgetProps & {
  /** Ordered list of backends shown in the dropdown. */
  devices?: DeviceTabsWidgetDevice[];
  /** Widget placement anchor. */
  placement?: WidgetPlacement;
  /** Shared device manager instance that drives the widget state. */
  manager?: DeviceManagerController;
  /** Whether the widget should ensure an allowed device is selected. Defaults to true. */
  autoInitialize?: boolean;
  /** Handle a selection in the host when it coordinates other example state with the backend. */
  onDeviceTypeChange?: (type: DeviceType) => void;
};

const DEFAULT_DEVICES: DeviceTabsWidgetDevice[] = ['webgl2', 'webgpu'];

const ROOT_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: '8px',
  pointerEvents: 'auto',
  userSelect: 'none'
};

const SELECT_WRAPPER_STYLE: JSX.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignSelf: 'flex-end',
  alignItems: 'center',
  color: 'var(--deck-device-accent, #7dd3fc)'
};

const SELECT_STYLE: JSX.CSSProperties = {
  appearance: 'none',
  minHeight: '44px',
  padding: '6px 30px 6px 26px',
  border: '1px solid var(--deck-device-border, rgba(148, 163, 184, 0.24))',
  borderRadius: '9px',
  background: 'var(--deck-device-surface, #080f1b)',
  color: 'inherit',
  colorScheme: 'dark',
  boxShadow: '0 8px 22px rgba(0, 0, 0, 0.2)',
  cursor: 'pointer',
  fontFamily: 'var(--deck-device-font-family, system-ui, sans-serif)',
  fontSize: '13px',
  fontWeight: 650
};

const INDICATOR_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  left: '11px',
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  background: 'currentColor',
  pointerEvents: 'none'
};

const CARET_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  right: '12px',
  width: '6px',
  height: '6px',
  borderRight: '1.5px solid currentColor',
  borderBottom: '1.5px solid currentColor',
  transform: 'translateY(-2px) rotate(45deg)',
  pointerEvents: 'none'
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
  const selectedDevice = deviceEntries.find(entry => entry.id === state.deviceType)?.id ?? '';

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
      <div style={SELECT_WRAPPER_STYLE}>
        <span style={INDICATOR_STYLE} aria-hidden="true" />
        <select
          style={SELECT_STYLE}
          aria-label="Graphics backend"
          aria-busy={state.isLoading}
          value={selectedDevice}
          onChange={event => {
            const select = event.currentTarget;
            const requestedDevice = deviceEntries.find(entry => entry.id === select.value);
            // Keep showing the running device until the manager confirms the switch.
            select.value = selectedDevice;
            if (requestedDevice) {
              onSelectDeviceType(requestedDevice.id);
            }
          }}
        >
          <option value="" disabled hidden>
            {state.isLoading ? 'Selecting backend…' : 'Graphics backend'}
          </option>
          {deviceEntries.map(entry => (
            <option key={entry.id} value={entry.id} disabled={availability[entry.id] === false}>
              {entry.title}
              {availability[entry.id] === false ? ' (N/A)' : ''}
            </option>
          ))}
        </select>
        <span style={CARET_STYLE} aria-hidden="true" />
      </div>
      {!hasAvailableDevice ? (
        <div style={MESSAGE_STYLE} data-device-tabs-message="unavailable">
          No supported graphics backend is available.
        </div>
      ) : null}
      {state.deviceError ? (
        <div style={MESSAGE_STYLE} role="alert" data-device-tabs-message="error">
          {state.deviceError}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Widget that exposes a compact WebGPU/WebGL dropdown backed by {@link DeviceManager}.
 *
 * The widget mirrors the behavior of luma.gl's `DeviceTabs` UI while keeping device state in a
 * reusable manager that can also be consumed independently.
 */
export class DeviceTabsWidget extends Widget<DeviceTabsWidgetProps> {
  static defaultProps: Required<Omit<DeviceTabsWidgetProps, 'onDeviceTypeChange'>> = {
    ...Widget.defaultProps,
    id: 'device-tabs-widget',
    devices: DEFAULT_DEVICES,
    placement: 'top-right',
    manager: DeviceManager,
    autoInitialize: true
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

    super.setProps(props);
    this.#subscribeToManager();
    this.#refreshAvailability().catch(() => {});
    this.#render();
  }

  /** Starts listening to the shared manager when the widget is mounted. */
  onAdd(): void {
    this.#subscribeToManager();
    this.#refreshAvailability().catch(() => {});
  }

  /** Removes manager subscriptions and unmounts the internal Preact view. */
  onRemove(): void {
    this.#availabilityRequest++;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#rootElement) {
      render(null, this.#rootElement);
      this.#rootElement = null;
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
    if (this.props.autoInitialize) {
      await this.#manager.ensureDeviceType(allowedDeviceTypes);
    }
  }

  #handleSelectDeviceType = (deviceType: DeviceType) => {
    if (this.#availability[deviceType] === false) {
      return;
    }

    if (this.props.onDeviceTypeChange) {
      this.props.onDeviceTypeChange(deviceType);
    } else {
      this.#manager.setDeviceType(deviceType).catch(() => {});
    }
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
