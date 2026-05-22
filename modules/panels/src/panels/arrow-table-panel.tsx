/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useMemo} from 'preact/hooks';

import {useEffectivePanelThemeMode} from './panel-containers';
import {
  createArrowTablePreview,
  formatArrowColumnCount,
  formatArrowRowCount,
  type ArrowTableColumnFormatters,
  type ArrowTableInput
} from './arrow-preview-utils';

import type {Panel, PanelTheme} from './panel-containers';
import type {JSX} from 'preact';

export type {
  ArrowCellFormatContext,
  ArrowTableColumnFormatters,
  ArrowTableFieldLike,
  ArrowTableInput,
  ArrowTableLike,
  ArrowTableSchemaLike,
  ArrowTableVectorLike,
  ArrowTableWrapperLike
} from './arrow-preview-utils';

/** Props for {@link ArrowTablePanel}. */
export type ArrowTablePanelProps = {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Arrow table to display. Accepts Apache Arrow Table-like objects and loaders.gl wrappers. */
  table?: ArrowTableInput;
  /** Maximum rows to render in the DOM at once. Defaults to `1000`. */
  maxRows?: number;
  /** Maximum columns to render in the DOM at once. Defaults to all columns. */
  maxColumns?: number;
  /** Whether to render the absolute row index as the first column. Defaults to `false`. */
  showRowIndex?: boolean;
  /** Record batch to render, or `'all'` to render the full table. Defaults to `'all'`. */
  batchIndex?: number | 'all';
  /** Maximum entries shown inside list-like or vector cell values. Defaults to `8`. */
  maxNestedItems?: number;
  /** Optional cell formatters keyed by dot-notation field path or field name. */
  columnFormatters?: ArrowTableColumnFormatters;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

/** Panel that renders an Arrow table in a scrollable grid preview. */
export class ArrowTablePanel implements Panel {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
  /** Rendered Preact content for this panel. */
  content: JSX.Element;

  /** Creates an Arrow table preview panel. */
  constructor(props: ArrowTablePanelProps) {
    this.id = props.id;
    this.title = props.title;
    this.theme = props.theme ?? 'inherit';
    this.content = <ArrowTablePanelContent {...props} />;
  }
}

/** Renders the table preview used by {@link ArrowTablePanel}. */
function ArrowTablePanelContent({
  table,
  title,
  maxRows = 1000,
  maxColumns,
  showRowIndex,
  batchIndex,
  maxNestedItems,
  columnFormatters,
  className
}: ArrowTablePanelProps): JSX.Element {
  const themeMode = useEffectivePanelThemeMode();
  const preview = useMemo(
    () =>
      createArrowTablePreview({
        table,
        maxRows,
        maxColumns,
        showRowIndex,
        batchIndex,
        maxNestedItems,
        columnFormatters
      }),
    [batchIndex, columnFormatters, maxColumns, maxNestedItems, maxRows, showRowIndex, table]
  );
  const colors =
    themeMode === 'dark'
      ? {
          text: '#f8fafc',
          muted: 'rgba(226, 232, 240, 0.78)',
          background: 'rgba(15, 23, 42, 0.26)',
          divider: 'rgba(148, 163, 184, 0.22)',
          header: 'rgba(15, 23, 42, 0.48)'
        }
      : {
          text: '#0f172a',
          muted: 'rgba(15, 23, 42, 0.72)',
          background: 'rgba(248, 250, 252, 0.82)',
          divider: 'rgba(15, 23, 42, 0.12)',
          header: 'rgba(241, 245, 249, 0.9)'
        };

  return (
    <div
      className={className}
      style={{
        ...ARROW_TABLE_PANEL_STYLE,
        color: colors.text,
        background: colors.background
      }}
      data-arrow-table-panel=""
    >
      <div style={{...ARROW_TABLE_TITLE_STYLE, color: colors.text}} data-arrow-table-title="">
        {`${title} (${preview.numRows.toLocaleString()} rows)`}
      </div>
      <div style={ARROW_TABLE_SCROLL_STYLE}>
        <table style={{...ARROW_TABLE_STYLE, borderColor: colors.divider}}>
          <thead>
            <tr>
              {preview.fields.map(field => (
                <th
                  key={field.key}
                  style={{
                    ...ARROW_TABLE_HEADER_CELL_STYLE,
                    color: colors.muted,
                    background: colors.header,
                    borderColor: colors.divider
                  }}
                >
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map(row => (
              <tr key={row.key}>
                {row.cells.map(cell => (
                  <td
                    key={cell.key}
                    style={{
                      ...ARROW_TABLE_CELL_STYLE,
                      borderColor: colors.divider
                    }}
                  >
                    {cell.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{...ARROW_TABLE_SUMMARY_STYLE, color: colors.muted}} data-arrow-table-summary="">
        {[
          `${formatArrowRowCount(preview.rowsToRender)} included`,
          `${formatArrowRowCount(preview.omittedRows)} omitted`,
          preview.omittedColumns > 0
            ? `${formatArrowColumnCount(preview.omittedColumns)} omitted`
            : '',
          preview.batchLabel || ''
        ]
          .filter(Boolean)
          .join(', ')}
      </div>
    </div>
  );
}

const ARROW_TABLE_PANEL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: '6px',
  padding: '10px 12px',
  font: '500 12px/1.45 ui-sans-serif,system-ui,sans-serif'
};

const ARROW_TABLE_TITLE_STYLE: JSX.CSSProperties = {
  font: '700 12px/1.45 ui-sans-serif,system-ui,sans-serif',
  marginBottom: '8px'
};

const ARROW_TABLE_SCROLL_STYLE: JSX.CSSProperties = {
  maxHeight: '360px',
  overflow: 'auto'
};

const ARROW_TABLE_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: 'max-content',
  borderCollapse: 'collapse',
  borderStyle: 'solid',
  borderWidth: '1px',
  fontVariantNumeric: 'tabular-nums'
};

const ARROW_TABLE_HEADER_CELL_STYLE: JSX.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  borderStyle: 'solid',
  borderWidth: '0 1px 1px 0',
  padding: '6px 8px',
  textAlign: 'left',
  font: '700 11px/1.4 ui-sans-serif,system-ui,sans-serif',
  whiteSpace: 'nowrap'
};

const ARROW_TABLE_CELL_STYLE: JSX.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 1px 1px 0',
  padding: '5px 8px',
  maxWidth: '240px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '500 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace'
};

const ARROW_TABLE_SUMMARY_STYLE: JSX.CSSProperties = {
  marginTop: '8px',
  font: '600 11px/1.4 ui-sans-serif,system-ui,sans-serif'
};
