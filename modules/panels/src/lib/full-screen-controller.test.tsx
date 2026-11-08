import {afterEach, describe, expect, it, vi} from 'vitest';
import {FullScreenController} from './full-screen-controller';

const controllers: FullScreenController[] = [];
const create = () => {
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  const target = document.createElement('div');
  target.style.cssText = 'width:300px;height:200px;background:#123;';
  target.setAttribute('role', 'region');
  target.innerHTML =
    '<canvas></canvas><button>First</button><button disabled>Disabled</button><button style="display:none">Hidden</button><button>Last</button>';
  document.body.append(opener, target);
  opener.focus();
  const controller = new FullScreenController({target});
  controllers.push(controller);
  return {opener, target, controller};
};
const missing = (target: HTMLElement) =>
  Object.defineProperty(target, 'requestFullscreen', {value: undefined, configurable: true});
const key = (value: string, shiftKey = false) =>
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', {key: value, shiftKey, bubbles: true, cancelable: true})
  );

afterEach(() => {
  for (const controller of controllers) controller.destroy();
  controllers.length = 0;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('FullScreenController', () => {
  it('fills the viewport without remounting, locks scrolling, and restores attributes and focus', async () => {
    const {target, opener, controller} = create();
    missing(target);
    const canvas = target.querySelector('canvas');
    const parent = target.parentElement;
    const style = target.getAttribute('style');
    await controller.enter();
    expect(controller.mode).toBe('fallback');
    expect(target.getAttribute('role')).toBe('dialog');
    expect(target.getAttribute('aria-modal')).toBe('true');
    expect(getComputedStyle(document.body).overflow).toBe('hidden');
    document.body.style.overflow = 'auto';
    expect(getComputedStyle(document.body).overflow).toBe('hidden');
    expect(target.getBoundingClientRect().width).toBe(window.innerWidth);
    expect(target.getBoundingClientRect().height).toBe(window.innerHeight);
    expect(target.querySelector('canvas')).toBe(canvas);
    expect(target.parentElement).toBe(parent);
    await controller.exit();
    expect(controller.active).toBe(false);
    expect(target.getAttribute('style')).toBe(style);
    expect(target.getAttribute('role')).toBe('region');
    expect(target.hasAttribute('aria-modal')).toBe(false);
    expect(target.hasAttribute('popover')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(getComputedStyle(document.body).overflow).toBe('auto');
    document.body.style.removeProperty('overflow');
  });

  it('falls back when native fullscreen rejects, contains focus, and exits on Escape', async () => {
    const {target, controller} = create();
    Object.defineProperty(target, 'requestFullscreen', {
      value: () => Promise.reject(new Error('Denied')),
      configurable: true
    });
    await controller.enter();
    const [first, , , last] = [...target.querySelectorAll('button')];
    expect(document.activeElement).toBe(first);
    key('Tab', true);
    expect(document.activeElement).toBe(last);
    key('Tab');
    expect(document.activeElement).toBe(first);
    key('Escape');
    expect(controller.active).toBe(false);
    expect(document.documentElement.hasAttribute('data-deck-panel-fullscreen-lock')).toBe(false);
  });

  it('uses native fullscreen and follows external exit', async () => {
    const {target, controller} = create();
    let element: Element | null = null;
    vi.spyOn(document, 'fullscreenElement', 'get').mockImplementation(() => element);
    Object.defineProperty(target, 'requestFullscreen', {
      configurable: true,
      value: async () => {
        element = target;
        document.dispatchEvent(new Event('fullscreenchange'));
      }
    });
    await controller.enter();
    expect(controller.mode).toBe('native');
    expect(target.hasAttribute('aria-modal')).toBe(false);
    element = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(controller.mode).toBe('none');
  });

  it('cancels a pending request and exits a late native result after destruction', async () => {
    const {target, controller} = create();
    let element: Element | null = null;
    let resolve!: () => void;
    vi.spyOn(document, 'fullscreenElement', 'get').mockImplementation(() => element);
    const exit = vi.spyOn(document, 'exitFullscreen').mockImplementation(async () => {
      element = null;
    });
    Object.defineProperty(target, 'requestFullscreen', {
      configurable: true,
      value: () =>
        new Promise<void>(done => {
          resolve = done;
        })
    });
    const entering = controller.enter();
    controller.destroy();
    element = target;
    resolve();
    await entering;
    expect(exit).toHaveBeenCalledOnce();
    expect(controller.active).toBe(false);
    expect(target.hasAttribute('aria-modal')).toBe(false);
    await expect(controller.enter()).rejects.toThrow('destroyed');
  });

  it('releases locks on removal and transfers ownership between controllers', async () => {
    const a = create();
    const b = create();
    missing(a.target);
    missing(b.target);
    await a.controller.enter();
    await b.controller.enter();
    expect(a.controller.active).toBe(false);
    expect(b.controller.active).toBe(true);
    b.target.remove();
    b.controller.destroy();
    expect(document.documentElement.hasAttribute('data-deck-panel-fullscreen-lock')).toBe(false);
    expect(document.querySelector('[data-deck-panel-fullscreen="fallback"]')).toBe(null);
    expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
  });

  it('releases fallback locks when an external caller closes the popover', async () => {
    const {target, controller} = create();
    missing(target);
    await controller.enter();
    target.hidePopover();
    await vi.waitFor(() => expect(controller.mode).toBe('none'));
    expect(document.documentElement.hasAttribute('data-deck-panel-fullscreen-lock')).toBe(false);
    expect(target.getAttribute('role')).toBe('region');
  });

  it('keeps a single owner when two controllers enter while another exits', async () => {
    const a = create();
    const b = create();
    const c = create();
    for (const value of [a, b, c]) missing(value.target);
    await a.controller.enter();
    await Promise.all([b.controller.enter(), c.controller.enter()]);
    expect([a, b, c].filter(value => value.controller.active)).toHaveLength(1);
    expect(document.querySelectorAll('[data-deck-panel-fullscreen="fallback"]')).toHaveLength(1);
    const active = [a, b, c].find(value => value.controller.active)!;
    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden');
    await active.controller.exit();
    expect(document.documentElement.hasAttribute('data-deck-panel-fullscreen-lock')).toBe(false);
  });

  it('handles a target with no focusable children and restores existing attributes', async () => {
    const {target, controller} = create();
    target.innerHTML = '';
    target.setAttribute('tabindex', '3');
    target.setAttribute('aria-modal', 'false');
    missing(target);
    await controller.enter();
    key('Tab');
    expect(document.activeElement).toBe(target);
    await controller.exit();
    expect(target.getAttribute('tabindex')).toBe('3');
    expect(target.getAttribute('aria-modal')).toBe('false');
  });
});
