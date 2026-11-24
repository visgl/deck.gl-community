// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import {mountCoitExample} from './app';
import fixtureUrl from './coit-fixture.rad?url&no-inline';
import {requireWebGPUAdapter} from '../../../modules/layers/test/common-layers/webgpu-test-utils';

it('streams a RAD fixture through Coit on WebGPU', async ({skip}) => {
  await requireWebGPUAdapter(skip);
  const response = await fetch(fixtureUrl, {headers: {Range: 'bytes=0-7'}});
  expect(response.status).toBe(206);
  expect((await response.text()).slice(0, 4)).toBe('RAD0');

  const container = document.createElement('div');
  container.style.cssText = 'width:640px;height:400px';
  document.body.appendChild(container);
  const unmount = mountCoitExample(container, fixtureUrl);
  try {
    await expect
      .poll(
        () => ({
          firstCoverage: container.querySelector('.metrics dd')?.textContent === '1',
          status: container.querySelector('.status')?.textContent?.trim()
        }),
        {timeout: 30_000}
      )
      .toMatchObject({firstCoverage: true});
    expect(container.querySelector('.status')?.getAttribute('data-phase')).not.toBe('error');
  } catch (error) {
    throw new Error(container.querySelector('.status')?.textContent?.trim() || 'No Coit status', {
      cause: error
    });
  } finally {
    unmount();
    container.remove();
  }
}, 45_000);
