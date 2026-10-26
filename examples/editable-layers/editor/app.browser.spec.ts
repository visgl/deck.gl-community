// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {mountEditableLayersEditorExample} from './app';

test('draws a polygon with real clicks on the React DeckGL base map', async () => {
  await page.viewport(1000, 700);
  const container = document.createElement('div');
  Object.assign(container.style, {position: 'relative', width: '900px', height: '600px'});
  document.body.append(container);
  const cleanup = mountEditableLayersEditorExample(container);
  const featureCount = () => container.textContent?.match(/Features:\s*(\d+)/)?.[1];
  try {
    await expect.poll(featureCount, {timeout: 10000}).toBe('2');
    const drawPolygon = () => container.querySelector<HTMLElement>('[title="Draw a polygon"]');
    await expect.poll(drawPolygon).toBeTruthy();
    await userEvent.click(drawPolygon()!);
    await expect.poll(() => container.textContent).toContain('Mode: Poly');

    // Click whatever the browser hit-tests at each point, as a user would.
    const rect = container.getBoundingClientRect();
    const targetAt = (x: number, y: number) => {
      const element = document.elementFromPoint(rect.left + x, rect.top + y) as HTMLElement;
      const box = element.getBoundingClientRect();
      return {element, position: {x: rect.left + x - box.left, y: rect.top + y - box.top}};
    };
    const points: [number, number][] = [
      [420, 260],
      [540, 300],
      [470, 400]
    ];
    // <DeckGL> renders its <Map> child in a view element above deck's canvas; input must reach
    // the layer through it. The hit target may be the map's own canvas once MapLibre loads.
    const deckCanvas = container.querySelector('.deck-events-root > canvas');
    const first = targetAt(...points[0]);
    expect(deckCanvas).toBeTruthy();
    expect(first.element).not.toBe(deckCanvas);
    expect(first.element.closest('[id^="view-"]')).toBeTruthy();

    for (const [x, y] of points.slice(0, -1)) {
      const {element, position} = targetAt(x, y);
      await userEvent.click(element, {position});
    }
    const last = targetAt(...points.at(-1)!);
    await userEvent.dblClick(last.element, {position: last.position});

    await expect.poll(featureCount).toBe('3');
  } finally {
    cleanup();
    container.remove();
  }
}, 30000);
