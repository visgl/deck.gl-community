/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {ArrowTablePanel} from './arrow-table-panel';

import type {ArrowTableLike} from './arrow-table-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ArrowTablePanel', () => {
  it('creates a panel with the expected id, title, theme, and content', () => {
    const panel = new ArrowTablePanel({
      id: 'arrow-table',
      title: 'Arrow Table',
      table: createTable({name: ['Alice']}),
      theme: 'dark'
    });

    expect(panel.id).toBe('arrow-table');
    expect(panel.title).toBe('Arrow Table');
    expect(panel.theme).toBe('dark');
    expect(panel.content).toBeDefined();
  });

  it('renders column names and cell values', () => {
    const root = renderPanel(createTable({name: ['Alice', 'Bob'], count: [1, 2]}));

    expect(root.textContent).toContain('Arrow Table (2 rows)');
    expect(root.textContent).toContain('name');
    expect(root.textContent).toContain('count');
    expect(root.textContent).toContain('Alice');
    expect(root.textContent).toContain('2');
  });

  it('limits rendered rows', () => {
    const root = renderPanel(createTable({value: ['first', 'second', 'third']}), {maxRows: 2});

    expect(root.textContent).toContain('2 rows included, 1 row omitted');
    expect(root.textContent).toContain('first');
    expect(root.textContent).toContain('second');
    expect(root.textContent).not.toContain('third');
  });

  it('formats complex cell values', () => {
    const root = renderPanel(
      createTable({
        bigint: [1n],
        vector: [{toArray: () => [1, 2]}],
        bigintVector: [{toArray: () => [1n, 2n]}],
        bigintObject: [{id: 1n}],
        object: [{nested: true}],
        empty: [null]
      })
    );

    expect(root.textContent).toContain('1');
    expect(root.textContent).toContain('[1,2]');
    expect(root.textContent).toContain('["1","2"]');
    expect(root.textContent).toContain('{"id":"1"}');
    expect(root.textContent).toContain('{"nested":true}');
  });

  it('renders an empty table when no table is supplied', () => {
    const root = renderPanel(null);

    expect(root.textContent).toContain('Arrow Table (0 rows)');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});

function renderPanel(
  table: ArrowTableLike | null,
  props: Partial<ConstructorParameters<typeof ArrowTablePanel>[0]> = {}
): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    new ArrowTablePanel({
      id: 'arrow-table',
      title: 'Arrow Table',
      table,
      ...props
    }).content,
    root
  );
  return root;
}

function createTable(columns: Record<string, unknown[]>): ArrowTableLike {
  const entries = Object.entries(columns);
  return {
    numRows: entries[0]?.[1].length ?? 0,
    schema: {
      fields: entries.map(([name]) => ({name}))
    },
    getChildAt: columnIndex => {
      const values = entries[columnIndex]?.[1];
      return values ? {get: rowIndex => values[rowIndex]} : null;
    }
  };
}
