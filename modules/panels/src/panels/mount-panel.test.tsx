/** @jsxImportSource preact */
import {h} from 'preact';
import {useState} from 'preact/hooks';
import {afterEach, expect, it, vi} from 'vitest';
import {mountPanel} from './mount-panel';
import {Panel} from './panel';
import {CustomPanel} from '../leaf-panels/custom-panel';
import {applyPanelTheme} from '../lib/panel-theme';

class TestPanel extends Panel {}
afterEach(() => document.body.replaceChildren());

it('embeds content with the host custom theme and cleans up only its own surface', async () => {
  const host = document.createElement('div');
  const sibling = document.createElement('span');
  host.append(sibling);
  document.body.append(host);
  applyPanelTheme(host, {base: 'sleek-dark', variables: {'--button-text': 'rgb(1, 200, 120)'}});
  const cleanup = vi.fn();
  const mount = mountPanel(
    new CustomPanel({
      id: 'custom',
      title: 'Custom',
      onRenderHTML: element => {
        element.textContent = 'Content';
        return cleanup;
      }
    }),
    host
  );
  const scope = host.querySelector<HTMLElement>('[data-panel-theme-mode]')!;
  await expect
    .poll(() => getComputedStyle(scope).getPropertyValue('--button-text'))
    .toBe('rgb(1, 200, 120)');
  expect(scope.style.getPropertyValue('--button-text')).toBe('');
  expect(host.querySelector('header')).toBeNull();
  mount.finalize();
  mount.finalize();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect([...host.children]).toEqual([sibling]);
  mount.setPanel(new TestPanel({id: 'late', title: 'Late', content: h('p', {}, 'Late')}));
  expect(host.textContent).not.toContain('Late');
});

it('preserves state on same-id updates and supports replacement, clearing, and titles', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  function Counter() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(value => value + 1)}>{count}</button>;
  }
  const panel = (id: string, title: string) => new TestPanel({id, title, content: <Counter />});
  const mount = mountPanel(panel('same', 'First'), host, {showTitle: true});
  const button = host.querySelector('button')!;
  button.click();
  await new Promise(resolve => requestAnimationFrame(resolve));
  mount.setPanel(panel('same', 'Updated'));
  expect(host.querySelector('button')).toBe(button);
  expect(button.textContent).toBe('1');
  expect(host.querySelector('header')!.textContent).toBe('Updated');
  mount.setPanel(panel('different', 'Replacement'));
  expect(host.querySelector('button')).not.toBe(button);
  expect(host.querySelector('button')!.textContent).toBe('0');
  mount.setPanel(null);
  expect(host.textContent).toBe('');
  mount.finalize();
});
