/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {ArrowTablePanel} from './arrow-table-panel';

import type {ArrowTableFieldLike, ArrowTableInput, ArrowTableLike} from './arrow-table-panel';

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

  it('accepts loaders.gl arrow-table wrappers and limits rendered columns', () => {
    const table = createTable({name: ['Alice'], count: [1], hidden: ['omitted']});
    const root = renderPanel(
      {shape: 'arrow-table', data: table},
      {maxColumns: 2, showRowIndex: true}
    );

    expect(root.textContent).toContain('#');
    expect(root.textContent).toContain('name');
    expect(root.textContent).toContain('count');
    expect(root.textContent).not.toContain('hidden');
    expect(root.textContent).toContain('1 column omitted');
  });

  it('renders selected record batches with absolute row indexes', () => {
    const table = createBatchedTable([{name: ['first', 'second']}, {name: ['third', 'fourth']}]);
    const root = renderPanel(table, {batchIndex: 1, showRowIndex: true});

    expect(root.textContent).toContain('Arrow Table (2 rows)');
    expect(root.textContent).toContain('batch 1');
    expect(root.textContent).not.toContain('first');
    expect(root.textContent).toContain('third');
    expect(root.textContent).toContain('2');
  });

  it('renders nested struct fields with dot notation', () => {
    const root = renderPanel({
      numRows: 1,
      schema: {
        fields: [
          {
            name: 'position',
            type: {
              toString: () => 'Struct',
              children: [{name: 'x'}, {name: 'y'}]
            }
          }
        ]
      },
      getChildAt: () => ({
        getChildAt: childIndex => ({
          get: () => (childIndex === 0 ? 12 : 34)
        })
      })
    });

    expect(root.textContent).toContain('position.x');
    expect(root.textContent).toContain('position.y');
    expect(root.textContent).toContain('12');
    expect(root.textContent).toContain('34');
  });

  it('formats luma-supported Arrow column patterns', () => {
    const root = renderPanel(
      createTable(
        {
          scalar: [1n],
          position: [new Float32Array([1.5, 2.25])],
          matrix: [new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1])],
          timestamp: [new Date('2026-05-22T08:00:00.000Z')],
          label: ['station'],
          path: [
            [
              [1, 2],
              [3, 4],
              [5, 6]
            ]
          ]
        },
        {
          position: {
            type: {
              toString: () => 'FixedSizeList<Float32>[2]',
              listSize: 2,
              children: [{name: 'value', type: 'Float32'}]
            }
          },
          matrix: {
            type: {
              toString: () => 'FixedSizeList<Float32>[16]',
              listSize: 16,
              children: [
                {
                  name: 'value',
                  type: 'Float32',
                  metadata: new Map([
                    ['luma.gl:matrix-shape', 'mat4x4'],
                    ['luma.gl:matrix-order', 'column-major'],
                    ['luma.gl:matrix-layout', 'packed']
                  ])
                }
              ]
            }
          },
          timestamp: {
            type: 'TimestampMillisecond',
            metadata: new Map([
              ['luma.gl:temporal-kind', 'timestamp'],
              ['luma.gl:temporal-unit', 'ms']
            ])
          },
          label: {type: 'Dictionary<Utf8, Int32>'},
          path: {
            type: {
              toString: () => 'List<FixedSizeList<Float32>[2]>',
              children: [
                {
                  name: 'item',
                  type: {
                    toString: () => 'FixedSizeList<Float32>[2]',
                    listSize: 2,
                    children: [{name: 'value', type: 'Float32'}]
                  }
                }
              ]
            }
          }
        }
      ),
      {maxNestedItems: 2}
    );

    expect(root.textContent).toContain('1');
    expect(root.textContent).toContain('[1.5, 2.25]');
    expect(root.textContent).toContain('mat4x4');
    expect(root.textContent).toContain('2026-05-22T08:00:00.000Z');
    expect(root.textContent).toContain('station');
    expect(root.textContent).toContain('... +1');
  });

  it('uses column formatters keyed by field path', () => {
    const root = renderPanel(createTable({value: [10]}), {
      columnFormatters: {
        value: value => `formatted:${String(value)}`
      }
    });

    expect(root.textContent).toContain('formatted:10');
  });

  it('renders an empty table when no table is supplied', () => {
    const root = renderPanel(null);

    expect(root.textContent).toContain('Arrow Table (0 rows)');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});

function renderPanel(
  table: ArrowTableInput,
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

function createTable(
  columns: Record<string, unknown[]>,
  fieldOverrides: Record<string, Partial<ArrowTableFieldLike>> = {}
): ArrowTableLike {
  const entries = Object.entries(columns);
  return {
    numRows: entries[0]?.[1].length ?? 0,
    schema: {
      fields: entries.map(([name]) => ({name, ...fieldOverrides[name]}))
    },
    getChildAt: columnIndex => {
      const values = entries[columnIndex]?.[1];
      return values ? {get: rowIndex => values[rowIndex]} : null;
    }
  };
}

function createBatchedTable(batches: Record<string, unknown[]>[]): ArrowTableLike {
  const fieldNames = Object.keys(batches[0] ?? {});
  const schema = {
    fields: fieldNames.map(name => ({name}))
  };
  const rowCount = batches.reduce(
    (count, batch) => count + (Object.values(batch)[0]?.length ?? 0),
    0
  );

  return {
    numRows: rowCount,
    schema,
    batches: batches.map(batch => ({
      numRows: Object.values(batch)[0]?.length ?? 0,
      schema,
      getChildAt: columnIndex => {
        const values = batch[fieldNames[columnIndex]];
        return values ? {get: rowIndex => values[rowIndex]} : null;
      }
    })),
    getChildAt: columnIndex => {
      const values = batches.flatMap(batch => batch[fieldNames[columnIndex]] ?? []);
      return {get: rowIndex => values[rowIndex]};
    }
  };
}
