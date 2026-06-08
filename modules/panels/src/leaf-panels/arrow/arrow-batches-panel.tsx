/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useMemo} from 'preact/hooks';

import {createArrowBatchPreview, type ArrowTableInput} from './arrow-preview-utils';
import {Panel} from '../../panels/panel';
import {useEffectivePanelThemeMode} from '../../panels/panel-theme-scope';

import type {PanelTheme} from '../../panels/panel';
import type {JSX} from 'preact';

export type {
  ArrowBatchPreview,
  ArrowBatchPreviewRow,
  ArrowRecordBatchLike
} from './arrow-preview-utils';

/** Props for {@link ArrowBatchesPanel}. */
export type ArrowBatchesPanelProps = {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Arrow table to inspect. Accepts Apache Arrow Table-like objects and loaders.gl wrappers. */
  table?: ArrowTableInput;
  /** Batch index to visually mark as selected. */
  selectedBatchIndex?: number;
  /** Called when the user selects a batch row. */
  onBatchSelect?: (batchIndex: number) => void;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

/** Panel that renders one summary row per Arrow record batch. */
export class ArrowBatchesPanel extends Panel {
  /** Creates an Arrow record batch inspection panel. */
  constructor(props: ArrowBatchesPanelProps) {
    super({
      id: props.id,
      title: props.title,
      theme: props.theme ?? 'inherit',
      content: <ArrowBatchesPanelContent {...props} />
    });
  }
}

/** Renders the record batch table used by {@link ArrowBatchesPanel}. */
function ArrowBatchesPanelContent({
  table,
  title,
  selectedBatchIndex,
  onBatchSelect,
  className
}: ArrowBatchesPanelProps): JSX.Element {
  const themeMode = useEffectivePanelThemeMode();
  const preview = useMemo(
    () => createArrowBatchPreview(table, selectedBatchIndex),
    [selectedBatchIndex, table]
  );
  const colors =
    themeMode === 'dark'
      ? {
          text: '#f8fafc',
          muted: 'rgba(226, 232, 240, 0.78)',
          background: 'rgba(15, 23, 42, 0.26)',
          divider: 'rgba(148, 163, 184, 0.22)',
          header: 'rgba(15, 23, 42, 0.48)',
          selected: 'rgba(59, 130, 246, 0.22)'
        }
      : {
          text: '#0f172a',
          muted: 'rgba(15, 23, 42, 0.72)',
          background: 'rgba(248, 250, 252, 0.82)',
          divider: 'rgba(15, 23, 42, 0.12)',
          header: 'rgba(241, 245, 249, 0.9)',
          selected: 'rgba(37, 99, 235, 0.12)'
        };

  return (
    <div
      className={className}
      style={{
        ...ARROW_BATCHES_PANEL_STYLE,
        color: colors.text,
        background: colors.background
      }}
      data-arrow-batches-panel=""
    >
      <div style={{...ARROW_BATCHES_TITLE_STYLE, color: colors.text}} data-arrow-batches-title="">
        {`${title} (${preview.batchCount.toLocaleString()} ${
          preview.batchCount === 1 ? 'batch' : 'batches'
        })`}
      </div>
      <div style={ARROW_BATCHES_SCROLL_STYLE}>
        <table style={{...ARROW_BATCHES_TABLE_STYLE, borderColor: colors.divider}}>
          <thead>
            <tr>
              {['Batch', 'Rows', 'Row range', 'Columns'].map(column => (
                <th
                  key={column}
                  style={{
                    ...ARROW_BATCHES_HEADER_CELL_STYLE,
                    color: colors.muted,
                    background: colors.header,
                    borderColor: colors.divider
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map(row => (
              <tr
                key={row.key}
                onClick={onBatchSelect ? () => onBatchSelect(row.index) : undefined}
                style={{
                  background: row.selected ? colors.selected : 'transparent',
                  cursor: onBatchSelect ? 'pointer' : 'default'
                }}
                data-arrow-batch-row=""
                data-arrow-batch-selected={row.selected ? '' : undefined}
              >
                <td style={{...ARROW_BATCHES_CELL_STYLE, borderColor: colors.divider}}>
                  {row.index}
                </td>
                <td style={{...ARROW_BATCHES_CELL_STYLE, borderColor: colors.divider}}>
                  {row.rowCount.toLocaleString()}
                </td>
                <td style={{...ARROW_BATCHES_CELL_STYLE, borderColor: colors.divider}}>
                  {row.rowRange}
                </td>
                <td style={{...ARROW_BATCHES_CELL_STYLE, borderColor: colors.divider}}>
                  {row.columnCount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{...ARROW_BATCHES_SUMMARY_STYLE, color: colors.muted}}
        data-arrow-batches-summary=""
      >
        {`${preview.rowCount.toLocaleString()} ${preview.rowCount === 1 ? 'row' : 'rows'} total`}
      </div>
    </div>
  );
}

const ARROW_BATCHES_PANEL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: '6px',
  padding: '10px 12px',
  font: '500 12px/1.45 ui-sans-serif,system-ui,sans-serif'
};

const ARROW_BATCHES_TITLE_STYLE: JSX.CSSProperties = {
  font: '700 12px/1.45 ui-sans-serif,system-ui,sans-serif',
  marginBottom: '8px'
};

const ARROW_BATCHES_SCROLL_STYLE: JSX.CSSProperties = {
  overflow: 'auto'
};

const ARROW_BATCHES_TABLE_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: 'max-content',
  borderCollapse: 'collapse',
  borderStyle: 'solid',
  borderWidth: '1px',
  fontVariantNumeric: 'tabular-nums'
};

const ARROW_BATCHES_HEADER_CELL_STYLE: JSX.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 1px 1px 0',
  padding: '6px 8px',
  textAlign: 'left',
  font: '700 11px/1.4 ui-sans-serif,system-ui,sans-serif',
  whiteSpace: 'nowrap'
};

const ARROW_BATCHES_CELL_STYLE: JSX.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 1px 1px 0',
  padding: '5px 8px',
  maxWidth: '240px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '500 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace'
};

const ARROW_BATCHES_SUMMARY_STYLE: JSX.CSSProperties = {
  marginTop: '8px',
  font: '600 11px/1.4 ui-sans-serif,system-ui,sans-serif'
};
