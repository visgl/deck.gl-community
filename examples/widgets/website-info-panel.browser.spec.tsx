// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect, it, vi} from 'vitest';
import ExampleInfoPanel from '../../website/src/components/info-panel';
import exampleStyles from '../../website/src/components/example/make-example.module.css';

it('keeps website info controls aligned and follows responsive host bounds', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:900px;height:500px';
  document.body.append(host);
  const root = createRoot(host);
  const updateParam = vi.fn();
  try {
    await act(async () => {
      root.render(
        <div className={exampleStyles.demoContainer}>
          <ExampleInfoPanel
            title="Example controls"
            sourceLink="https://example.com/code"
            meta={{}}
            updateParam={updateParam}
            params={{
              speed: {type: 'range', displayName: 'Speed', displayValue: 2, min: 0, max: 10},
              mode: {type: 'select', displayName: 'Mode', displayValue: 'A', options: ['A', 'B']},
              config: {type: 'json', displayName: 'Config', displayValue: '{}', altValue: '{}'},
              docs: {type: 'link', displayName: 'Docs', displayValue: 'https://example.com'}
            }}
          >
            <p>Example description</p>
          </ExampleInfoPanel>
        </div>
      );
    });
    await vi.waitFor(() => expect(host.querySelectorAll('input, select')).toHaveLength(2));
    const controls = host.querySelectorAll<HTMLElement>(
      'input, select, button[type="text"], label + a'
    );
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      expect(getComputedStyle(control).display).toBe('inline-block');
      expect(control.getBoundingClientRect().width).toBeCloseTo(
        control.parentElement!.getBoundingClientRect().width / 2,
        0
      );
    }
    const divider = host.querySelector('hr')!;
    expect(getComputedStyle(divider).borderTopStyle).toBe('solid');
    expect(divider.getBoundingClientRect().height).toBeGreaterThan(0);
    const select = host.querySelector('select')!;
    select.value = 'B';
    select.dispatchEvent(new Event('change', {bubbles: true}));
    expect(updateParam).toHaveBeenCalledWith('mode', 'B');
    host.style.width = '420px';
    host.style.height = '260px';
    await vi.waitFor(() => {
      const panel = host.querySelector('section[aria-label="Example controls"]')!;
      expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(
        host.getBoundingClientRect().right
      );
      expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        host.getBoundingClientRect().left
      );
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
