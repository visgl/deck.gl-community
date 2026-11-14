// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Deck, FirstPersonView, FirstPersonViewport} from '@deck.gl/core';
import {page, userEvent} from 'vitest/browser';
import {expect, test, vi} from 'vitest';
import {mountSkyExample} from '../../../../examples/layers/sky/app';
import {mountDeviceManagedExample} from '../../../../website/src/components/example/mount-device-managed-example';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const DEVICE_STORAGE_KEY = 'deck.gl-community-device-type';

test('switches the hosted SkyLayer from WebGL2 to WebGPU without resetting the camera', async ({
  skip
}) => {
  await requireWebGPUAdapter(skip);
  const previousPreference = localStorage.getItem(DEVICE_STORAGE_KEY);
  localStorage.setItem(DEVICE_STORAGE_KEY, 'webgl');
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:480px;height:240px';
  document.body.append(host);

  const mounts: Deck<FirstPersonView>[] = [];
  const onViewStateChange = vi.fn();
  let cleanup: (() => void) | undefined;
  try {
    cleanup = await mountDeviceManagedExample(
      host,
      mountSkyExample,
      {
        initialViewState: {position: [0, 0, 1.7], bearing: 20, pitch: -18},
        onDeckInitialized: (deck: Deck<FirstPersonView>) => mounts.push(deck),
        onViewStateChange
      },
      {deviceTabs: true, mountLabel: 'SkyLayer'}
    );
    const webgl = mounts[0];
    await vi.waitFor(() => expect(webgl?.isInitialized).toBe(true), {timeout: 5000});
    const canvas = webgl.getCanvas()!;
    expect(canvas.parentElement).toBe(webgl.props.parent);
    expect(canvas.getContext('webgl2')).toBeTruthy();
    const getBearing = (deck: Deck<FirstPersonView>) =>
      (deck.getViewports()[0] as FirstPersonViewport).bearing;
    expect(getBearing(webgl)).toBe(20);

    canvas.focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await vi.waitFor(() => expect(onViewStateChange).toHaveBeenCalled(), {timeout: 5000});
    const {bearing} = onViewStateChange.mock.calls[0][0].viewState;
    expect(bearing).not.toBe(20);
    await vi.waitFor(() => expect(getBearing(webgl)).toBeCloseTo(bearing), {timeout: 5000});

    await page.getByRole('tab', {name: 'WebGPU', exact: true}).click();
    await vi.waitFor(() => expect(mounts[1]?.isInitialized).toBe(true), {timeout: 10000});
    const webgpu = mounts[1];
    const webgpuCanvas = webgpu.getCanvas()!;
    expect(webgpuCanvas.parentElement).toBe(webgpu.props.parent);
    expect(webgpuCanvas.getContext('webgpu')).toBeTruthy();
    expect(getBearing(webgpu)).toBeCloseTo(bearing);
  } finally {
    cleanup?.();
    host.remove();
    if (previousPreference === null) {
      localStorage.removeItem(DEVICE_STORAGE_KEY);
    } else {
      localStorage.setItem(DEVICE_STORAGE_KEY, previousPreference);
    }
  }
}, 30000);
