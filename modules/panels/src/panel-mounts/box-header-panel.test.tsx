/** @jsxImportSource preact */
import {useEffect, useState} from 'preact/hooks';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Panel} from '../panels/panel';
import {PanelManager} from '../panels/panel-manager';
import {ColumnPanel} from '../composite-panels/column-panel';
import {BoxPanelContainer} from './box-panel-container';

class ContentPanel extends Panel {}
const managers: PanelManager[] = [];
afterEach(() => {
  managers.splice(0).forEach(manager => manager.finalize());
  document.body.replaceChildren();
});
const settle = () =>
  new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function mount(box: BoxPanelContainer, height = 600) {
  const parent = document.createElement('div');
  Object.assign(parent.style, {
    position: 'relative',
    width: '900px',
    height: `${height}px`,
    overflow: 'hidden'
  });
  const content = document.createElement('div');
  parent.append(content);
  document.body.append(parent);
  const manager = new PanelManager({
    parentElement: parent,
    contentElement: content,
    components: [box]
  });
  managers.push(manager);
  return {manager, root: box.rootElement!};
}

describe('persistent box header panels', () => {
  it.each([
    false,
    true
  ])('keeps controls interactive and mounted when collapsed (pinnable=%s)', async pinnable => {
    const mounts = vi.fn(),
      disposals = vi.fn(),
      onOpenChange = vi.fn();
    function Controls() {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounts();
        return disposals;
      }, []);
      return (
        <>
          <input aria-label="Quick filter" defaultValue="Keep" />
          <button data-count="" onClick={() => setCount(count + 1)}>
            {count}
          </button>
        </>
      );
    }
    const box = new BoxPanelContainer({
      title: 'Info',
      pinnable,
      onOpenChange,
      headerPanel: new ContentPanel({content: <Controls />}),
      panel: new ContentPanel({content: <input aria-label="Details" />})
    });
    const {root} = mount(box);
    await settle();
    const header = root.querySelector<HTMLElement>('[data-panel-header]')!;
    const input = header.querySelector('input')!;
    input.value = 'Edited';
    expect(input.closest('button')).toBeNull();
    header.querySelector<HTMLButtonElement>('[data-count]')!.click();
    await settle();
    expect(box.isOpen).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();
    await settle();
    expect(box.isOpen).toBe(false);
    expect(header.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Details"]')!.getBoundingClientRect().height
    ).toBe(0);
    input.focus();
    expect(document.activeElement).toBe(input);
    header.querySelector<HTMLButtonElement>('[data-count]')!.click();
    await settle();
    expect(header.querySelector('[data-count]')?.textContent).toBe('2');
    if (pinnable) root.querySelector<HTMLButtonElement>('[aria-label="Pin panel"]')!.click();
    root.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();
    await settle();
    expect(root.querySelector('[data-panel-header]')).toBe(header);
    expect(header.querySelector('input')).toBe(input);
    expect(input.value).toBe('Edited');
    expect(mounts).toHaveBeenCalledOnce();
    expect(disposals).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true
  ])('updates and removes headers without resetting body state (pinnable=%s)', async pinnable => {
    const child = new ContentPanel({content: 'Original'});
    const headerPanel = new ColumnPanel({panels: [child]});
    const box = new BoxPanelContainer({
      headerPanel,
      pinnable,
      defaultPinned: pinnable,
      defaultOpen: false,
      panel: new ContentPanel({
        content: <input aria-label="Retained body" defaultValue="Initial" />
      })
    });
    const {manager, root} = mount(box);
    const bodyInput = root.querySelector<HTMLInputElement>('[aria-label="Retained body"]')!;
    bodyInput.value = 'Edited body';
    const update = vi.spyOn(box, 'updateHTML');
    child.setProps({content: 'Updated'});
    await settle();
    expect(root.querySelector('[data-panel-header]')?.textContent).toContain('Updated');
    expect(box.isOpen).toBe(false);
    const replacement = new ContentPanel({content: 'Replacement'});
    box.setProps({headerPanel: replacement});
    await settle();
    expect(root.querySelector('[data-panel-header]')?.textContent).toBe('Replacement');
    update.mockClear();
    child.setProps({content: 'Detached'});
    expect(update).not.toHaveBeenCalled();
    box.setProps({headerPanel: undefined});
    expect(root.querySelector('[data-panel-header]')).toBeNull();
    expect(root.querySelector('[aria-label="Retained body"]')).toBe(bodyInput);
    expect(bodyInput.value).toBe('Edited body');
    box.setProps({headerPanel: replacement});
    manager.finalize();
    update.mockClear();
    replacement.setProps({content: 'After removal'});
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true
  ])('scrolls tall headers inside a short collapsed host (pinnable=%s)', async pinnable => {
    const box = new BoxPanelContainer({
      title: 'Info',
      pinnable,
      defaultPinned: pinnable,
      defaultOpen: false,
      headerPanel: new ContentPanel({
        content: (
          <div
            style={{
              height: '400px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <button>First action</button>
            <button data-last-action="">Last action</button>
          </div>
        )
      })
    });
    const {root} = mount(box, 120);
    await settle();
    const header = root.querySelector<HTMLElement>('[data-panel-header]')!;
    expect(header.clientHeight).toBeGreaterThan(0);
    expect(header.scrollHeight).toBeGreaterThan(header.clientHeight);
    const last = header.querySelector<HTMLButtonElement>('[data-last-action]')!;
    last.focus();
    await settle();
    expect(header.scrollTop).toBeGreaterThan(0);
    expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().top
    );
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      header.getBoundingClientRect().bottom
    );
    expect(box.isOpen).toBe(false);
  });

  it('supports header-only and controlled boxes, including direct prop updates', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onOpenChange = vi.fn();
    const box = new BoxPanelContainer({title: 'Info', open: false, onOpenChange});
    box.onRenderHTML(root);
    box.setProps({headerPanel: new ContentPanel({content: <button>Quick action</button>})});
    expect(root.querySelector('[data-panel-header]')?.textContent).toBe('Quick action');
    root.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(box.isOpen).toBe(false);
    box.setProps({open: true});
    expect(box.isOpen).toBe(true);
    box.onRemove();
  });
});
