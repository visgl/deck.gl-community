import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';

const DEVICE_TYPE_STORAGE_KEY = 'deck.gl-community-device-type';
const DEFAULT_DEVICE_TYPE: DeviceType = 'webgpu';
const FALLBACK_DEVICE_TYPE_ORDER: DeviceType[] = ['webgpu', 'webgl'];

export type DeviceType = 'webgl' | 'webgpu';

export type DeviceManagerState = {
  deviceType?: DeviceType;
  device?: Device;
  deviceError?: string;
  isLoading: boolean;
};

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

  getState(): DeviceManagerState {
    return {...this.#state};
  }

  subscribe(listener: (state: DeviceManagerState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getCanvasParent(): HTMLElement {
    if (!this.#canvasParent) {
      return this.getHiddenCanvasParent();
    }
    return this.#canvasParent;
  }

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

  async getDevice(type: DeviceType = this.#state.deviceType ?? DEFAULT_DEVICE_TYPE) {
    return await this.createDevice(type);
  }

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

  async initialize(): Promise<DeviceType | undefined> {
    return await this.ensureDeviceType(this.#getDefaultPreferredDeviceTypes());
  }

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
          .then((device) => {
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
