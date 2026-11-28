# DeviceManager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`DeviceManager` is a shared controller that selects either WebGPU or WebGL, creates one reusable luma device per backend, and can reparent the managed canvas between DOM containers.

## Import

```ts
import {
  DeviceManager,
  DeviceManagerController,
  type DeviceManagerOptions,
  type DeviceManagerState,
  type DeviceType
} from '@deck.gl-community/widgets';
```

## Types

```ts
type DeviceType = 'webgl' | 'webgpu';

type DeviceManagerOptions = Pick<DeviceProps, 'optionalFeatures'> & {
  canvasContext?: Omit<CanvasContextProps, 'canvas' | 'container'>;
  persistPreference?: boolean;
};

type DeviceManagerState = {
  deviceType?: DeviceType;
  device?: Device;
  deviceError?: string;
  isLoading: boolean;
};
```

## Surface

```ts
class DeviceManagerController {
  constructor(options?: DeviceManagerOptions);
  getState(): DeviceManagerState;
  subscribe(listener: (state: DeviceManagerState) => void): () => void;
  getCanvasParent(): HTMLElement;
  getHiddenCanvasParent(): HTMLDivElement;
  createDevice(type: DeviceType): Promise<Device>;
  getDevice(type?: DeviceType): Promise<Device>;
  canCreateDeviceType(type: DeviceType): Promise<boolean>;
  getPreferredAvailableDeviceType(
    preferredTypes: readonly DeviceType[]
  ): Promise<DeviceType | undefined>;
  initialize(allowedTypes?: readonly DeviceType[]): Promise<DeviceType | undefined>;
  ensureDeviceType(preferredTypes: readonly DeviceType[]): Promise<DeviceType | undefined>;
  setDeviceType(type: DeviceType): Promise<Device | undefined>;
  reparentCanvas(
    parentElement: HTMLElement | null,
    deviceOrType?: Device | DeviceType
  ): HTMLCanvasElement | OffscreenCanvas | undefined;
  reset(): void;
}
```

`DeviceManager` is the package-level singleton:

```ts
const DeviceManager: DeviceManagerController;
```

## Usage

```ts
import {DeviceManager} from '@deck.gl-community/widgets';

const canvasHost = document.getElementById('canvas-host') as HTMLElement;

await DeviceManager.initialize();
await DeviceManager.setDeviceType('webgpu');
DeviceManager.reparentCanvas(canvasHost);

const {device} = DeviceManager.getState();
```

## Remarks

- Caches one reusable device per backend, so switching does not recreate devices after the first successful initialization.
- Restores the saved backend on `initialize()` when it is available and allowed. Set `persistPreference: false` to make selection local to the controller.
- Keeps the current device and reports `deviceError` if a requested switch fails.
- Accepts canvas settings and optional feature requests for the devices it creates. Call `reset()` after finalizing the renderer to release all managed devices and canvases.
- Uses a hidden DOM container to hold cached canvases until they are attached to a visible parent.
- Exposes an imperative subscription API instead of a state-library dependency.
- Can be used without `DeviceTabsWidget` when the application wants its own backend-selection UI.
