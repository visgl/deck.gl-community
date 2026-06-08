import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it} from 'vitest';

import {PrettyTable} from './pretty-table';

import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderPrettyTable(params?: {
  stickyHeader?: boolean;
  highlightedColumnIndexes?: number[];
  columnClassNames?: string[];
}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <PrettyTable
        headers={['Wait', 'Process']}
        rows={[['10ms', 'rank-0']]}
        stickyHeader={params?.stickyHeader}
        highlightedColumnIndexes={params?.highlightedColumnIndexes}
        columnClassNames={params?.columnClassNames}
      />
    );
  });

  return container;
}

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('PrettyTable', () => {
  it('applies sticky header classes when enabled', () => {
    const rendered = renderPrettyTable({stickyHeader: true});

    const table = rendered.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.className).toContain('border-separate');
    expect(table?.className).toContain('border-spacing-0');
    expect(table?.className).not.toContain('border-collapse');

    const header = rendered.querySelector('thead');
    expect(header).toBeTruthy();
    expect(header?.className).not.toContain('sticky');

    const headerCells = rendered.querySelectorAll('th');
    expect(headerCells).toHaveLength(2);
    for (const headerCell of headerCells) {
      expect(headerCell.className).toContain('sticky');
      expect(headerCell.className).toContain('top-0');
      expect(headerCell.className).toContain('z-20');
      expect(headerCell.className).toContain('text-xs');
      expect(headerCell.className).toContain('uppercase');
      expect(headerCell.className).toContain('bg-gray-50');
      expect(headerCell.className).toContain('dark:bg-gray-700');
      expect(headerCell.className).toContain('dark:text-gray-400');
    }
  });

  it('does not apply sticky header classes by default', () => {
    const rendered = renderPrettyTable();

    const table = rendered.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.className).toContain('border-collapse');
    expect(table?.className).not.toContain('border-separate');

    const header = rendered.querySelector('thead');
    expect(header).toBeTruthy();

    const headerCells = rendered.querySelectorAll('th');
    expect(headerCells).toHaveLength(2);
    for (const headerCell of headerCells) {
      expect(headerCell.className).not.toContain('sticky');
      expect(headerCell.className).not.toContain('top-0');
      expect(headerCell.className).not.toContain('z-20');
    }
  });

  it('highlights the configured column in both headers and values', () => {
    const rendered = renderPrettyTable({highlightedColumnIndexes: [1]});

    const headerCells = rendered.querySelectorAll('th');
    expect(headerCells[0]?.className).not.toContain('font-extrabold');
    expect(headerCells[0]?.className).not.toContain('bg-slate-100/70');
    expect(headerCells[1]?.className).toContain('font-extrabold');
    expect(headerCells[1]?.className).toContain('bg-slate-100/70');

    const valueCells = rendered.querySelectorAll('td');
    expect(valueCells[0]?.className).not.toContain('font-extrabold');
    expect(valueCells[0]?.className).not.toContain('bg-slate-100/70');
    expect(valueCells[1]?.className).toContain('font-extrabold');
    expect(valueCells[1]?.className).toContain('bg-slate-100/70');
  });

  it('applies per-column classes to both headers and values', () => {
    const rendered = renderPrettyTable({columnClassNames: ['w-px whitespace-nowrap', 'w-full']});

    const headerCells = rendered.querySelectorAll('th');
    expect(headerCells[0]?.className).toContain('w-px');
    expect(headerCells[0]?.className).toContain('whitespace-nowrap');
    expect(headerCells[1]?.className).toContain('w-full');

    const valueCells = rendered.querySelectorAll('td');
    expect(valueCells[0]?.className).toContain('w-px');
    expect(valueCells[0]?.className).toContain('whitespace-nowrap');
    expect(valueCells[1]?.className).toContain('w-full');
  });
});
