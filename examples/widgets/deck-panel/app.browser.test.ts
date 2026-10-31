import {expect, it, vi} from 'vitest';
import {mountDeckPanelExample} from './app';

it('mounts two panels without a root and supports selection, remounting and root-canvas mode', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:960px;height:600px';
  document.body.append(host);
  const cleanup = mountDeckPanelExample(host);
  try {
    const status = host.querySelector('[role="status"]')!;
    await vi.waitFor(
      () => {
        expect(host.querySelectorAll('canvas')).toHaveLength(2);
        expect(status.textContent).toContain('no root canvas');
      },
      {timeout: 30000}
    );
    const district = host.querySelector<HTMLSelectElement>('[aria-label="District"]')!;
    district.value = '2';
    district.dispatchEvent(new Event('change'));
    expect(status.textContent).toContain('Gardens');
    const toggle = host.querySelector<HTMLButtonElement>('[data-toggle]')!;
    toggle.click();
    await vi.waitFor(() => expect(host.querySelectorAll('canvas')).toHaveLength(1));
    toggle.click();
    await vi.waitFor(() => expect(host.querySelectorAll('canvas')).toHaveLength(2));
    const layout = host.querySelector<HTMLSelectElement>('[aria-label="Canvas layout"]')!;
    layout.value = 'root';
    layout.dispatchEvent(new Event('change'));
    await vi.waitFor(
      () => {
        expect(host.querySelectorAll('canvas')).toHaveLength(2);
        expect(status.textContent).toContain('root + panel');
      },
      {timeout: 30000}
    );
    host.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    layout.value = 'panels';
    layout.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(status.textContent).toContain('no root canvas'), {
      timeout: 30000
    });
  } finally {
    cleanup();
    expect(host.children).toHaveLength(0);
    host.remove();
  }
}, 60000);
