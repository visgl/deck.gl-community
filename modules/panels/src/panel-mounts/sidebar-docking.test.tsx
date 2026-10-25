/** @jsxImportSource preact */
import {useEffect, useState} from 'preact/hooks';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PanelManager} from '../panels/panel-manager';
import {Panel} from '../panels/panel';
import {usePanelContainerState} from '../panels/panel-container-state';
import {SidebarPanelContainer} from './sidebar-panel-container';

class ContentPanel extends Panel {}
const managers: PanelManager[] = [];
afterEach(() => {
  managers.splice(0).forEach(manager => manager.finalize());
  document.body.replaceChildren();
});
const settle = () =>
  new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function host(withContent = true) {
  const parent = document.createElement('div'),
    content = document.createElement('div');
  Object.assign(parent.style, {position: 'relative', width: '1000px', height: '700px'});
  parent.append(content);
  document.body.append(parent);
  const manager = new PanelManager({
    parentElement: parent,
    contentElement: withContent ? content : undefined
  });
  managers.push(manager);
  return {parent, content, manager};
}
function click(root: ParentNode, label: string) {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, label).toBeTruthy();
  button!.click();
}

describe('consolidated sidebar docking', () => {
  it.each([
    'left',
    'right'
  ] as const)('moves one %s content tree and retains focus, scroll, input and hook state', async side => {
    const {content, manager} = host();
    const mounts = vi.fn(),
      unmounts = vi.fn();
    function Controls() {
      const state = usePanelContainerState();
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounts();
        return () => unmounts();
      }, []);
      return (
        <>
          <span data-mode="">
            {String(state?.pinned)}:{state?.side}
          </span>
          <div data-scroll="" style={{height: '60px', overflow: 'auto'}}>
            <input defaultValue="Preserved" />
            <button data-count="" onClick={() => setCount(count + 1)}>
              {count}
            </button>
            <div style={{height: '300px'}} />
          </div>
        </>
      );
    }
    const sidebar = new SidebarPanelContainer({
      side,
      title: 'Tools',
      widthPx: 180,
      pinnable: true,
      showBackdrop: true,
      panel: new ContentPanel({content: <Controls />})
    });
    manager.setProps({components: [sidebar]});
    await settle();
    const root = sidebar.rootElement!,
      input = root.querySelector('input')!,
      scroll = root.querySelector<HTMLElement>('[data-scroll]')!;
    root.querySelector<HTMLButtonElement>('[data-count]')!.click();
    await settle();
    input.value = 'Keep this';
    input.focus();
    input.setSelectionRange(1, 4);
    scroll.scrollTop = 30;
    expect(content.clientWidth).toBe(1000);
    click(root, 'Pin panel');
    await settle();
    expect(content.clientWidth).toBe(820);
    expect(root.parentElement?.dataset.side).toBe(side);
    expect(root.querySelector('input')).toBe(input);
    expect(input.value).toBe('Keep this');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
    expect(scroll.scrollTop).toBe(30);
    expect(root.querySelector('[data-count]')?.textContent).toBe('1');
    expect(root.querySelector('[data-mode]')?.textContent).toBe(`true:${side}`);
    expect(root.querySelector('[aria-label="Close Tools"]')).toBeNull();
    click(root, 'Unpin panel');
    await settle();
    expect(content.clientWidth).toBe(1000);
    expect(root.closest('.deck-panel-layout-center')).toBeTruthy();
    expect(root.querySelector('input')).toBe(input);
    expect(scroll.scrollTop).toBe(30);
    expect(root.querySelector('[data-mode]')?.textContent).toBe(`false:${side}`);
    expect(unmounts).not.toHaveBeenCalled();
    expect(mounts).toHaveBeenCalledOnce();
    manager.finalize();
    expect(root.isConnected).toBe(false);
    expect(unmounts).toHaveBeenCalledOnce();
  });

  it('reclaims docked space when closed and restores the pin state and user-resized width', async () => {
    const {parent, content, manager} = host();
    const sidebar = new SidebarPanelContainer({
      title: 'Tools',
      side: 'left',
      defaultPinned: true,
      pinnable: true,
      widthPx: 180,
      resizable: true
    });
    manager.setProps({components: [sidebar]});
    await settle();
    const root = sidebar.rootElement!;
    root
      .querySelector('[role="separator"]')!
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await settle();
    expect(content.clientWidth).toBe(810);
    click(root, 'Hide Tools');
    await settle();
    expect(root.hidden).toBe(true);
    expect(sidebar.isPinned).toBe(true);
    expect(content.clientWidth).toBe(1000);
    click(parent, 'Show Tools');
    await settle();
    expect(content.clientWidth).toBe(810);
    expect(root.hidden).toBe(false);
    click(root, 'Unpin panel');
    await settle();
    expect(root.querySelector<HTMLElement>('[role="dialog"]')?.style.width).toBe('190px');
    click(root, 'Pin panel');
    await settle();
    expect(content.clientWidth).toBe(810);
  });

  it('keeps restore focus for docked chrome and returns overlay focus to the Deck canvas', async () => {
    const {parent, content, manager} = host();
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    content.append(canvas);
    manager.deck = {canvas};
    const sidebar = new SidebarPanelContainer({
      title: 'Tools',
      defaultPinned: true,
      pinnable: true
    });
    manager.setProps({components: [sidebar]});
    const root = sidebar.rootElement!;
    click(root, 'Hide Tools');
    await settle();
    expect(document.activeElement).toBe(parent.querySelector('[aria-label="Show Tools"]'));
    click(parent, 'Show Tools');
    click(root, 'Unpin panel');
    click(root, 'Close');
    await settle();
    expect(document.activeElement).toBe(canvas);
    sidebar.setProps({open: true});
    const close = root.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    close.focus();
    close.click();
    await settle();
    expect(sidebar.isOpen).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('keeps controlled open and pin props authoritative across unrelated updates and user requests', async () => {
    const {parent, content, manager} = host();
    const onPinnedChange = vi.fn(),
      onOpenChange = vi.fn();
    const sidebar = new SidebarPanelContainer({
      title: 'Tools',
      pinnable: true,
      pinned: false,
      open: true,
      widthPx: 180,
      onPinnedChange,
      onOpenChange
    });
    manager.setProps({components: [sidebar]});
    const root = sidebar.rootElement!;
    click(root, 'Pin panel');
    expect(onPinnedChange).toHaveBeenCalledWith(true);
    expect(sidebar.isPinned).toBe(false);
    sidebar.setProps({pinned: true});
    await settle();
    sidebar.setProps({title: 'Renamed'});
    click(root, 'Hide Renamed');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(sidebar.isOpen).toBe(true);
    expect(content.clientWidth).toBe(820);
    sidebar.setProps({open: false});
    await settle();
    expect(content.clientWidth).toBe(1000);
    click(parent, 'Show Renamed');
    expect(sidebar.isOpen).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    sidebar.setProps({open: undefined, pinned: undefined});
    click(parent, 'Show Renamed');
    await settle();
    expect(sidebar.isOpen).toBe(true);
    expect(sidebar.isPinned).toBe(true);
    expect(content.clientWidth).toBe(820);
    expect(onPinnedChange).toHaveBeenCalledOnce();
  });

  it('renders permanent chrome without controls and allows application-owned visibility changes', async () => {
    const {content, manager} = host();
    const sidebar = new SidebarPanelContainer({
      pinned: true,
      pinnable: false,
      hidable: false,
      widthPx: 180,
      title: 'Permanent'
    });
    manager.setProps({components: [sidebar]});
    await settle();
    expect(content.clientWidth).toBe(820);
    expect(sidebar.rootElement!.querySelector('button')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(sidebar.isOpen).toBe(true);
    sidebar.setProps({open: false});
    await settle();
    expect(content.clientWidth).toBe(1000);
    sidebar.setProps({open: true});
    await settle();
    expect(content.clientWidth).toBe(820);
  });

  it('hides unavailable pinned state and disables user pinning without a content host', () => {
    const {manager} = host(false);
    const onPinnedChange = vi.fn();
    const sidebar = new SidebarPanelContainer({pinnable: true, title: 'Tools', onPinnedChange});
    manager.setProps({components: [sidebar]});
    const button = sidebar.rootElement!.querySelector<HTMLButtonElement>(
      '[aria-label="Pin panel"]'
    )!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(onPinnedChange).not.toHaveBeenCalled();
    sidebar.setProps({pinned: true});
    expect(sidebar.isPinned).toBe(true);
    expect(sidebar.rootElement!.hidden).toBe(true);
    expect(onPinnedChange).not.toHaveBeenCalled();
  });

  it('preserves local pin/open state and fitting overrides during declarative reconciliation', async () => {
    const {content, manager} = host();
    const sidebar = new SidebarPanelContainer({
      id: 'tools',
      pinnable: true,
      defaultPinned: true,
      widthPx: 180,
      resizable: true,
      fitContent: true,
      title: 'Tools'
    });
    manager.setProps({components: [sidebar]});
    await settle();
    sidebar
      .rootElement!.querySelector('[role="separator"]')!
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await settle();
    const width = sidebar.rootElement!.getBoundingClientRect().width;
    click(sidebar.rootElement!, 'Hide Tools');
    manager.setProps({
      components: [
        new SidebarPanelContainer({
          id: 'tools',
          pinnable: true,
          defaultPinned: false,
          defaultOpen: true,
          widthPx: 180,
          resizable: true,
          fitContent: true,
          title: 'Tools'
        })
      ]
    });
    expect(manager.getComponents()[0]).toBe(sidebar);
    expect(sidebar.isOpen).toBe(false);
    expect(sidebar.isPinned).toBe(true);
    sidebar.setProps({open: true});
    await settle();
    expect(sidebar.rootElement!.getBoundingClientRect().width).toBeCloseTo(width);
    expect(content.getBoundingClientRect().width).toBeCloseTo(1000 - width);
  });

  it('scopes backdrop and Escape closing to overlays and releases controls/listeners on removal', async () => {
    const {parent, manager} = host();
    const onOpenChange = vi.fn();
    const sidebar = new SidebarPanelContainer({
      pinnable: true,
      defaultPinned: true,
      title: 'Tools',
      showBackdrop: true,
      onOpenChange
    });
    manager.setProps({components: [sidebar]});
    const root = sidebar.rootElement!;
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(sidebar.isOpen).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    click(root, 'Unpin panel');
    await settle();
    expect(root.querySelector('[aria-label="Close Tools"]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(sidebar.isOpen).toBe(false);
    expect(onOpenChange).toHaveBeenCalledOnce();
    sidebar.setProps({pinned: true});
    await settle();
    expect(parent.querySelector('[aria-label="Show Tools"]')).toBeTruthy();
    manager.setProps({components: []});
    expect(parent.querySelector('[aria-label="Show Tools"]')).toBeNull();
    expect(root.isConnected).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(onOpenChange).toHaveBeenCalledOnce();
  });
});
