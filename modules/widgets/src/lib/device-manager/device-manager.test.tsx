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
});
