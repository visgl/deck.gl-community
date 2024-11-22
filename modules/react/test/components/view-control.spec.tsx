// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as React from 'react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {cleanup, fireEvent, render} from '@testing-library/react';
import {ViewControl} from '../../src/components/view-control';

// NOTE: this line is important! It will clean up the jsdom properly.
afterEach(cleanup);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ViewControl', () => {
  it('should pass sanity check for pan buttons presence', () => {
    const {getByText} = render(<ViewControl zoomLevel={2} />);
    ['▲', '◀', '▶', '▼'].forEach((unicodeSymbol) => {
      expect(getByText(unicodeSymbol)).toBeTruthy();
    });
  });

  it('should record pressing ▲', async () => {
    const panBy = vi.fn();
    const deltaPan = 11;
    const {getByText} = render(<ViewControl panBy={panBy} deltaPan={deltaPan} zoomLevel={1} />);
    fireEvent.mouseDown(getByText('▲'));
    await sleep(150); // await long press
    expect(panBy).toHaveBeenCalledTimes(1);
  });

  it('should record pressing ¤ (recenter)', () => {
    const fitBounds = vi.fn();
    const {getByText} = render(<ViewControl fitBounds={fitBounds} zoomLevel={1} />);
    const reCenterButton = getByText('¤');
    expect(reCenterButton).toBeDefined();
    fireEvent.click(reCenterButton);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('should record changes through verticalSlider', () => {
    const zoomBy = vi.fn();
    const {container} = render(
      <ViewControl zoomBy={zoomBy} zoomLevel={1} minZoom={1} maxZoom={10} />
    );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const verticalSlider = container.querySelector('input') as HTMLInputElement;
    expect(verticalSlider).toBeTruthy();
    fireEvent.change(verticalSlider, {target: {value: 8}});
    expect(zoomBy).toHaveBeenLastCalledWith(7);
    expect(zoomBy).toHaveBeenCalledTimes(1);
  });

  // TODO: Appears to be a real failure.
  it.skip('should record changes through clicking on the plus and minus button', () => {
    const zoomBy = vi.fn();
    const {container, getByText} = render(
      <ViewControl zoomBy={zoomBy} zoomLevel={1} minZoom={0.01} maxZoom={4} />
    );
    const verticalSlider = container.querySelector('input');
    const minusButton = getByText('-');
    const plusButton = getByText('+');
    expect(minusButton).toBeTruthy();
    expect(plusButton).toBeTruthy();
    expect(verticalSlider).toBeTruthy();
    // Click minus once
    fireEvent.mouseDown(minusButton);
    expect(zoomBy).toHaveBeenLastCalledWith(-0.1);
    // Click plus twice, this should reset the previous minus
    fireEvent.mouseDown(plusButton);
    fireEvent.mouseDown(plusButton);
    expect(zoomBy).toHaveBeenLastCalledWith(0.1);
    // 1 + 2 = 3 mousedowns in total, triggering 3 zoomBys.
    expect(zoomBy).toHaveBeenCalledTimes(3);
  });
});
