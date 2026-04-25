/** @jsxImportSource preact */
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {DeviceManagerState, DeviceType} from '../device-manager';
import {DeviceTabsWidget} from './device-tabs-widget';

class MockDeviceManager {
  #state: DeviceManagerState = {
    deviceType: undefined,
    device: undefined,
    deviceError: undefined,
    isLoading: false
  };

  #listeners = new Set<(state: DeviceManagerState) => void>();
  availability: Partial<Record<DeviceType, boolean>> = {
    webgpu: true,
    webgl: true
  };

  getState(): DeviceManagerState {
    return {...this.#state};
  }

  subscribe(listener: (state: DeviceManagerState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async canCreateDeviceType(type: DeviceType): Promise<boolean> {
    return Promise.resolve(this.availability[type] ?? false);
  }

  async ensureDeviceType(preferredTypes: readonly DeviceType[]): Promise<DeviceType | undefined> {
    const preferredType = await this.getPreferredAvailableDeviceType(preferredTypes);
    if (preferredType) {
      await this.setDeviceType(preferredType);
    }
    return preferredType;
  }

  async getPreferredAvailableDeviceType(
    preferredTypes: readonly DeviceType[]
  ): Promise<DeviceType | undefined> {
    return Promise.resolve(preferredTypes.find((type) => this.availability[type]));
  }

  async setDeviceType(type: DeviceType): Promise<void> {
    this.#state = {
      ...this.#state,
      deviceType: type
    };
    this.#emit();
    return Promise.resolve();
  }

  #emit(): void {
    const state = this.getState();
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DeviceTabsWidget', () => {
  it('falls back to the first available device type', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const manager = new MockDeviceManager();
    manager.availability.webgpu = false;
    manager.availability.webgl = true;
    const widget = new DeviceTabsWidget({
      id: 'device-tabs',
      devices: ['webgpu', 'webgl2'],
      manager: manager as never
    });

    widget.onRenderHTML(root);
    await vi.waitFor(() => {
      expect(
        root
          .querySelector<HTMLButtonElement>('[data-device-tab-id="webgl"]')
          ?.getAttribute('aria-selected')
      ).toBe('true');
    });

    expect(root.querySelector<HTMLButtonElement>('[data-device-tab-id="webgl"]')).toBeTruthy();
    expect(root.querySelector<HTMLButtonElement>('[data-device-tab-id="webgpu"]')?.disabled).toBe(
      true
    );
  });

  it('switches device types when a tab is clicked', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const manager = new MockDeviceManager();
    const setDeviceTypeSpy = vi.spyOn(manager, 'setDeviceType');
    const widget = new DeviceTabsWidget({
      id: 'device-tabs',
      devices: ['webgpu', 'webgl2'],
      manager: manager as never
    });

    widget.onRenderHTML(root);
    await vi.waitFor(() => {
      expect(
        root
          .querySelector<HTMLButtonElement>('[data-device-tab-id="webgpu"]')
          ?.getAttribute('aria-selected')
      ).toBe('true');
    });
    root.querySelector<HTMLButtonElement>('[data-device-tab-id="webgl"]')?.click();

    expect(setDeviceTypeSpy).toHaveBeenCalledWith('webgl');
  });
});
