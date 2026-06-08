/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {BoxPanelContainer} from './box-panel-container';
import {Panel} from '../panels/panel';

class TestPanel extends Panel {}

const panel = new TestPanel({
  id: 'box-panel',
  title: 'Box Panel',
  content: <div>box content</div>
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BoxPanelContainer', () => {
  it('renders title and direct panel content', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new BoxPanelContainer({
      id: 'box-panel-container-basic',
      title: 'Panels',
      panel
    });

    container.onRenderHTML(root);

    expect(root.textContent).toContain('Panels');
    expect(root.textContent).toContain('box content');
  });

  it('normalizes width configuration and placement props', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new BoxPanelContainer({
      id: 'box-panel-container-width',
      panel,
      placement: 'bottom-right',
      widthPx: 420
    });

    container.onRenderHTML(root);

    const section = root.querySelector<HTMLElement>('section');
    expect(container.placement).toBe('bottom-right');
    expect(section?.style.width).toBe('420px');
  });
});
