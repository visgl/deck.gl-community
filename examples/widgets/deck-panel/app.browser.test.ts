import {expect, it, vi} from 'vitest';
import {Deck} from '@deck.gl/core';
import {mountDeckPanelExample} from './app';

it('mounts two panels without a root and supports selection, remounting and root-canvas mode', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:960px;height:600px';
  document.body.append(host);
  const updates = vi.spyOn(Deck.prototype, 'setProps');
  const cleanup = mountDeckPanelExample(host);
  async function expectOverviewColors(harbor: number, gardens: number) {
    await vi.waitFor(() => {
      const deck = updates.mock.contexts.findLast(instance => instance.isInitialized)!;
      const layer = deck.layerManager!.getLayers().find(layer => layer.id === 'overview-stops')!;
      const colors = layer.getAttributeManager()!.getAttributes().instanceFillColors.value!;
      expect([colors[3], colors[18 * 4 + 3]]).toEqual([harbor, gardens]);
    });
  }
  try {
    const status = host.querySelector('[role="status"]')!;
    await vi.waitFor(
      () => {
        expect(host.querySelectorAll('canvas')).toHaveLength(2);
        expect(status.textContent).toContain('no root canvas');
      },
      {timeout: 30000}
    );
    await expectOverviewColors(255, 100);
    const district = host.querySelector<HTMLSelectElement>('[aria-label="District"]')!;
    district.value = '2';
    district.dispatchEvent(new Event('change'));
    expect(status.textContent).toContain('Gardens');
    await expectOverviewColors(100, 255);
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
    await expectOverviewColors(100, 255);
    district.value = '0';
    district.dispatchEvent(new Event('change'));
    await expectOverviewColors(255, 100);
    host.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    layout.value = 'panels';
    layout.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(status.textContent).toContain('no root canvas'), {
      timeout: 30000
    });
  } finally {
    cleanup();
    updates.mockRestore();
    expect(host.children).toHaveLength(0);
    host.remove();
  }
}, 60000);
