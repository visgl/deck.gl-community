/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {ArrowBatchesPanel} from './arrow-batches-panel';

import type {ArrowTableLike} from './arrow-table-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ArrowBatchesPanel', () => {
  it('creates a panel with the expected id, title, theme, and content', () => {
    const panel = new ArrowBatchesPanel({
      id: 'arrow-batches',
      title: 'Arrow Batches',
      table: createBatchedTable([2]),
      theme: 'dark'
    });

    expect(panel.id).toBe('arrow-batches');
    expect(panel.title).toBe('Arrow Batches');
    expect(panel.theme).toBe('dark');
    expect(panel.content).toBeDefined();
  });

  it('renders a single-batch table', () => {
    const root = renderPanel(createBatchedTable([3]));

    expect(root.textContent).toContain('Arrow Batches (1 batch)');
    expect(root.textContent).toContain('0');
    expect(root.textContent).toContain('3');
    expect(root.textContent).toContain('0-2');
    expect(root.textContent).toContain('2');
    expect(root.textContent).toContain('3 rows total');
  });

  it('renders multi-batch cumulative row ranges', () => {
    const root = renderPanel(createBatchedTable([2, 4, 1]));
    const rows = root.querySelectorAll('[data-arrow-batch-row]');

    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('0-1');
    expect(rows[1].textContent).toContain('2-5');
    expect(rows[2].textContent).toContain('6-6');
    expect(root.textContent).toContain('7 rows total');
  });

  it('renders an empty table without batch rows', () => {
    const root = renderPanel({numRows: 0, schema: {fields: []}, batches: []});

    expect(root.textContent).toContain('Arrow Batches (0 batches)');
    expect(root.querySelectorAll('[data-arrow-batch-row]')).toHaveLength(0);
    expect(root.textContent).toContain('0 rows total');
  });

  it('marks the selected batch', () => {
    const root = renderPanel(createBatchedTable([1, 2]), {selectedBatchIndex: 1});

    expect(root.querySelectorAll('[data-arrow-batch-selected]')).toHaveLength(1);
    expect(root.querySelector('[data-arrow-batch-selected]')?.textContent).toContain('1');
  });

  it('notifies when a batch is selected', () => {
    const onBatchSelect = vi.fn();
    const root = renderPanel(createBatchedTable([1, 2]), {onBatchSelect});

    root.querySelectorAll<HTMLElement>('[data-arrow-batch-row]')[1].click();

    expect(onBatchSelect).toHaveBeenCalledWith(1);
  });

  it('accepts loaders.gl arrow-table wrappers', () => {
    const table = createBatchedTable([1, 1]);
    const root = renderPanel({shape: 'arrow-table', data: table});

    expect(root.textContent).toContain('Arrow Batches (2 batches)');
  });
});

function renderPanel(
  table: ConstructorParameters<typeof ArrowBatchesPanel>[0]['table'],
  props: Partial<ConstructorParameters<typeof ArrowBatchesPanel>[0]> = {}
): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    new ArrowBatchesPanel({
      id: 'arrow-batches',
      title: 'Arrow Batches',
      table,
      ...props
    }).content,
    root
  );
  return root;
}

function createBatchedTable(rowCounts: number[]): ArrowTableLike {
  const schema = {
    fields: [{name: 'x'}, {name: 'y'}]
  };

  return {
    numRows: rowCounts.reduce((total, rowCount) => total + rowCount, 0),
    schema,
    batches: rowCounts.map(rowCount => ({
      numRows: rowCount,
      numCols: schema.fields.length,
      schema
    }))
  };
}
