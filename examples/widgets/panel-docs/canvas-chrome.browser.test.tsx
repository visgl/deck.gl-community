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
    const input = host.querySelector('input')!;
    input.value = 'Preserved scene';
    host.querySelector<HTMLButtonElement>('[aria-label="Pin panel"]')!.click();
    await settle();
    expect(host.textContent).toContain('Pinned right');
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
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('Preserved scene');
  } finally {
    cleanup();
    expect(host.children.length).toBe(0);
    host.remove();
  }
});
