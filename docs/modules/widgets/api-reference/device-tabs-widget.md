import WidgetLiveExample from '@site/src/components/docs/widget-live-example';

# DeviceTabsWidget

<WidgetLiveExample highlight="device-tabs-widget" />

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`DeviceTabsWidget` renders a compact backend dropdown for switching between reusable WebGPU and WebGL devices managed by [`DeviceManager`](./device-manager.md).

## Import

```ts
import {
  DeviceManager,
  DeviceTabsWidget,
  type DeviceTabsWidgetDevice,
  type DeviceTabsWidgetProps
} from '@deck.gl-community/widgets';
```

## Types

```ts
type DeviceTabsWidgetDevice = 'webgl2' | 'webgpu';

type DeviceTabsWidgetProps = WidgetProps & {
  devices?: DeviceTabsWidgetDevice[];
  placement?: WidgetPlacement;
  manager?: DeviceManagerController;
  autoInitialize?: boolean;
  onDeviceTypeChange?: (type: DeviceType) => void;
};
```

Default props:

- `id: 'device-tabs-widget'`
- `devices: ['webgl2', 'webgpu']`
- `placement: 'top-right'`
- `manager: DeviceManager`
- `autoInitialize: true`

## Usage

```ts
import {DeviceManager, DeviceTabsWidget} from '@deck.gl-community/widgets';

const widget = new DeviceTabsWidget({
  id: 'backend-tabs',
  placement: 'top-left',
  devices: ['webgpu', 'webgl2'],
  manager: DeviceManager
});
```

## Remarks

- Models its behavior on luma.gl's `DeviceTabs` UI while using the package-local `DeviceManager`.
- Automatically disables options for backends that cannot create a device in the current browser.
- Ensures the manager selects an allowed backend after checking availability. Hosts that initialize their own manager can set `autoInitialize: false`.
- Calls `manager.setDeviceType` on selection by default. A host that coordinates the backend with other example state can pass `onDeviceTypeChange` and apply the selection through its manager.
- Works with any `DeviceManagerController` instance, so apps can isolate backend state per surface if needed.
- Backend selection is separate from canvas placement; use `DeviceManager.reparentCanvas(...)` to move the managed canvas.
