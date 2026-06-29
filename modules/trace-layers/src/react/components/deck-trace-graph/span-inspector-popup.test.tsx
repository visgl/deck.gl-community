import {useState} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX} from './cards/trace-span-card/trace-span-card-types';
import {SpanInspectorPopup} from './span-inspector-popup';
import {SPAN_INSPECTOR_DEFAULT_WIDTH_PX} from './span-inspector-popup-utils';

import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const DEFAULT_SPAN_INSPECTOR_POPUP_RECT = {
  fixedHeightPx: 64,
  bottomPx: 1024,
  rightPx: 980
};
let spanInspectorPopupRect = {...DEFAULT_SPAN_INSPECTOR_POPUP_RECT};
const originalGetBoundingClientRect = HTMLDivElement.prototype.getBoundingClientRect;

/**
 * Host the popup with local resize state so tests can exercise the full interaction lifecycle.
 */
function SpanInspectorPopupHarness({onClose}: {onClose?: () => void}) {
  const [widthPx, setWidthPx] = useState(SPAN_INSPECTOR_DEFAULT_WIDTH_PX);
  const [tabBodyHeightPx, setTabBodyHeightPx] = useState(TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX);

  return (
    <SpanInspectorPopup
      widthPx={widthPx}
      onWidthChange={setWidthPx}
      tabBodyHeightPx={tabBodyHeightPx}
      onTabBodyHeightChange={setTabBodyHeightPx}
      onClose={onClose}
    >
      <div className="px-2 py-1">
        <div data-testid="span-inspector-width">{widthPx}</div>
        <div data-testid="span-inspector-tab-body-height">{tabBodyHeightPx}</div>
      </div>
    </SpanInspectorPopup>
  );
}

/**
 * Render the popup harness into a detached happy-dom root.
 */
function renderSpanInspectorPopup(options: {onClose?: () => void} = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  installSpanInspectorPopupRectMock();
  flushSync(() => {
    root?.render(<SpanInspectorPopupHarness onClose={options.onClose} />);
  });
}

/**
 * Return the rendered popup shell.
 */
function getSpanInspectorPopup(): HTMLDivElement {
  const popup = document.querySelector('[data-testid="span-inspector-popup"]');
  if (!(popup instanceof HTMLDivElement)) {
    throw new Error('Expected Span Inspector popup');
  }
  return popup;
}

/**
 * Return the rendered resize handle.
 */
function getSpanInspectorResizeHandle(): HTMLButtonElement {
  const handle = document.querySelector('[data-testid="span-inspector-resize-handle"]');
  if (!(handle instanceof HTMLButtonElement)) {
    throw new Error('Expected Span Inspector resize handle');
  }
  return handle;
}

/**
 * Return the rendered close button.
 */
function getSpanInspectorCloseButton(): HTMLButtonElement {
  const button = document.querySelector('[data-testid="span-inspector-close"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected Span Inspector close button');
  }
  return button;
}

/**
 * Read the current tab-body height exposed by the harness.
 */
function getRenderedTabBodyHeightPx(): number {
  const value = document.querySelector(
    '[data-testid="span-inspector-tab-body-height"]'
  )?.textContent;
  if (!value) {
    throw new Error('Expected rendered tab-body height');
  }
  return Number(value);
}

/**
 * Read the current popup width exposed by the harness.
 */
function getRenderedWidthPx(): number {
  const value = document.querySelector('[data-testid="span-inspector-width"]')?.textContent;
  if (!value) {
    throw new Error('Expected rendered popup width');
  }
  return Number(value);
}

/**
 * Read the current tab-body height before the harness text is visible during first layout.
 */
function getRenderedTabBodyHeightPxOrDefault(): number {
  const value = document.querySelector(
    '[data-testid="span-inspector-tab-body-height"]'
  )?.textContent;
  return value ? Number(value) : TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX;
}

/**
 * Stub the popup bounds before first render so resize clamping is deterministic in browsers.
 */
function installSpanInspectorPopupRectMock() {
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLDivElement
  ) {
    if (this.dataset.testid === 'span-inspector-popup') {
      return {
        width: Number.parseFloat(this.style.width) || SPAN_INSPECTOR_DEFAULT_WIDTH_PX,
        height: getRenderedTabBodyHeightPxOrDefault() + spanInspectorPopupRect.fixedHeightPx,
        bottom: spanInspectorPopupRect.bottomPx,
        right: spanInspectorPopupRect.rightPx
      } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  });
}

/**
 * Update the popup bounds used by the deterministic resize clamp.
 */
function setSpanInspectorPopupRect(fixedHeightPx: number, bottomPx: number, rightPx = 980) {
  spanInspectorPopupRect = {fixedHeightPx, bottomPx, rightPx};
}

/**
 * Drive one pointer-based resize interaction on the popup handle.
 */
async function dragResizeHandle(
  startClientX: number,
  startClientY: number,
  nextClientX: number,
  nextClientY: number
) {
  const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;
  const handle = getSpanInspectorResizeHandle();

  flushSync(() => {
    handle.dispatchEvent(
      new PointerEventCtor('pointerdown', {
        bubbles: true,
        clientX: startClientX,
        clientY: startClientY
      })
    );
  });
  await Promise.resolve();

  flushSync(() => {
    window.dispatchEvent(
      new PointerEventCtor('pointermove', {
        bubbles: true,
        clientX: nextClientX,
        clientY: nextClientY
      })
    );
    window.dispatchEvent(
      new PointerEventCtor('pointerup', {
        bubbles: true,
        clientX: nextClientX,
        clientY: nextClientY
      })
    );
  });
  await Promise.resolve();
}

/**
 * Start a resize interaction without ending it.
 */
async function startResizeHandleDrag(startClientX: number, startClientY: number) {
  const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;
  const handle = getSpanInspectorResizeHandle();

  flushSync(() => {
    handle.dispatchEvent(
      new PointerEventCtor('pointerdown', {
        bubbles: true,
        clientX: startClientX,
        clientY: startClientY
      })
    );
  });
  await Promise.resolve();
}

/**
 * Dispatch one global resize pointer move.
 */
async function moveResizePointer(nextClientX: number, nextClientY: number) {
  const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;

  flushSync(() => {
    window.dispatchEvent(
      new PointerEventCtor('pointermove', {
        bubbles: true,
        clientX: nextClientX,
        clientY: nextClientY
      })
    );
  });
  await Promise.resolve();
}

afterEach(() => {
  flushSync(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  spanInspectorPopupRect = {...DEFAULT_SPAN_INSPECTOR_POPUP_RECT};
  vi.restoreAllMocks();
});

describe('SpanInspectorPopup', () => {
  it('renders the visible title and keeps the default tab-body height before resizing', () => {
    renderSpanInspectorPopup();

    expect(getSpanInspectorPopup().textContent).toContain('Span Inspector');
    expect(getRenderedWidthPx()).toBe(SPAN_INSPECTOR_DEFAULT_WIDTH_PX);
    expect(getRenderedTabBodyHeightPx()).toBe(TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX);
  });

  it('calls the optional close handler from the header close button', () => {
    const onClose = vi.fn();
    renderSpanInspectorPopup({onClose});

    flushSync(() => {
      getSpanInspectorCloseButton().click();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('grows the popup width and tab-body height when the resize handle is dragged up-left', async () => {
    renderSpanInspectorPopup();
    setSpanInspectorPopupRect(64, 900);

    await dragResizeHandle(260, 220, 200, 150);

    expect(getRenderedWidthPx()).toBe(580);
    expect(getRenderedTabBodyHeightPx()).toBe(186);
  });

  it('clamps the popup width and tab-body height to the supported viewport bounds', async () => {
    renderSpanInspectorPopup();
    setSpanInspectorPopupRect(64, 300, 700);

    await dragResizeHandle(260, 240, 0, 0);
    expect(getRenderedWidthPx()).toBe(688);
    expect(getRenderedTabBodyHeightPx()).toBe(224);

    await dragResizeHandle(260, 240, 800, 520);
    expect(getRenderedWidthPx()).toBe(320);
    expect(getRenderedTabBodyHeightPx()).toBe(TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX);
  });

  it('stops resizing on Escape even if no pointerup reaches the popup', async () => {
    renderSpanInspectorPopup();
    setSpanInspectorPopupRect(64, 900);

    await startResizeHandleDrag(260, 220);

    flushSync(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Escape'}));
    });
    await moveResizePointer(200, 150);

    expect(getRenderedWidthPx()).toBe(SPAN_INSPECTOR_DEFAULT_WIDTH_PX);
    expect(getRenderedTabBodyHeightPx()).toBe(TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX);
  });

  it('stops resizing from capture-phase pointerup before propagation can be stopped', async () => {
    renderSpanInspectorPopup();
    setSpanInspectorPopupRect(64, 900);
    const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;
    const handle = getSpanInspectorResizeHandle();
    const stopPointerUp = (event: PointerEvent | MouseEvent) => {
      event.stopImmediatePropagation();
    };

    await startResizeHandleDrag(260, 220);
    handle.addEventListener('pointerup', stopPointerUp);
    flushSync(() => {
      handle.dispatchEvent(
        new PointerEventCtor('pointerup', {
          bubbles: true,
          clientX: 260,
          clientY: 220
        })
      );
    });
    handle.removeEventListener('pointerup', stopPointerUp);
    await moveResizePointer(200, 150);

    expect(getRenderedWidthPx()).toBe(SPAN_INSPECTOR_DEFAULT_WIDTH_PX);
    expect(getRenderedTabBodyHeightPx()).toBe(TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX);
  });
});
