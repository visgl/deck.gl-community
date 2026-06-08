/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {FullScreenPanelContainer} from './full-screen-panel-container';
import {Panel} from '../panels/panel';

class TestPanel extends Panel {}

const panel = new TestPanel({
  id: 'full-screen-panel',
  title: 'Full Screen Panel',
  content: <div>full screen content</div>
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FullScreenPanelContainer', () => {
  it('renders title and direct panel content', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new FullScreenPanelContainer({
      id: 'full-screen-panel-container-basic',
      title: 'Panels',
      panel
    });

    container.onRenderHTML(root);

    expect(root.textContent).toContain('Panels');
    expect(root.textContent).toContain('full screen content');
  });

  it('uses fill placement and normalizes margin', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new FullScreenPanelContainer({
      id: 'full-screen-panel-container-margin',
      panel,
      marginPx: 36
    });

    container.onRenderHTML(root);

    const section = root.querySelector<HTMLElement>('section');
    expect(container.placement).toBe('fill');
    expect(section?.style.inset).toBe('36px');
  });
});
