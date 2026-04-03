/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';
import {Stats} from '@probe.gl/stats';

import {StatsWidgetPanel} from './stats-widget-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StatsWidgetPanel', () => {
  it('renders provided stats and labels', () => {
    const stats = new Stats({
      id: 'tileset-stats',
      stats: [{name: 'Visible Tiles'}, {name: 'Tiles In Cache'}]
    });
    stats.get('Visible Tiles').addCount(12);
    stats.get('Tiles In Cache').addCount(34);

    const panel = new StatsWidgetPanel({
      id: 'stats-panel',
      title: 'Stats',
      stats,
      statNames: ['Visible Tiles', 'Tiles In Cache'],
      labels: {
        'Visible Tiles': 'Visible tiles across views',
        'Tiles In Cache': 'Total tiles in cache'
      }
    });

    const root = document.createElement('div');
    document.body.appendChild(root);
    render(panel.content, root);

    expect(root.textContent).toContain('Visible tiles across views');
    expect(root.textContent).toContain('12');
    expect(root.textContent).toContain('Total tiles in cache');
    expect(root.textContent).toContain('34');
  });
});
