/** @jsxRuntime classic */
/** @jsx createElement */
/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

// biome-ignore lint/correctness/noUnusedImports: The classic JSX pragma calls createElement.
import {createElement, type StatelessComponent, type StatelessProps} from 'tsx-create-element';
import {type Legend, type LegendRow, type LegendRowSymbol} from './interfaces';
import {KeyCodes, Table, type TableRow} from './controls';

export interface LegendViewProps {
  legend: Legend;
  onClick: (e: Event, legend: Legend, clickedIndex: number) => void;
}

export const LegendView: StatelessComponent<LegendViewProps> = (
  props: StatelessProps<LegendViewProps>
) => {
  const rows: TableRow[] = [];

  const addRow = (row: LegendRow, i: number) => {
    const fn = symbolMap[row.symbol.shape];
    let jsx: Element;
    if (fn) {
      jsx = fn(row.symbol);
    } else {
      jsx = <span>x</span>;
      // console.log(`need to render ${row.symbol.shape} symbol shape`);
    }
    rows.push({
      cells: [
        {className: 'symbol', content: jsx},
        {className: 'label', content: row.label, title: row.label}
      ]
    });
  };

  const sorted = Object.keys(props.legend.rows).sort((a, b) => Number(a) - Number(b));
  sorted.forEach(i => addRow(props.legend.rows[i], Number(i)));

  if (sorted.length) {
    return (
      <Table
        rows={rows}
        rowClassName="legend-row"
        onRowClick={(e, i) => props.onClick(e, props.legend, i)}
      >
        {props.legend.title !== undefined && (
          <tr
            tabIndex={props.onClick ? 0 : -1}
            onClick={e => props.onClick(e as any as MouseEvent, props.legend, null)}
            onKeyUp={e => {
              if (e.key === KeyCodes.ENTER && props.onClick) {
                props.onClick(e as any as MouseEvent, props.legend, null);
              }
            }}
          >
            <th colSpan={2}>{props.legend.title}</th>
          </tr>
        )}
      </Table>
    );
  }
  return null;
};

const symbolMap: {[shape: string]: (symbol: LegendRowSymbol) => Element} = {
  square(symbol: LegendRowSymbol) {
    return (
      <div
        style={{
          height: `${symbol.bounds.y2 - symbol.bounds.y1}px`,
          width: `${symbol.bounds.x2 - symbol.bounds.x1}px`,
          backgroundColor: symbol.fill,
          borderColor: symbol.fill
        }}
      />
    );
  }
};
