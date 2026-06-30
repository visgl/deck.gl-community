import {useEffect} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TraceHoverPopupWidget} from './trace-hover-popup-widget';

type MockViewport = {
  /** Stable mock view id used by the popup widget. */
  id: string;
  /** Projects world coordinates into fixed pixel coordinates for the popup widget. */
  project: (position: number[]) => [number, number];
};

let container: HTMLDivElement | null = null;

type PopupCleanupProbeProps = {
  /** Called when the popup probe is unmounted from the React root. */
  onCleanup: () => void;
};

describe('TraceHoverPopupWidget', () => {
  afterEach(() => {
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('does not render bridged React content during widget construction', async () => {
    const widget = new TraceHoverPopupWidget({
      isVisible: true,
      viewId: 'main',
      position: [10, 20],
      reactContent: <div>Constructor hover card</div>
    });

    await waitForPopupRender();

    expect(getPopupContentElement(widget)?.textContent).toBe('');
  });

  it('updates popup content in place without leaving stale rendered text behind', async () => {
    const widget = new TraceHoverPopupWidget({
      isVisible: true,
      viewId: 'main',
      position: [10, 20],
      reactContent: <div>First hover card</div>
    });

    await mountWidget(widget);
    expect(getPopupContentElement(widget)?.textContent).toContain('First hover card');
    expect(getPopupContentElement(widget)?.textContent).not.toContain('Second hover card');

    widget.setTraceHoverPopupProps({
      isVisible: true,
      viewId: 'main',
      position: [30, 40],
      reactContent: <div>Second hover card</div>
    });
    await waitForPopupRender();

    expect(getPopupContentElement(widget)?.textContent).toContain('Second hover card');
    expect(getPopupContentElement(widget)?.textContent).not.toContain('First hover card');
    expect(getPopupContentElement(widget)?.textContent).not.toContain('undefined');
  });

  it('unmounts the React content tree when the widget is removed', async () => {
    const cleanupSpy = vi.fn();
    const widget = new TraceHoverPopupWidget({
      isVisible: true,
      viewId: 'main',
      position: [10, 20],
      reactContent: <PopupCleanupProbe onCleanup={cleanupSpy} />
    });

    await mountWidget(widget);
    expect(getPopupContentElement(widget)?.textContent).toContain('cleanup probe');

    widget.onRemove();
    await waitForPopupRender();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Mounts one popup widget into a detached DOM root with a predictable viewport projection.
 */
async function mountWidget(widget: TraceHoverPopupWidget): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  widget.onAdd?.({deck: {} as never, viewId: 'main'});
  widget.onViewportChange(createMockViewport());
  widget.onRenderHTML(container);
  await waitForPopupRender();
}

/**
 * Creates a deterministic viewport mock for popup projection tests.
 */
function createMockViewport(): MockViewport {
  return {
    id: 'main',
    project: position => [position[0] ?? 0, position[1] ?? 0]
  };
}

/**
 * Waits for both the popup widget DOM render and the bridged React root update.
 */
async function waitForPopupRender(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Returns the stable React host element managed by the popup widget bridge.
 */
function getPopupContentElement(widget: TraceHoverPopupWidget): HTMLElement | null {
  return widget.getContentElement();
}

/**
 * Emits one cleanup callback so tests can verify the React subtree unmounts.
 */
function PopupCleanupProbe(props: PopupCleanupProbeProps) {
  usePopupCleanup(props.onCleanup);
  return <div>cleanup probe</div>;
}

/**
 * Registers one unmount cleanup callback for popup widget lifecycle assertions.
 */
function usePopupCleanup(onCleanup: () => void): void {
  useEffect(() => onCleanup, [onCleanup]);
}
