import {expect, it} from 'vitest';
import {mountCanvasChromeExample} from './canvas-chrome';

it('keeps the canvas and adaptive inspector in sync with the live chrome example', async () => {
  const host = document.createElement('div');
  Object.assign(host.style, {width: '960px', height: '600px'});
  document.body.append(host);
  const cleanup = mountCanvasChromeExample(host);
  const settle = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    await settle();
    const canvas = host.querySelector('canvas')!;
    const originalWidth = canvas.getBoundingClientRect().width;
    const content = canvas.parentElement!;
    const center = content.parentElement!;
    const inspector = host.querySelector<HTMLElement>('[data-pinnable="true"]')!;
    expect(center.contains(inspector)).toBe(true);
    expect(getComputedStyle(inspector).borderRadius).toBe('12px');
    const pinButton = inspector.querySelector<HTMLButtonElement>('[aria-label="Pin panel"]')!;
    expect(pinButton.title).toBe('Pin panel');
    expect(pinButton.textContent).toBe('');
    expect(pinButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const input = host.querySelector('input')!;
    input.value = 'Preserved scene';
    host.querySelector<HTMLButtonElement>('[aria-label="Pin panel"]')!.click();
    await settle();
    expect(host.textContent).toContain('Pinned right');
    expect(center.contains(inspector)).toBe(false);
    expect(content.contains(inspector)).toBe(false);
    expect(inspector.parentElement?.getAttribute('data-side')).toBe('right');
    expect(getComputedStyle(inspector).borderRadius).toBe('0px');
    expect(getComputedStyle(inspector).boxShadow).toBe('none');
    expect(canvas.getBoundingClientRect().width).toBeCloseTo(originalWidth - 280);
    expect(canvas.width).toBe(
      Math.round(canvas.getBoundingClientRect().width * window.devicePixelRatio)
    );
    const edge = host.querySelector('select')!;
    edge.value = 'bottom';
    edge.dispatchEvent(new Event('change', {bubbles: true}));
    await settle();
    expect(host.textContent).toContain('Pinned bottom');
    expect(canvas.getBoundingClientRect().width).toBeCloseTo(originalWidth);
    host.querySelector<HTMLButtonElement>('[aria-label="Unpin panel"]')!.click();
    await settle();
    expect(center.contains(inspector)).toBe(true);
    expect(getComputedStyle(inspector).borderRadius).toBe('12px');
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('Preserved scene');
  } finally {
    cleanup();
    expect(host.children.length).toBe(0);
    host.remove();
  }
});
