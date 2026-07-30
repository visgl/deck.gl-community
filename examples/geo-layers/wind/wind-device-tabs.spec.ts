// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {mountDeviceManagedExample} from '../../../website/src/components/example/mount-device-managed-example';

const deviceTabs = vi.hoisted(() => {
  const webgpuDevice = {id: 'wind-webgpu', type: 'webgpu'};
  let listener: ((state: {device: typeof webgpuDevice | {id: string; type: 'webgl'}}) => void) |
    undefined;
  const unsubscribe = vi.fn();
  const manager = {
    subscribe: vi.fn((nextListener: typeof listener) => {
      listener = nextListener;
      return unsubscribe;
    }),
    reparentCanvas: vi.fn(),
    initialize: vi.fn(async () => {
      listener?.({device: webgpuDevice});
    }),
    reset: vi.fn()
  };

  return {
    webgpuDevice,
    selectDevice: (device: typeof webgpuDevice | {id: string; type: 'webgl'}) => {
      listener?.({device});
    },
    manager,
    unsubscribe,
    Manager: vi.fn(function DeviceManagerController() {
      return manager;
    }),
    Widget: vi.fn(function DeviceTabsWidget(props: unknown) {
      return {props};
    })
  };
});

vi.mock('@deck.gl-community/widgets', () => ({
  DeviceManagerController: deviceTabs.Manager,
  DeviceTabsWidget: deviceTabs.Widget
}));

describe('wind showcase graphics backend selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs working WebGL and WebGPU tabs into the mounted wind deck', async () => {
    const container = {} as HTMLElement;
    const webglDevice = {id: 'wind-webgl', type: 'webgl' as const};
    const cleanup = vi.fn();
    const mount = vi.fn(
      (
        _container: HTMLElement,
        options: {
          device: typeof webglDevice | typeof deviceTabs.webgpuDevice;
          widgets: unknown[];
          initialViewState?: {longitude: number};
          onViewStateChange: (params: {viewState: {longitude: number}}) => {longitude: number};
          onDeckInitialized: (deck: {
            device: typeof webglDevice | typeof deviceTabs.webgpuDevice;
            props: {parent: HTMLElement; widgets: unknown[]};
          }) => void;
        }
      ) => {
        const deck = {
          device: options.device,
          props: {parent: container, widgets: options.widgets}
        };
        options.onDeckInitialized(deck);
        return cleanup;
      }
    );

    const dispose = await mountDeviceManagedExample(
      container,
      mount,
      {},
      {
        deviceTabs: true,
        mountLabel: 'Wind Map'
      }
    );

    expect(deviceTabs.Manager).toHaveBeenCalledOnce();
    expect(deviceTabs.Widget).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wind-map-device-tabs',
        devices: ['webgpu', 'webgl2'],
        manager: deviceTabs.manager,
        placement: 'top-right'
      })
    );
    expect(mount).toHaveBeenCalledOnce();
    expect(mount.mock.calls[0][1].device).toBe(deviceTabs.webgpuDevice);
    expect(mount.mock.calls[0][1].widgets).toHaveLength(1);
    expect(deviceTabs.manager.initialize).toHaveBeenCalledOnce();

    mount.mock.calls[0][1].onViewStateChange({viewState: {longitude: -98}});
    deviceTabs.selectDevice(webglDevice);
    await Promise.resolve();
    await Promise.resolve();

    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[1][1].device).toBe(webglDevice);
    expect(mount.mock.calls[1][1].initialViewState).toEqual({longitude: -98});
    expect(cleanup).toHaveBeenCalledOnce();

    dispose();

    expect(deviceTabs.unsubscribe).toHaveBeenCalledOnce();
    expect(deviceTabs.manager.reset).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('mounts without a device manager when graphics tabs are disabled', async () => {
    const container = {} as HTMLElement;
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);

    const dispose = await mountDeviceManagedExample(container, mount);

    expect(mount).toHaveBeenCalledWith(container, {});
    expect(deviceTabs.Manager).not.toHaveBeenCalled();

    dispose();

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
