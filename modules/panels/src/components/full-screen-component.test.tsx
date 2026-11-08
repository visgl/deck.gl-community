import {PanelManager} from '../panels/panel-manager';
import {afterEach, expect, it} from 'vitest';
import {FullScreenComponent} from './full-screen-component';

afterEach(() => {
  document.body.innerHTML = '';
});

it('renders accessible enter/exit controls and releases fallback state when removed', async () => {
  const target = document.createElement('div');
  target.style.cssText = 'position:relative;width:300px;height:200px';
  Object.defineProperty(target, 'requestFullscreen', {value: undefined});
  document.body.append(target);
  const root = document.createElement('div');
  target.append(root);
  const component = new FullScreenComponent({target});
  component.onRenderHTML(root);
  let button = root.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Enter fullscreen');
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  button.click();
  await Promise.resolve();
  button = root.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Exit fullscreen');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  component.onRemove();
  expect(root.children.length).toBe(0);
  expect(document.documentElement.hasAttribute('data-deck-panel-fullscreen-lock')).toBe(false);
});

it('keeps default and reconciled corner placements inside a clipping PanelManager host', () => {
  const target = document.createElement('div');
  target.style.cssText = 'position:relative;width:300px;height:200px;overflow:hidden';
  document.body.append(target);
  const component = new FullScreenComponent({target});
  const manager = new PanelManager({parentElement: target, components: [component]});
  try {
    for (const placement of ['bottom-right', 'top-left', 'top-right', 'bottom-left'] as const) {
      manager.setProps({components: [new FullScreenComponent({target, placement})]});
      const button = target.querySelector('button')!.getBoundingClientRect();
      const host = target.getBoundingClientRect();
      expect(button.left).toBeGreaterThanOrEqual(host.left);
      expect(button.top).toBeGreaterThanOrEqual(host.top);
      expect(button.right).toBeLessThanOrEqual(host.right);
      expect(button.bottom).toBeLessThanOrEqual(host.bottom);
    }
  } finally {
    manager.finalize();
  }
});
