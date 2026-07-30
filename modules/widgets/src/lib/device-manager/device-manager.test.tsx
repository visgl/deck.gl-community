import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Device} from '@luma.gl/core';
import {DeviceManagerController} from './device-manager';

const createDeviceMock = vi.hoisted(() => vi.fn());

vi.mock('@luma.gl/core', () => ({
  luma: {
    createDevice: createDeviceMock
  }
}));

vi.mock('@luma.gl/webgl', () => ({
  webgl2Adapter: {type: 'webgl'}
}));

vi.mock('@luma.gl/webgpu', () => ({
  webgpuAdapter: {type: 'webgpu'}
}));

function createMockDevice(label: string): Device {
  const canvas = document.createElement('canvas');
  canvas.dataset.deviceLabel = label;

  return {
    destroy: vi.fn(),
    getDefaultCanvasContext: () => ({
      canvas
    })
  } as unknown as Device;
}

describe('DeviceManagerController', () => {
  let manager: DeviceManagerController;

  beforeEach(() => {
    manager = new DeviceManagerController();
    createDeviceMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    manager.reset();
    document.body.innerHTML = '';
  });

  it('caches created devices per backend type', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    createDeviceMock.mockResolvedValue(webgpuDevice);

    const firstDevice = await manager.createDevice('webgpu');
    const secondDevice = await manager.createDevice('webgpu');

    expect(firstDevice).toBe(webgpuDevice);
    expect(secondDevice).toBe(webgpuDevice);
    expect(createDeviceMock).toHaveBeenCalledTimes(1);
  });

  it('updates state and reparents the active canvas', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    createDeviceMock.mockResolvedValue(webgpuDevice);
    const target = document.createElement('div');
    document.body.append(target);

    manager.reparentCanvas(target);
    await manager.setDeviceType('webgpu');

    expect(manager.getState().deviceType).toBe('webgpu');
    expect(manager.getState().device).toBe(webgpuDevice);
    expect(target.querySelector('canvas')?.dataset.deviceLabel).toBe('webgpu');
    expect(window.localStorage.getItem('deck.gl-community-device-type')).toBe('webgpu');
  });

  it('keeps the requested parent when switching between device types', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    const webglDevice = createMockDevice('webgl');
    createDeviceMock.mockImplementation(({type}: {type: 'webgl' | 'webgpu'}) =>
      Promise.resolve(type === 'webgpu' ? webgpuDevice : webglDevice)
    );
    const target = document.createElement('div');
    document.body.append(target);

    manager.reparentCanvas(target);
    await manager.setDeviceType('webgpu');
    await manager.setDeviceType('webgl');

    expect(target.lastElementChild).toBe(webglDevice.getDefaultCanvasContext().canvas as Element);
  });

  it('reports failing device creation attempts', async () => {
    createDeviceMock.mockRejectedValue(new Error('WebGPU unavailable'));

    const device = await manager.setDeviceType('webgpu');

    expect(device).toBeUndefined();
    expect(manager.getState().deviceError).toBe('WebGPU unavailable');
    expect(manager.getState().isLoading).toBe(false);
  });

  it('initializes WebGPU first when no backend preference is stored', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    createDeviceMock.mockResolvedValue(webgpuDevice);

    await expect(manager.initialize()).resolves.toBe('webgpu');
    expect(manager.getState().device).toBe(webgpuDevice);
    expect(createDeviceMock).toHaveBeenCalledTimes(1);
  });

  it('restores the persisted backend preference', async () => {
    const webglDevice = createMockDevice('webgl');
    window.localStorage.setItem('deck.gl-community-device-type', 'webgl');
    createDeviceMock.mockResolvedValue(webglDevice);

    await expect(manager.initialize()).resolves.toBe('webgl');
    expect(manager.getState().device).toBe(webglDevice);
    expect(createDeviceMock).toHaveBeenCalledWith(expect.objectContaining({type: 'webgl'}));
  });

  it('falls back to WebGL when WebGPU is unavailable', async () => {
    const webglDevice = createMockDevice('webgl');
    createDeviceMock.mockImplementation(({type}: {type: 'webgl' | 'webgpu'}) =>
      type === 'webgpu'
        ? Promise.reject(new Error('WebGPU unavailable'))
        : Promise.resolve(webglDevice)
    );

    await expect(manager.initialize()).resolves.toBe('webgl');
    expect(manager.getState().device).toBe(webglDevice);
    expect(manager.getState().deviceError).toBeUndefined();
  });

  it('keeps device caches independent between managers', async () => {
    const firstDevice = createMockDevice('first');
    const secondDevice = createMockDevice('second');
    createDeviceMock.mockResolvedValueOnce(firstDevice).mockResolvedValueOnce(secondDevice);
    const secondManager = new DeviceManagerController();

    await expect(manager.createDevice('webgpu')).resolves.toBe(firstDevice);
    await expect(secondManager.createDevice('webgpu')).resolves.toBe(secondDevice);
    expect(createDeviceMock).toHaveBeenCalledTimes(2);

    secondManager.reset();
  });

  it('reuses cached devices when switching repeatedly between backends', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    const webglDevice = createMockDevice('webgl');
    createDeviceMock.mockImplementation(({type}: {type: 'webgl' | 'webgpu'}) =>
      Promise.resolve(type === 'webgpu' ? webgpuDevice : webglDevice)
    );

    await manager.setDeviceType('webgpu');
    await manager.setDeviceType('webgl');
    await manager.setDeviceType('webgpu');

    expect(manager.getState().deviceType).toBe('webgpu');
    expect(manager.getState().device).toBe(webgpuDevice);
    expect(createDeviceMock).toHaveBeenCalledTimes(2);
  });

  it('clears managed state and its hidden canvas parent on reset', async () => {
    createDeviceMock.mockResolvedValue(createMockDevice('webgpu'));
    await manager.setDeviceType('webgpu');

    expect(document.body.querySelector('[data-device-manager-canvas-parent]')).not.toBeNull();

    manager.reset();

    expect(manager.getState()).toEqual({
      deviceType: undefined,
      device: undefined,
      deviceError: undefined,
      isLoading: false
    });
    expect(document.body.querySelector('[data-device-manager-canvas-parent]')).toBeNull();
  });

  it('destroys every cached backend when the manager is reset', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    const webglDevice = createMockDevice('webgl');
    createDeviceMock.mockImplementation(({type}: {type: 'webgl' | 'webgpu'}) =>
      Promise.resolve(type === 'webgpu' ? webgpuDevice : webglDevice)
    );

    await manager.createDevice('webgpu');
    await manager.createDevice('webgl');
    manager.reset();
    await Promise.resolve();

    expect(webgpuDevice.destroy).toHaveBeenCalledOnce();
    expect(webglDevice.destroy).toHaveBeenCalledOnce();
  });

  it('destroys devices that finish creation after the manager is reset', async () => {
    const webgpuDevice = createMockDevice('webgpu');
    let finishCreation: ((device: Device) => void) | undefined;
    createDeviceMock.mockImplementation(
      () =>
        new Promise<Device>(resolve => {
          finishCreation = resolve;
        })
    );

    const pendingDevice = manager.createDevice('webgpu');
    manager.reset();
    finishCreation?.(webgpuDevice);
    await pendingDevice;
    await Promise.resolve();

    expect(webgpuDevice.destroy).toHaveBeenCalledOnce();
    expect(manager.getState().device).toBeUndefined();
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    createDeviceMock.mockResolvedValue(createMockDevice('webgpu'));
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    unsubscribe();
    await manager.setDeviceType('webgpu');

    expect(listener).not.toHaveBeenCalled();
  });
});
