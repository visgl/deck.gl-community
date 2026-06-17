import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';

const DEVICE_TYPE_STORAGE_KEY = 'deck.gl-community-device-type';
const DEFAULT_DEVICE_TYPE: DeviceType = 'webgpu';
const FALLBACK_DEVICE_TYPE_ORDER: DeviceType[] = ['webgpu', 'webgl'];

/** Supported rendering backends managed by {@link DeviceManagerController}. */
export type DeviceType = 'webgl' | 'webgpu';

/**
 * Snapshot of the shared device manager state.
 *
 * Applications can read this synchronously with {@link DeviceManagerController.getState}
 * or observe updates with {@link DeviceManagerController.subscribe}.
 */
export type DeviceManagerState = {
  /** Currently selected backend, if any. */
  deviceType?: DeviceType;
  /** Reusable luma device for the selected backend. */
  device?: Device;
  /** Last device creation error for the selected backend. */
  deviceError?: string;
  /** Whether the manager is currently resolving or switching devices. */
  isLoading: boolean;
};

/**
 * Shared controller that chooses between WebGPU and WebGL and caches one reusable device per backend.
 *
 * This is modeled on luma.gl's `DeviceTabs` store, but uses a small imperative subscription
 * surface rather than Zustand.
 */
export class DeviceManagerController {
  #state: DeviceManagerState = {
    deviceType: undefined,
    device: undefined,
    deviceError: undefined,
    isLoading: false
  };

  #listeners = new Set<(state: DeviceManagerState) => void>();
  #cachedDevices: Partial<Record<DeviceType, Promise<Device>>> = {};
  #cachedDeviceAvailability: Partial<Record<DeviceType, Promise<boolean>>> = {};
  #requestGeneration = 0;
  #canvasParent: HTMLElement | null = null;
  #hiddenCanvasParent: HTMLDivElement | null = null;

  /** Returns a copy of the current manager state. */
  getState(): DeviceManagerState {
    return {...this.#state};
  }

  /**
   * Subscribes to state changes.
   *
   * @param listener Called whenever the manager state changes.
   * @returns Unsubscribe function.
   */
  subscribe(listener: (state: DeviceManagerState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Returns the preferred canvas parent for the managed device canvas.
   *
   * Falls back to the hidden cache container until a visible parent is assigned.
   */
  getCanvasParent(): HTMLElement {
    if (!this.#canvasParent) {
      return this.getHiddenCanvasParent();
    }
    return this.#canvasParent;
  }

  /**
   * Returns the hidden container used to keep cached canvases attached to the DOM.
   *
   * The container is created lazily on first access.
   */
  getHiddenCanvasParent(): HTMLDivElement {
    if (!this.#hiddenCanvasParent) {
      const container = document.createElement('div');
      container.dataset.deviceManagerCanvasParent = 'true';
      container.style.display = 'none';
      document.body.append(container);
      this.#hiddenCanvasParent = container;
    }

    return this.#hiddenCanvasParent;
  }

  /**
   * Creates or returns the cached reusable device for one backend.
   *
   * @param type Backend to create.
   */
  async createDevice(type: DeviceType): Promise<Device> {
    const devicePromise =
      this.#cachedDevices[type] !== undefined
        ? this.#cachedDevices[type]
        : luma.createDevice({
            adapters: [webgl2Adapter, webgpuAdapter],
            type,
            debugGPUTime: true,
            createCanvasContext: {
              container: this.getHiddenCanvasParent(),
              alphaMode: 'opaque'
            }
          });
    this.#cachedDevices[type] = devicePromise;

    return await devicePromise;
  }

  /**
   * Returns a cached device, creating it if needed.
   *
   * @param type Backend to resolve. Defaults to the selected backend or the default preferred backend.
   */
  async getDevice(type: DeviceType = this.#state.deviceType ?? DEFAULT_DEVICE_TYPE) {
    return await this.createDevice(type);
  }

  /**
   * Checks whether one backend can create a reusable device in the current environment.
   *
   * Results are cached per backend.
   */
  async canCreateDeviceType(type: DeviceType): Promise<boolean> {
    const availabilityPromise =
      this.#cachedDeviceAvailability[type] !== undefined
        ? this.#cachedDeviceAvailability[type]
        : (async () => {
            try {
              await this.createDevice(type);
              return true;
            } catch {
              return false;
            }
          })();
    this.#cachedDeviceAvailability[type] = availabilityPromise;

    return await availabilityPromise;
  }

  /**
   * Returns the first available backend from a preferred order.
   *
   * @param preferredTypes Backend preference order.
   */
  async getPreferredAvailableDeviceType(
    preferredTypes: readonly DeviceType[]
  ): Promise<DeviceType | undefined> {
    for (const type of preferredTypes) {
      if (await this.canCreateDeviceType(type)) {
        return type;
      }
    }

    return undefined;
  }

  /**
   * Initializes the manager using the persisted backend preference when available.
   *
   * Falls back to WebGPU, then WebGL.
   */
  async initialize(): Promise<DeviceType | undefined> {
    return await this.ensureDeviceType(this.#getDefaultPreferredDeviceTypes());
  }

  /**
   * Ensures that the active backend is one of the allowed preferred backends.
   *
   * If the current backend is unavailable or disallowed, the manager switches to the first
   * available backend in `preferredTypes`.
   */
  async ensureDeviceType(preferredTypes: readonly DeviceType[]): Promise<DeviceType | undefined> {
    const currentDeviceType = this.#state.deviceType;

    if (
      currentDeviceType &&
      preferredTypes.includes(currentDeviceType) &&
      (await this.canCreateDeviceType(currentDeviceType))
    ) {
      if (!this.#state.device) {
        await this.setDeviceType(currentDeviceType);
      }
      return currentDeviceType;
    }

    const preferredDeviceType = await this.getPreferredAvailableDeviceType(preferredTypes);
    if (!preferredDeviceType) {
      return undefined;
    }

    await this.setDeviceType(preferredDeviceType);
    return preferredDeviceType;
  }

  /**
   * Selects one backend, creates its reusable device, and publishes the resulting state.
   *
   * The chosen backend is persisted to local storage for future sessions.
   */
  async setDeviceType(type: DeviceType): Promise<Device | undefined> {
    const requestGeneration = ++this.#requestGeneration;

    this.#setState({
      deviceType: type,
      device: undefined,
      deviceError: undefined,
      isLoading: true
    });

    let device: Device | undefined;
    let deviceError: string | undefined;

    try {
      device = await this.createDevice(type);
    } catch (error) {
      deviceError = getErrorMessage(error);
    }

    this.#storeDeviceType(type);

    if (requestGeneration !== this.#requestGeneration) {
      return device;
    }

    if (device) {
      this.reparentCanvas(this.#canvasParent, device);
    }

    this.#setState({
      deviceType: type,
      device,
      deviceError,
      isLoading: false
    });

    return device;
  }

  /**
   * Reparents the managed canvas into a new DOM container.
   *
   * @param parentElement Destination parent. Pass `null` to move the canvas back into the hidden cache container.
   * @param deviceOrType Optional device instance or backend type. When omitted, the current selected device is used.
   * @returns The canvas when it was synchronously available.
   */
  reparentCanvas(
    parentElement: HTMLElement | null,
    deviceOrType?: Device | DeviceType
  ): HTMLCanvasElement | OffscreenCanvas | undefined {
    this.#canvasParent = parentElement;
    const resolvedParent = parentElement ?? this.getHiddenCanvasParent();

    if (typeof deviceOrType === 'string') {
      const cachedDevice = this.#cachedDevices[deviceOrType];
      if (cachedDevice !== undefined) {
        cachedDevice
          .then(device => {
            this.#reparentDeviceCanvas(device, resolvedParent);
          })
          .catch(() => {});
      }
      return undefined;
    }

    const device = deviceOrType ?? this.#state.device;
    if (!device) {
      return undefined;
    }

    return this.#reparentDeviceCanvas(device, resolvedParent);
  }

  /**
   * Clears cached devices, DOM state, and subscriptions.
   *
   * Primarily intended for tests and controlled teardown.
   */
  reset(): void {
    this.#state = {
      deviceType: undefined,
      device: undefined,
      deviceError: undefined,
      isLoading: false
    };
    this.#cachedDevices = {};
    this.#cachedDeviceAvailability = {};
    this.#requestGeneration = 0;
    this.#canvasParent = null;
    this.#hiddenCanvasParent?.remove();
    this.#hiddenCanvasParent = null;
    this.#emitState();
  }

  #setState(nextState: DeviceManagerState): void {
    this.#state = nextState;
    this.#emitState();
  }

  #emitState(): void {
    const state = this.getState();
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  #reparentDeviceCanvas(
    device: Device,
    parentElement: HTMLElement
  ): HTMLCanvasElement | OffscreenCanvas | undefined {
    const canvas = getDeviceCanvas(device);
    if (!canvas) {
      return undefined;
    }

    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      canvas instanceof HTMLCanvasElement &&
      canvas.parentElement !== parentElement
    ) {
      parentElement.append(canvas);
    }

    return canvas;
  }

  #getDefaultPreferredDeviceTypes(): DeviceType[] {
    const storedDeviceType = this.#getStoredDeviceType();
    return dedupeDeviceTypes([
      ...(storedDeviceType ? [storedDeviceType] : []),
      ...FALLBACK_DEVICE_TYPE_ORDER
    ]);
  }

  #getStoredDeviceType(): DeviceType | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const storedDeviceType = window.localStorage.getItem(DEVICE_TYPE_STORAGE_KEY);
    return storedDeviceType === 'webgl' || storedDeviceType === 'webgpu'
      ? storedDeviceType
      : undefined;
  }

  #storeDeviceType(type: DeviceType): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEVICE_TYPE_STORAGE_KEY, type);
    }
  }
}

/** Shared application-level device manager singleton. */
export const DeviceManager = new DeviceManagerController();

function dedupeDeviceTypes(deviceTypes: readonly DeviceType[]): DeviceType[] {
  return deviceTypes.filter((deviceType, index) => deviceTypes.indexOf(deviceType) === index);
}

function getDeviceCanvas(device: Device): HTMLCanvasElement | OffscreenCanvas | undefined {
  try {
    return device.getDefaultCanvasContext().canvas;
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
