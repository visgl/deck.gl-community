/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {BoxPanelWidget} from './box-widget';

import type {WidgetPanel} from './widget-containers';

const panel: WidgetPanel = {
  id: 'box-panel',
  title: 'Box Panel',
  content: <div>box content</div>
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BoxPanelWidget', () => {
  it('renders title and direct panel content', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new BoxPanelWidget({
      id: 'box-widget-basic',
      title: 'Widget Panels',
      panel
    });

    widget.onRenderHTML(root);

    expect(root.textContent).toContain('Widget Panels');
    expect(root.textContent).toContain('box content');
  });

  it('normalizes width configuration and placement props', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new BoxPanelWidget({
      id: 'box-widget-width',
      panel,
      placement: 'bottom-right',
      widthPx: 420
    });

    widget.onRenderHTML(root);

    const section = root.querySelector<HTMLElement>('section');
    expect(widget.placement).toBe('bottom-right');
    expect(section?.style.width).toBe('420px');
  });
});
