import * as React from 'react';
import {cleanup, fireEvent, render} from '@testing-library/react';
import ViewControl from '../src/components/view-control.jsx';

// NOTE: this line is important! It will clean up the jsdom properly.
afterEach(cleanup);

describe('ViewControl', () => {
  it('should pass sanity check for pan buttons presence', () => {
    const {getByText} = render(<ViewControl zoomLevel={2} />);
    ['▲', '◀', '▶', '▼'].forEach((unicodeSymbol) => {
      expect(getByText(unicodeSymbol)).toBeTruthy();
    });
  });

  it('should record pressing ▲', () => {
    const panBy = jest.fn();
    const deltaPan = 11;
    const {getByText} = render(<ViewControl panBy={panBy} deltaPan={deltaPan} zoomLevel={1} />);
    fireEvent.mouseDown(getByText('▲'));
    expect(panBy).toHaveBeenCalledTimes(1);
  });

  it('should record pressing ¤ (recenter)', () => {
    const fitBounds = jest.fn();
    const {getByText} = render(<ViewControl fitBounds={fitBounds} zoomLevel={1} />);
    const reCenterButton = getByText('¤');
    expect(reCenterButton).toBeDefined();
    fireEvent.click(reCenterButton);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('should record changes through verticalSlider', () => {
    const zoomBy = jest.fn();
    const {container} = render(
      <ViewControl zoomBy={zoomBy} zoomLevel={1} minZoom={1} maxZoom={10} />
    );
    const verticalSlider = container.querySelector('input');
    expect(verticalSlider).toBeTruthy();
    fireEvent.change(verticalSlider, {target: {value: 8}});
    expect(zoomBy).toHaveBeenLastCalledWith(7);
    expect(zoomBy).toHaveBeenCalledTimes(1);
  });

  it('should record changes through clicking on the plus and minus button', () => {
    const zoomBy = jest.fn();
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
