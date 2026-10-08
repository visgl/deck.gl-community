/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, expect, test} from 'vitest';
import {MetricsPanel} from './metrics-panel';
let root: HTMLDivElement;
afterEach(() => {
  if (root) render(null, root);
  document.body.innerHTML = '';
});
/** Mounts a telemetry snapshot for DOM assertions. */
function mountPanel(panel: MetricsPanel): void {
  root = document.createElement('div');
  document.body.append(root);
  render(panel.content, root);
}

test('renders scalar values and missing values without interpreting HTML', () => {
  mountPanel(
    new MetricsPanel({
      id: 'metrics',
      title: 'Telemetry',
      metrics: {release: '<img src=x>', rows: 0, cached: false, absent: null, unknown: undefined}
    })
  );
  expect(Array.from(root.querySelectorAll('dd'), element => element.textContent)).toEqual([
    '<img src=x>',
    '0',
    'false',
    '—',
    '—'
  ]);
  expect(root.querySelector('img')).toBeNull();
});

test('orders a subset, labels metrics, formats units, and renders replacement snapshots', () => {
  mountPanel(
    new MetricsPanel({
      id: 'metrics',
      title: 'Telemetry',
      metrics: {bytes: 2048, rows: 3},
      metricNames: ['rows', 'missing', 'bytes'],
      labels: {bytes: 'Bytes read'},
      formatValue: (value, name) =>
        name === 'bytes' ? `${Number(value) / 1024} KiB` : String(value)
    })
  );
  expect(Array.from(root.querySelectorAll('dt'), element => element.textContent)).toEqual([
    'rows',
    'Bytes read'
  ]);
  expect(Array.from(root.querySelectorAll('dd'), element => element.textContent)).toEqual([
    '3',
    '2 KiB'
  ]);
  render(
    new MetricsPanel({id: 'metrics', title: 'Telemetry', metrics: {elapsed: 42}}).content,
    root
  );
  expect(root.textContent).toBe('elapsed42');
});
