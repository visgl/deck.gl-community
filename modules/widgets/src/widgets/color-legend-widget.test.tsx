// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {act} from 'preact/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {ColorLegendWidget} from './color-legend-widget';

import type {ColorLegendPayload} from './color-legend-widget';
import type {Deck} from '@deck.gl/core';

type MountedColorLegendWidget = {
  /** Mounted widget instance. */
  readonly widget: ColorLegendWidget;
  /** DOM root created through the deck.gl lifecycle. */
  readonly root: HTMLDivElement;
};

const mountedWidgets: MountedColorLegendWidget[] = [];

afterEach(() => {
  for (const {widget, root} of mountedWidgets.splice(0)) {
    act(() => widget.onRemove());
    root.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ColorLegendWidget', () => {
  it('renders a rich JSON round trip with continuous, categorical, and palette sections', () => {
    const payload = JSON.parse(JSON.stringify(RICH_PAYLOAD)) as ColorLegendPayload;
    const {widget, root} = mountWidget({payload, viewId: 'main'});

    expect(widget.id).toBe('color-legend');
    expect(widget.placement).toBe('bottom-right');
    expect(widget.viewId).toBe('main');
    expect(root.style.pointerEvents).toBe('none');
    expect(root.textContent).toContain('Latency');
    expect(root.textContent).toContain('P95 duration by operation');
    expect(root.textContent).toContain('Slow');
    expect(root.textContent).toContain('Fast');
    expect(root.textContent).toContain('Read');
    expect(root.textContent).toContain('Cached and local');
    expect(root.textContent).toContain('Hash-derived operations');
    expect(root.querySelectorAll('[data-testid="color-legend-gradient"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-testid="color-legend-swatch"]')).toHaveLength(5);
    expect(
      root.querySelector<HTMLElement>('[data-testid="color-legend-swatch"]')?.style.backgroundColor
    ).toBe('rgb(33, 150, 243)');
    expect(root.querySelector<HTMLElement>('[title="Fallback"]')?.style.backgroundColor).toBe(
      'rgba(128, 128, 128, 0.5)'
    );
  });

  it('renders a one-stop continuous scale as a solid color', () => {
    const {root} = mountWidget({
      payload: {
        id: 'single-stop',
        title: 'Status',
        sections: [
          {
            id: 'status',
            type: 'continuous',
            stops: [{label: 'Only value', color: '#ef4444'}]
          }
        ]
      }
    });

    const scale = root.querySelector<HTMLElement>('[data-testid="color-legend-gradient"]');
    expect(scale?.style.backgroundImage).toBe('');
    expect(scale?.style.backgroundColor).toBe('rgb(239, 68, 68)');
  });

  it('bounds categorical DOM while preserving exact overflow through expansion', () => {
    const payload: ColorLegendPayload = {
      id: 'many-categories',
      title: 'Components',
      sections: [
        {
          id: 'components',
          type: 'categorical',
          entries: Array.from({length: 150}, (_, index) => ({
            label: `Component ${index}`,
            color: [index, 64, 128, 255]
          })),
          totalCount: 1_000
        }
      ]
    };
    const {root} = mountWidget({payload});

    expect(root.querySelectorAll('[data-testid="color-legend-swatch"]')).toHaveLength(10);
    expect(root.textContent).toContain('+990 more');

    act(() =>
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Show all color categories"]')
        ?.click()
    );

    expect(root.querySelectorAll('[data-testid="color-legend-swatch"]')).toHaveLength(100);
    expect(root.textContent).toContain('Component 99');
    expect(root.textContent).toContain('+900 more');
    expect(root.textContent).not.toContain('Component 100');

    act(() =>
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Collapse color categories"]')
        ?.click()
    );
    expect(root.querySelectorAll('[data-testid="color-legend-swatch"]')).toHaveLength(10);
  });

  it('exposes optional entry hover text on its row, label, and swatch without blocking the canvas', () => {
    vi.stubGlobal('innerWidth', 1_024);
    const title = 'Keyword: WRITE · Source: save_data';
    const {root} = mountWidget({
      payload: {
        id: 'operations',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [
              {label: 'Save data', color: '#22c55e', title},
              {label: 'Read data', color: '#3b82f6'}
            ]
          }
        ]
      }
    });
    const [titledRow, plainRow] = Array.from(root.querySelectorAll('li'));

    expect(root.style.pointerEvents).toBe('none');
    expect(
      root.querySelector<HTMLElement>('[data-testid="color-legend"]')?.style.pointerEvents
    ).toBe('none');
    expect(titledRow?.title).toBe(title);
    expect(titledRow?.style.pointerEvents).toBe('auto');
    expect(
      titledRow?.querySelector('[data-testid="color-legend-swatch"]')?.getAttribute('title')
    ).toBe(title);
    expect(titledRow?.querySelector('span > span')?.getAttribute('title')).toBe(title);
    expect(plainRow?.title).toBe('');
    expect(plainRow?.style.pointerEvents).toBe('');
    expect(plainRow?.querySelector('span > span')?.getAttribute('title')).toBe('Read data');
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();

    vi.spyOn(titledRow!, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 120, 160, 16));
    act(() => {
      titledRow?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });

    const tooltip = document.querySelector<HTMLElement>(
      '[data-testid="color-legend-entry-tooltip"]'
    );
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.textContent).toBe(title);
    expect(tooltip?.parentElement).toBe(document.body);
    expect(root.contains(tooltip)).toBe(false);
    expect(tooltip?.style.position).toBe('fixed');
    expect(tooltip?.style.pointerEvents).toBe('none');
    expect(tooltip?.style.left).toBe('692px');
    expect(tooltip?.style.top).toBe('128px');
    expect(tooltip?.style.transform).toBe('translate(-100%, -50%)');

    act(() => {
      titledRow?.dispatchEvent(new MouseEvent('mouseleave', {bubbles: true}));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();
  });

  it('keeps expanded-row tooltips visible outside the scrollable legend and clears them on scroll', () => {
    const {root} = mountWidget({
      payload: {
        id: 'expanded-operations',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: Array.from({length: 12}, (_, index) => ({
              label: `Operation ${index}`,
              color: '#22c55e',
              title: `Keyword: OP_${index} · Source: operation_${index}`
            }))
          }
        ]
      }
    });

    act(() =>
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Show all color categories"]')
        ?.click()
    );
    const expandedList = root.querySelector('ul');
    const finalRow = Array.from(root.querySelectorAll('li')).find(row =>
      row.textContent?.includes('Operation 11')
    );
    expect(expandedList?.style.overflowY).toBe('auto');

    act(() => {
      finalRow?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });

    const tooltip = document.querySelector('[data-testid="color-legend-entry-tooltip"]');
    expect(tooltip?.textContent).toBe('Keyword: OP_11 · Source: operation_11');
    expect(tooltip?.parentElement).toBe(document.body);
    expect(expandedList?.contains(tooltip)).toBe(false);

    act(() => {
      expandedList?.dispatchEvent(new Event('scroll'));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();
  });

  it('preserves the resolved deck theme after portaling a tooltip outside the legend', () => {
    const {root} = mountWidget({
      payload: {
        id: 'dark-operations',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [{label: 'Save data', color: '#22c55e', title: 'Keyword: WRITE'}]
          }
        ]
      }
    });
    const legend = root.querySelector<HTMLElement>('[data-testid="color-legend"]');
    expect(legend).not.toBeNull();
    legend!.style.background = 'rgb(17, 24, 39)';
    legend!.style.color = 'rgb(243, 244, 246)';
    legend!.style.borderColor = 'rgb(75, 85, 99)';
    legend!.style.borderRadius = '9px';
    legend!.style.boxShadow = 'rgb(0, 0, 0) 0px 2px 4px';

    act(() => {
      root.querySelector('li')?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });

    const tooltip = document.querySelector<HTMLElement>(
      '[data-testid="color-legend-entry-tooltip"]'
    );
    expect(tooltip?.style.backgroundColor).toBe('rgb(17, 24, 39)');
    expect(tooltip?.style.color).toBe('rgb(243, 244, 246)');
    expect(tooltip?.style.borderColor).toBe('rgb(75, 85, 99)');
    expect(tooltip?.style.borderRadius).toBe('9px');
    expect(tooltip?.style.boxShadow).toBe('rgb(0, 0, 0) 0px 2px 4px 0px');
  });

  it('keeps long tooltip text inside narrow viewport boundaries', () => {
    vi.stubGlobal('innerWidth', 400);
    const {root} = mountWidget({
      payload: {
        id: 'narrow-operations',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [{label: 'Pipeline send', color: '#22c55e', title: 'Keyword: PIPE_SEND'}]
          }
        ]
      }
    });
    const row = root.querySelector('li');
    vi.spyOn(row!, 'getBoundingClientRect').mockReturnValue(new DOMRect(176, 120, 224, 16));

    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });

    const tooltip = document.querySelector<HTMLElement>(
      '[data-testid="color-legend-entry-tooltip"]'
    );
    expect(tooltip?.style.maxWidth).toBe('320px');
    expect(tooltip?.style.left).toBe('328px');
    expect(tooltip?.style.transform).toBe('translate(-100%, -50%)');
    expect(Number.parseInt(tooltip?.style.left ?? '0', 10) - 320).toBe(8);
  });

  it('vertically clamps a measured wrapped tooltip inside the viewport', () => {
    vi.stubGlobal('innerWidth', 240);
    vi.stubGlobal('innerHeight', 160);
    const {root} = mountWidget({
      payload: {
        id: 'vertical-clamp',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [
              {
                label: 'Pipeline send',
                color: '#22c55e',
                title:
                  'A long descriptive entry title that wraps across several lines in the tooltip'
              }
            ]
          }
        ]
      }
    });
    const row = root.querySelector('li');
    let rowBounds = new DOMRect(20, 140, 160, 16);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return this === row ? rowBounds : new DOMRect(0, 0, 224, 80);
    });

    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });

    let tooltip = document.querySelector<HTMLElement>('[data-testid="color-legend-entry-tooltip"]');
    expect(tooltip?.style.maxHeight).toBe('144px');
    expect(tooltip?.style.top).toBe('112px');

    rowBounds = new DOMRect(20, 0, 160, 16);
    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });

    tooltip = document.querySelector<HTMLElement>('[data-testid="color-legend-entry-tooltip"]');
    expect(tooltip?.style.top).toBe('48px');
  });

  it('opens an accessible tooltip when a titled legend entry receives keyboard focus', () => {
    const {root} = mountWidget({
      payload: {
        id: 'keyboard-operations',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [
              {label: 'Save data', color: '#22c55e', title: 'Keyword: WRITE'},
              {label: 'Read data', color: '#3b82f6'}
            ]
          }
        ]
      }
    });
    const [titledRow, plainRow] = Array.from(root.querySelectorAll('li'));
    expect(titledRow?.tabIndex).toBe(0);
    expect(plainRow?.hasAttribute('tabindex')).toBe(false);

    act(() => {
      titledRow?.focus();
    });

    const tooltip = document.querySelector<HTMLElement>(
      '[data-testid="color-legend-entry-tooltip"]'
    );
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.textContent).toBe('Keyword: WRITE');
    expect(titledRow?.getAttribute('aria-describedby')).toBe(tooltip?.id);

    act(() => {
      titledRow?.blur();
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();
    expect(titledRow?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('clears tooltips when a scrollable ancestor moves or the viewport resizes', () => {
    const {root} = mountWidget({
      payload: {
        id: 'ancestor-operations',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [{label: 'Save data', color: '#22c55e', title: 'Keyword: WRITE'}]
          }
        ]
      }
    });
    const ancestor = document.createElement('section');
    document.body.append(ancestor);
    ancestor.append(root);
    const row = root.querySelector('li');

    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).not.toBeNull();

    act(() => {
      ancestor.dispatchEvent(new Event('scroll'));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();

    document.body.append(root);
    ancestor.remove();
  });

  it('removes stale hover text when the section payload changes without replacing its widget', () => {
    const {root, widget} = mountWidget({
      payload: {
        id: 'block-types',
        title: 'Operations',
        sections: [
          {
            id: 'block-types',
            type: 'categorical',
            entries: [{label: 'Parameter fetch', color: '#22c55e', title: 'Keyword: PARAM_FETCH'}]
          }
        ]
      }
    });

    act(() => {
      root.querySelector('li')?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).not.toBeNull();

    act(() =>
      widget.setProps({
        payload: {
          id: 'block-types',
          title: 'Traditional operations',
          sections: [
            {
              id: 'block-types',
              type: 'categorical',
              entries: [{label: 'ATTENTION', color: '#3b82f6'}]
            }
          ]
        }
      })
    );

    expect(root.textContent).toContain('ATTENTION');
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();
  });

  it('removes a visible portaled tooltip when the owning legend widget is removed', () => {
    const {root, widget} = mountWidget({
      payload: {
        id: 'removal',
        title: 'Operations',
        sections: [
          {
            id: 'operations',
            type: 'categorical',
            entries: [{label: 'Save data', color: '#22c55e', title: 'Keyword: WRITE'}]
          }
        ]
      }
    });
    const row = root.querySelector('li');
    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    });
    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).not.toBeNull();

    act(() => widget.onRemove());

    expect(document.querySelector('[data-testid="color-legend-entry-tooltip"]')).toBeNull();
  });

  it('updates its payload, placement, view, and close action without replacing the widget', () => {
    const onClose = vi.fn();
    const {widget, root} = mountWidget({payload: RICH_PAYLOAD, onClose});

    act(() =>
      root.querySelector<HTMLButtonElement>('button[aria-label="Close color legend"]')?.click()
    );
    expect(onClose).toHaveBeenCalledOnce();

    act(() =>
      widget.setProps({
        placement: 'top-left',
        viewId: 'overview',
        payload: {
          id: 'status',
          title: 'Status',
          sections: [
            {
              id: 'status-values',
              type: 'categorical',
              entries: [{label: 'Healthy', color: '#22c55e'}]
            }
          ]
        }
      })
    );

    expect(widget.placement).toBe('top-left');
    expect(widget.viewId).toBe('overview');
    expect(root.textContent).toContain('Healthy');
    expect(root.textContent).not.toContain('Latency');
  });
});

const RICH_PAYLOAD: ColorLegendPayload = {
  id: 'latency',
  title: 'Latency',
  description: 'P95 duration by operation',
  sections: [
    {
      id: 'duration',
      type: 'continuous',
      title: 'Duration',
      stops: [
        {label: 'Fast', color: '#22c55e'},
        {label: 'Slow', color: '#ef4444'}
      ]
    },
    {
      id: 'operation',
      type: 'categorical',
      entries: [
        {label: 'Read', description: 'Cached and local', color: [33, 150, 243]},
        {label: 'Write', color: [156, 39, 176, 255]}
      ]
    },
    {
      id: 'fallback',
      type: 'palette',
      label: 'Hash-derived operations',
      colors: [
        {color: '#ffc107'},
        {color: [128, 128, 128, 128], label: 'Fallback'},
        {color: 'rebeccapurple'}
      ]
    }
  ]
};

/** Mounts one widget through the same lifecycle hooks deck.gl calls. */
function mountWidget(
  props: ConstructorParameters<typeof ColorLegendWidget>[0]
): MountedColorLegendWidget {
  const widget = new ColorLegendWidget(props);
  const root = widget._onAdd({deck: {} as Deck, viewId: props.viewId ?? null});
  widget.rootElement = root;
  document.body.append(root);
  act(() => widget.updateHTML());
  mountedWidgets.push({widget, root});
  return {widget, root};
}
