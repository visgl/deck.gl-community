/** @jsxImportSource preact */
import {render} from 'preact';
import {expect, it, vi} from 'vitest';
import {PanelSelect, PanelMultiSelect} from './panel-select';
import {SelectComponent} from './select-component';
import {FullScreenController} from '../lib/full-screen-controller';

for (const kind of ['single', 'multi', 'setting']) {
  it(`keeps ${kind} selection menus visible and focusable inside fallback fullscreen`, async () => {
    const target = document.createElement('div');
    const root = document.createElement('div');
    target.style.cssText = 'width:300px;height:200px';
    target.append(root);
    document.body.append(target);
    Object.defineProperty(target, 'requestFullscreen', {value: undefined});
    const controller = new FullScreenController({target});
    const options = [
      {label: 'One', value: 'one'},
      {label: 'Two', value: 'two'}
    ];
    const change = vi.fn();
    try {
      render(
        kind === 'single' ? (
          <PanelSelect ariaLabel="Choice" value="one" options={options} onChange={change} />
        ) : kind === 'multi' ? (
          <PanelMultiSelect
            ariaLabel="Choice"
            value={['one']}
            options={options}
            onChange={change}
          />
        ) : (
          <SelectComponent
            id="choice"
            label="Choice"
            value="one"
            options={options}
            onValueChange={change}
          />
        ),
        root
      );
      await controller.enter();
      root.querySelector('button')!.click();
      await vi.waitFor(() => expect(target.querySelector('[role="listbox"]')).not.toBeNull());
      const option = [...target.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item =>
        item.textContent?.includes('Two')
      )!;
      option.focus();
      expect(document.activeElement).toBe(option);
      const rect = option.getBoundingClientRect();
      expect(target.contains(document.elementFromPoint(rect.left + 2, rect.top + 2))).toBe(true);
      option.click();
      await vi.waitFor(() => expect(change).toHaveBeenCalled());
    } finally {
      render(null, root);
      controller.destroy();
      target.remove();
    }
  });
}
