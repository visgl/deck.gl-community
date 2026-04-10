/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {FullScreenPanelWidget} from './full-screen-panel-widget';

import type {WidgetPanel} from './widget-containers';

const panel: WidgetPanel = {
  id: 'full-screen-panel',
  title: 'Full Screen Panel',
  content: <div>full screen content</div>
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FullScreenPanelWidget', () => {
  it('renders title and direct panel content', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new FullScreenPanelWidget({
      id: 'full-screen-panel-widget-basic',
      title: 'Widget Panels',
      panel
    });

    widget.onRenderHTML(root);

    expect(root.textContent).toContain('Widget Panels');
    expect(root.textContent).toContain('full screen content');
  });

  it('uses fill placement and normalizes margin', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new FullScreenPanelWidget({
      id: 'full-screen-panel-widget-margin',
      panel,
      marginPx: 36
    });

    widget.onRenderHTML(root);

    const section = root.querySelector<HTMLElement>('section');
    expect(widget.placement).toBe('fill');
    expect(section?.style.inset).toBe('36px');
  });
});
