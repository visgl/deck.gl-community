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
