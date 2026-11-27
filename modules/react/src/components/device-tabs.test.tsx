// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {DeviceManagerController} from '@deck.gl-community/widgets';
import {DeviceTabs} from './device-tabs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('reuses the shared dropdown and leaves the manager owned by the host', async () => {
  const manager = new DeviceManagerController();
  const state = {deviceType: 'webgl' as const, isLoading: false};
  vi.spyOn(manager, 'getState').mockImplementation(() => state);
  vi.spyOn(manager, 'canCreateDeviceType').mockImplementation(async type => type === 'webgl');
  const initialize = vi.spyOn(manager, 'ensureDeviceType');
  const reset = vi.spyOn(manager, 'reset');
  const select = vi.spyOn(manager, 'setDeviceType').mockResolvedValue(undefined);
  const unsubscribe = vi.fn();
  vi.spyOn(manager, 'subscribe').mockReturnValue(unsubscribe);
  const {rerender, unmount} = render(<DeviceTabs manager={manager} />);

  const dropdown = screen.getByRole<HTMLSelectElement>('combobox', {name: 'Graphics backend'});
  expect(dropdown.value).toBe('webgl');
  await waitFor(() => {
    expect(screen.getByRole<HTMLOptionElement>('option', {name: 'WebGPU (N/A)'}).disabled).toBe(
      true
    );
  });
  fireEvent.change(dropdown, {target: {value: 'webgpu'}});
  expect(select).not.toHaveBeenCalled();
  fireEvent.change(dropdown, {target: {value: 'webgl'}});
  expect(select).toHaveBeenCalledWith('webgl');

  const onDeviceTypeChange = vi.fn();
  rerender(
    <DeviceTabs manager={manager} devices={['webgl2']} onDeviceTypeChange={onDeviceTypeChange} />
  );
  expect(screen.getByRole('combobox', {name: 'Graphics backend'})).toBe(dropdown);
  expect(screen.queryByRole('option', {name: /WebGPU/})).toBeNull();
  fireEvent.change(dropdown, {target: {value: 'webgl'}});
  expect(onDeviceTypeChange).toHaveBeenCalledWith('webgl');
  expect(select).toHaveBeenCalledOnce();
  unmount();

  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(initialize).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});
