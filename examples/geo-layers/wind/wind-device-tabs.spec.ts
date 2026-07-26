// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {mountDeviceManagedExample} from '../../../website/src/components/example/mount-device-managed-example';

const deviceTabs = vi.hoisted(() => {
  const webgpuDevice = {id: 'wind-webgpu', type: 'webgpu'};
  let listener: ((state: {device: typeof webgpuDevice}) => void) | undefined;
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
    const webglDevice = {id: 'wind-webgl', type: 'webgl'};
    const deck = {
      device: webglDevice as typeof webglDevice | typeof deviceTabs.webgpuDevice,
      props: {parent: container, widgets: [] as unknown[]},
      setProps: vi.fn((props: {device?: typeof deviceTabs.webgpuDevice; widgets?: unknown[]}) => {
        if (props.device) {
          deck.device = props.device;
        }
        if (props.widgets) {
          deck.props.widgets = props.widgets;
        }
      })
    };
    const cleanup = vi.fn();
    const mount = vi.fn(
      (
        _container: HTMLElement,
        options: {onDeckInitialized: (initializedDeck: typeof deck) => void}
      ) => {
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
    expect(deck.props.widgets).toHaveLength(1);
    expect(deviceTabs.manager.initialize).toHaveBeenCalledOnce();
    expect(deck.device).toBe(deviceTabs.webgpuDevice);

    dispose();

    expect(deviceTabs.unsubscribe).toHaveBeenCalledOnce();
    expect(deviceTabs.manager.reset).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
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
