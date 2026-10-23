/** @jsxImportSource preact */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {useState} from 'preact/hooks';
import {userEvent} from 'vitest/browser';
import {ColumnPanel} from '../composite-panels/column-panel';
import {PanelManager} from '../panels/panel-manager';
import {Panel} from '../panels/panel';
import {usePanelContainerState} from '../panels/panel-container-state';
import {HeaderPanelContainer} from './header-panel-container';
import {FooterPanelContainer} from './footer-panel-container';
import {SidePanelContainer} from './side-panel-container';
import {PinnablePanelContainer} from './pinnable-panel-container';
import {BoxPanelContainer} from './box-panel-container';

class TestPanel extends Panel {}
const managers: PanelManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.finalize();
  document.body.replaceChildren();
});
function createHost(withContent = true) {
  const parent = document.createElement('div');
  Object.assign(parent.style, {
    position: 'absolute',
    left: '21px',
    top: '13px',
    width: '1000px',
    height: '700px'
  });
  const content = document.createElement('div');
  parent.append(content);
  document.body.append(parent);
  const manager = new PanelManager({
    parentElement: parent,
    contentElement: withContent ? content : undefined
  });
  managers.push(manager);
  return {parent, content, manager};
}
function createPanel(content = <input defaultValue="keep me" />) {
  return new TestPanel({id: 'content', title: 'Content', content});
}
const settle = () =>
  new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function bounds(element: Element) {
  return element.getBoundingClientRect();
}

describe('canvas chrome', () => {
  it('lays out every edge without moving or restyling the outer parent', async () => {
    const {parent, content, manager} = createHost();
    const original = parent.getAttribute('style');
    const header = new HeaderPanelContainer({heightPx: 60});
    const footer = new FooterPanelContainer({heightPx: 40});
    const left = new SidePanelContainer({widthPx: 100});
    const right = new SidePanelContainer({id: 'right', side: 'right', widthPx: 120});
    const overlay = new BoxPanelContainer({placement: 'bottom-right', title: 'Overlay'});
    manager.setProps({components: [header, footer, left, right, overlay]});
    await settle();
    expect(parent.getAttribute('style')).toBe(original);
    expect(bounds(content).width).toBeCloseTo(780);
    expect(bounds(content).height).toBeCloseTo(600);
    expect(bounds(content).left).toBeCloseTo(bounds(parent).left + 100);
    expect(bounds(content).top).toBeCloseTo(bounds(parent).top + 60);
    expect(bounds(header.rootElement!).width).toBeCloseTo(1000);
    expect(bounds(right.rootElement!).height).toBeCloseTo(600);
    expect(overlay.rootElement!.closest('.deck-panel-layout-center')).toBeTruthy();
  });

  it('keeps missing-content chrome hidden and floating pin controls disabled', () => {
    const {parent, manager} = createHost(false);
    const change = vi.fn();
    const floating = new PinnablePanelContainer({onPinnedChange: change});
    const pinned = new PinnablePanelContainer({id: 'pinned', pinned: true});
    const header = new HeaderPanelContainer();
    manager.setProps({components: [floating, pinned, header]});
    expect(floating.rootElement!.hidden).toBe(false);
    expect(floating.rootElement!.querySelector('button')!.disabled).toBe(true);
    floating.rootElement!.querySelector('button')!.click();
    expect(change).not.toHaveBeenCalled();
    expect(pinned.isPinned).toBe(true);
    expect(pinned.rootElement!.hidden).toBe(true);
    expect(header.rootElement!.hidden).toBe(true);
    expect(parent.querySelector('.deck-panel-layout')).toBeNull();
    pinned.setProps({pinned: false});
    expect(pinned.rootElement!.hidden).toBe(false);
  });

  it('updates descendant context and retains content DOM and state across pinning', async () => {
    const {content, manager} = createHost();
    function AdaptiveContent() {
      const state = usePanelContainerState();
      const [count, setCount] = useState(0);
      return (
        <div>
          <output>{`${state?.pinned}:${state?.side}:${state?.canPin}`}</output>
          <button onClick={() => setCount(count + 1)}>{count}</button>
        </div>
      );
    }
    const panel = new PinnablePanelContainer({
      panel: new ColumnPanel({panels: [createPanel(<AdaptiveContent />)]})
    });
    manager.setProps({components: [panel]});
    const output = panel.rootElement!.querySelector('output')!;
    const counter = panel.rootElement!.querySelector(
      '.deck-panel-chrome-content button'
    )! as HTMLButtonElement;
    counter.click();
    await settle();
    expect(counter.textContent).toBe('1');
    panel
      .rootElement!.querySelector<HTMLButtonElement>('header button')!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}));
    await settle();
    expect(panel.isPinned).toBe(true);
    expect(output.textContent).toBe('true:right:true');
    expect(panel.rootElement!.querySelector('output')).toBe(output);
    expect(counter.textContent).toBe('1');
    expect(bounds(content).width).toBeCloseTo(680);
    panel.setProps({side: 'bottom', pinned: false});
    await settle();
    expect(output.textContent).toBe('false:bottom:true');
    expect(bounds(content).width).toBeCloseTo(1000);
  });

  it('requests controlled changes without changing state until props update', () => {
    const {manager} = createHost();
    const onPinnedChange = vi.fn();
    const panel = new PinnablePanelContainer({pinned: false, onPinnedChange});
    manager.setProps({components: [panel]});
    panel.rootElement!.querySelector('button')!.click();
    expect(onPinnedChange).toHaveBeenCalledWith(true);
    expect(panel.isPinned).toBe(false);
    panel.setProps({pinned: true});
    expect(panel.isPinned).toBe(true);
    panel.setProps({pinned: undefined});
    expect(panel.isPinned).toBe(true);
  });

  it('restores original content placement and styles and preserves unrelated DOM', () => {
    const {parent, content, manager} = createHost();
    content.style.cssText = 'position: relative; top: 7px !important; margin: 3px 4px; width: 80%;';
    const original = content.style.cssText;
    const sibling = document.createElement('span');
    content.after(sibling);
    manager.setProps({components: [new HeaderPanelContainer()]});
    manager.finalize();
    expect([...parent.children]).toEqual([content, sibling]);
    expect(content.style.cssText).toBe(original);
    expect(parent.querySelector('.deck-panel-layout')).toBeNull();
  });

  it('follows registration order and releases removed panels space', async () => {
    const {content, manager} = createHost();
    const first = new HeaderPanelContainer({id: 'first', heightPx: 60});
    const second = new HeaderPanelContainer({id: 'second', heightPx: 80});
    manager.setProps({components: [first, second]});
    await settle();
    expect(bounds(content).height).toBeCloseTo(620);
    expect(first.rootElement!.nextElementSibling).toBe(second.rootElement);
    manager.setProps({components: [second, first]});
    expect(second.rootElement!.nextElementSibling).toBe(first.rootElement);
    manager.setProps({components: []});
    await settle();
    expect(bounds(content).height).toBeCloseTo(700);
  });

  it('fits natural content until keyboard resizing, and allows resetting to fit', async () => {
    const {manager} = createHost();
    const panel = new PinnablePanelContainer({
      defaultPinned: true,
      side: 'left',
      fitContent: true,
      panel: createPanel(<div style={{width: '150px', height: '90px'}}>Natural size</div>)
    });
    manager.setProps({components: [panel]});
    await settle();
    const initial = bounds(panel.rootElement!).width;
    expect(initial).toBeCloseTo(166);
    const divider = panel.rootElement!.querySelector('[role="separator"]')!;
    divider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await settle();
    expect(bounds(panel.rootElement!).width).toBeCloseTo(initial + 10);
    panel.setProps({fitContent: true});
    await settle();
    expect(bounds(panel.rootElement!).width).toBeCloseTo(initial);
  });

  it('clamps large panels on small hosts and updates overlay bounds on resize', async () => {
    const {parent, content, manager} = createHost();
    const panel = new PinnablePanelContainer({defaultPinned: true, widthPx: 5000});
    manager.setProps({components: [panel]});
    await settle();
    expect(bounds(panel.rootElement!).width).toBeCloseTo(450);
    parent.style.width = '400px';
    await settle();
    expect(bounds(panel.rootElement!).width).toBeCloseTo(180);
    expect(bounds(content).width).toBeCloseTo(220);
  });

  it.each([
    'left',
    'right',
    'top',
    'bottom'
  ] as const)('pins and unpins on %s while preserving the content element', async side => {
    const {content, manager} = createHost();
    const panel = new PinnablePanelContainer({side, panel: createPanel()});
    manager.setProps({components: [panel]});
    const input = panel.rootElement!.querySelector('input')!;
    panel.rootElement!.querySelector<HTMLButtonElement>('header button')!.click();
    await settle();
    expect(panel.rootElement!.parentElement!.dataset.side).toBe(side);
    expect(bounds(content).width).toBeCloseTo(side === 'left' || side === 'right' ? 680 : 1000);
    expect(bounds(content).height).toBeCloseTo(side === 'top' || side === 'bottom' ? 460 : 700);
    panel.rootElement!.querySelector<HTMLButtonElement>('header button')!.click();
    await settle();
    expect(panel.rootElement!.querySelector('input')).toBe(input);
    expect(bounds(content).width).toBeCloseTo(1000);
    expect(bounds(content).height).toBeCloseTo(700);
  });

  it('supports real pointer dragging and retains its size across pin cycles', async () => {
    const {parent, manager} = createHost();
    const panel = new PinnablePanelContainer({side: 'left', defaultPinned: true, widthPx: 100});
    manager.setProps({components: [panel]});
    await settle();
    const target = document.createElement('div');
    Object.assign(target.style, {
      position: 'absolute',
      left: '200px',
      top: '200px',
      width: '10px',
      height: '10px',
      zIndex: '100'
    });
    parent.append(target);
    await userEvent.dragAndDrop(panel.rootElement!.querySelector('[role="separator"]')!, target);
    await settle();
    const width = bounds(panel.rootElement!).width;
    expect(width).toBeGreaterThan(190);
    expect(width).toBeLessThan(220);
    panel.rootElement!.querySelector<HTMLButtonElement>('header button')!.click();
    panel.rootElement!.querySelector<HTMLButtonElement>('header button')!.click();
    await settle();
    expect(bounds(panel.rootElement!).width).toBeCloseTo(width);
  });

  it('updates fit-content height as content changes and installs chrome CSS alongside deck CSS', async () => {
    const deckStyle = document.createElement('style');
    deckStyle.textContent = '.deck-widget { box-sizing: border-box; }';
    document.head.append(deckStyle);
    const {content, manager} = createHost();
    const panel = new HeaderPanelContainer({
      fitContent: true,
      panel: createPanel(<div style={{height: '30px'}}>Small</div>)
    });
    manager.setProps({components: [panel]});
    await settle();
    expect(bounds(content).height).toBeCloseTo(654);
    panel.setProps({panel: createPanel(<div style={{height: '70px'}}>Larger</div>)});
    await settle();
    expect(bounds(content).height).toBeCloseTo(614);
    deckStyle.remove();
  });

  it('validates the content element before modifying the host', () => {
    const parent = document.createElement('div');
    expect(
      () => new PanelManager({parentElement: parent, contentElement: document.createElement('div')})
    ).toThrow('direct child');
    expect(parent.className).toBe('');
  });
});
