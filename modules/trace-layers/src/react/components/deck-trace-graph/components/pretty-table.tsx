import type {ReactNode} from 'react';

export type PrettyTableProps = {
  headers?: (string | ReactNode)[];
  rows: (string | ReactNode)[][];
  stickyHeader?: boolean;
  highlightedColumnIndexes?: number[];
  /** Optional per-column classes applied to both header and value cells. */
  columnClassNames?: string[];
};

/** Renders a compact table suitable for tooltips */
export function PrettyTable(props: PrettyTableProps) {
  const highlightedColumns = new Set(props.highlightedColumnIndexes ?? []);
  const tableClassName = props.stickyHeader
    ? 'min-w-full border-separate border-spacing-0 border border-gray-300 dark:border-gray-600 whitespace-nowrap text-[11px] leading-tight'
    : 'min-w-full border-collapse border border-gray-300 dark:border-gray-600 whitespace-nowrap text-[11px] leading-tight';
  const highlightedColumnClassName = 'bg-slate-100/70 dark:bg-slate-200/10 font-extrabold';

  return (
    <small>
      <table className={tableClassName}>
        {props.headers && (
          <thead>
            <tr>
              {props.headers.map((header, index) => (
                <th
                  key={`header-cell-${index}`}
                  className={`px-1 py-0.5 text-left text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400 ${
                    highlightedColumns.has(index) ? highlightedColumnClassName : ''
                  } ${
                    props.stickyHeader
                      ? 'sticky top-0 z-20 border-b border-gray-300 dark:border-gray-600'
                      : ''
                  } ${props.columnClassNames?.[index] ?? ''}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {props.rows.map((fields, index) => (
            <tr
              key={`row-${index}`}
              className="odd:bg-white odd:dark:bg-gray-800 even:bg-gray-50 even:dark:bg-gray-700"
            >
              {fields.map((field, fieldIndex) => (
                <td
                  key={`row-cell-${index}-${fieldIndex}`}
                  className={`px-1 py-0.5 text-left ${
                    highlightedColumns.has(fieldIndex) ? highlightedColumnClassName : ''
                  } ${props.columnClassNames?.[fieldIndex] ?? ''}`}
                >
                  {field}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </small>
  );
}
