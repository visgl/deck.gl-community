import {describe, expect, it, vi} from 'vitest';

import {ImperativeDeckController} from './deck-controller';

import type {SpanRef} from '../../trace/index';
import type {ImperativeDeckControllerTarget} from './deck-controller';

/** Creates a controller target stub for delegation tests. */
function createImperativeDeckControllerTarget(): ImperativeDeckControllerTarget {
  return {
    panLeft: vi.fn(),
    panRight: vi.fn(),
    panUp: vi.fn(),
    panDown: vi.fn(),
    panUpFast: vi.fn(),
    panDownFast: vi.fn(),
    zoomInHorizontal: vi.fn(),
    zoomOutHorizontal: vi.fn(),
    zoomToSpanRef: vi.fn(),
    centerOnTime: vi.fn(),
    trackTime: vi.fn(),
    fitYToBounds: vi.fn(),
    centerOnTimeAndFitY: vi.fn(),
    resetView: vi.fn(),
    expandAllProcesses: vi.fn(),
    areAllProcessesExpanded: vi.fn(() => false)
  };
}

describe('ImperativeDeckController', () => {
  it('is safe to call without an attached target', () => {
    const controller = new ImperativeDeckController();

    controller.zoomToSpanRef(0 as SpanRef);
    controller.resetView();
    controller.expandAllProcesses(true);

    expect(controller.areAllProcessesExpanded()).toBe(false);
  });

  it('delegates commands and queries to the attached target', () => {
    const controller = new ImperativeDeckController();
    const target = createImperativeDeckControllerTarget();

    controller.attach(target);
    controller.zoomToSpanRef(3 as SpanRef);
    controller.panLeft();
    controller.panRight();
    controller.panUp();
    controller.panDown();
    controller.panUpFast();
    controller.panDownFast();
    controller.zoomInHorizontal();
    controller.zoomOutHorizontal();
    controller.centerOnTime(1_234);
    controller.trackTime(2_345);
    controller.fitYToBounds();
    controller.centerOnTimeAndFitY(5_678);
    controller.resetView();
    controller.expandAllProcesses(true);

    expect(target.panLeft).toHaveBeenCalledOnce();
    expect(target.panRight).toHaveBeenCalledOnce();
    expect(target.panUp).toHaveBeenCalledOnce();
    expect(target.panDown).toHaveBeenCalledOnce();
    expect(target.panUpFast).toHaveBeenCalledOnce();
    expect(target.panDownFast).toHaveBeenCalledOnce();
    expect(target.zoomInHorizontal).toHaveBeenCalledOnce();
    expect(target.zoomOutHorizontal).toHaveBeenCalledOnce();
    expect(target.zoomToSpanRef).toHaveBeenCalledWith(3);
    expect(target.centerOnTime).toHaveBeenCalledWith(1_234);
    expect(target.trackTime).toHaveBeenCalledWith(2_345);
    expect(target.fitYToBounds).toHaveBeenCalledOnce();
    expect(target.centerOnTimeAndFitY).toHaveBeenCalledWith(5_678);
    expect(target.resetView).toHaveBeenCalledOnce();
    expect(target.expandAllProcesses).toHaveBeenCalledWith(true);
    expect(controller.areAllProcessesExpanded()).toBe(false);
    expect(target.areAllProcessesExpanded).toHaveBeenCalledOnce();
  });

  it('clears delegation when the attached target is detached', () => {
    const controller = new ImperativeDeckController();
    const target = createImperativeDeckControllerTarget();

    controller.attach(target);
    controller.detach(target);
    controller.zoomToSpanRef(1 as SpanRef);

    expect(target.zoomToSpanRef).not.toHaveBeenCalled();
    expect(controller.areAllProcessesExpanded()).toBe(false);
  });

  it('keeps the most recently attached target active', () => {
    const controller = new ImperativeDeckController();
    const firstTarget = createImperativeDeckControllerTarget();
    const secondTarget = createImperativeDeckControllerTarget();

    controller.attach(firstTarget);
    controller.attach(secondTarget);
    controller.detach(firstTarget);
    controller.expandAllProcesses(false);

    expect(firstTarget.expandAllProcesses).not.toHaveBeenCalled();
    expect(secondTarget.expandAllProcesses).toHaveBeenCalledWith(false);
  });
});
