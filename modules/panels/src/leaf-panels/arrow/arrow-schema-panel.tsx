/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useMemo} from 'preact/hooks';

import {Panel} from '../../panels/panel';
import {useEffectivePanelThemeMode} from '../../panels/panel-theme-scope';
import {
  createArrowSchemaPreview,
  type ArrowMetadataEntry,
  type ArrowSchemaLike
} from './arrow-preview-utils';

import type {PanelTheme} from '../../panels/panel';
import type {JSX} from 'preact';

export type {ArrowMetadataLike, ArrowSchemaFieldLike, ArrowSchemaLike} from './arrow-preview-utils';
export type {ArrowMetadataEntry};

/** Props for {@link ArrowSchemaPanel}. */
export type ArrowSchemaPanelProps = {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Schema to display. Accepts Apache Arrow Schema-like objects. */
  schema?: ArrowSchemaLike | null;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

/** Panel that renders an Arrow schema as one table row per field. */
export class ArrowSchemaPanel extends Panel {
  /** Creates an Arrow schema panel. */
  constructor(props: ArrowSchemaPanelProps) {
    super({
      id: props.id,
      title: props.title,
      theme: props.theme ?? 'inherit',
      content: <ArrowSchemaPanelContent {...props} />
    });
  }
}

/** Renders the schema table used by {@link ArrowSchemaPanel}. */
function ArrowSchemaPanelContent({schema, title, className}: ArrowSchemaPanelProps): JSX.Element {
  const themeMode = useEffectivePanelThemeMode();
  const preview = useMemo(() => createArrowSchemaPreview(schema), [schema]);
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
        ...ARROW_SCHEMA_PANEL_STYLE,
        color: colors.text,
        background: colors.background
      }}
      data-arrow-schema-panel=""
    >
      <div style={{...ARROW_SCHEMA_TITLE_STYLE, color: colors.text}} data-arrow-schema-title="">
        {title}
      </div>
      {preview.schemaMetadata.length > 0 ? (
        <section
          style={{...ARROW_SCHEMA_METADATA_SECTION_STYLE, borderColor: colors.divider}}
          data-arrow-schema-metadata=""
        >
          <div style={{...ARROW_SCHEMA_METADATA_TITLE_STYLE, color: colors.muted}}>
            Schema metadata
          </div>
          <MetadataPreview metadata={preview.schemaMetadata} colors={colors} />
        </section>
      ) : null}
      <div style={ARROW_SCHEMA_SCROLL_STYLE}>
        <table style={{...ARROW_SCHEMA_TABLE_STYLE, borderColor: colors.divider}}>
          <thead>
            <tr>
              {['Name', 'Type', 'Nullable', 'Metadata'].map(column => (
                <th
                  key={column}
                  style={{
                    ...ARROW_SCHEMA_HEADER_CELL_STYLE,
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
            {preview.fields.map(field => (
              <tr key={field.key}>
                <td style={{...ARROW_SCHEMA_CELL_STYLE, borderColor: colors.divider}}>
                  {field.name}
                </td>
                <td style={{...ARROW_SCHEMA_CELL_STYLE, borderColor: colors.divider}}>
                  {field.type}
                </td>
                <td style={{...ARROW_SCHEMA_CELL_STYLE, borderColor: colors.divider}}>
                  {field.nullable}
                </td>
                <td
                  style={{
                    ...ARROW_SCHEMA_CELL_STYLE,
                    ...ARROW_SCHEMA_METADATA_CELL_STYLE,
                    borderColor: colors.divider
                  }}
                >
                  <MetadataPreview metadata={field.metadata} colors={colors} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MetadataColors = {
  text: string;
  muted: string;
  divider: string;
};

function MetadataPreview({
  metadata,
  colors
}: {
  metadata: ArrowMetadataEntry[];
  colors: MetadataColors;
}): JSX.Element | null {
  if (metadata.length === 0) {
    return null;
  }

  return (
    <dl style={ARROW_SCHEMA_METADATA_LIST_STYLE}>
      {metadata.map(entry => (
        <div
          key={entry.key}
          style={ARROW_SCHEMA_METADATA_ROW_STYLE}
          data-arrow-luma-metadata={entry.isLumaMetadata ? '' : undefined}
        >
          <dt
            style={{
              ...ARROW_SCHEMA_METADATA_KEY_STYLE,
              color: entry.isLumaMetadata ? '#2563eb' : colors.muted
            }}
          >
            {entry.key}
          </dt>
          <dd style={{...ARROW_SCHEMA_METADATA_VALUE_STYLE, color: colors.text}}>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const ARROW_SCHEMA_PANEL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: '6px',
  padding: '10px 12px',
  font: '500 12px/1.45 ui-sans-serif,system-ui,sans-serif'
};

const ARROW_SCHEMA_TITLE_STYLE: JSX.CSSProperties = {
  font: '700 12px/1.45 ui-sans-serif,system-ui,sans-serif',
  marginBottom: '8px'
};

const ARROW_SCHEMA_SCROLL_STYLE: JSX.CSSProperties = {
  overflow: 'auto'
};

const ARROW_SCHEMA_METADATA_SECTION_STYLE: JSX.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '1px',
  borderRadius: '6px',
  padding: '8px',
  marginBottom: '10px'
};

const ARROW_SCHEMA_METADATA_TITLE_STYLE: JSX.CSSProperties = {
  font: '700 11px/1.4 ui-sans-serif,system-ui,sans-serif',
  textTransform: 'uppercase',
  marginBottom: '6px'
};

const ARROW_SCHEMA_TABLE_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: 'max-content',
  borderCollapse: 'collapse',
  borderStyle: 'solid',
  borderWidth: '1px'
};

const ARROW_SCHEMA_HEADER_CELL_STYLE: JSX.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 1px 1px 0',
  padding: '6px 8px',
  textAlign: 'left',
  font: '700 11px/1.4 ui-sans-serif,system-ui,sans-serif',
  whiteSpace: 'nowrap'
};

const ARROW_SCHEMA_CELL_STYLE: JSX.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 1px 1px 0',
  padding: '5px 8px',
  maxWidth: '260px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '500 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace'
};

const ARROW_SCHEMA_METADATA_CELL_STYLE: JSX.CSSProperties = {
  maxWidth: '360px',
  whiteSpace: 'normal',
  verticalAlign: 'top'
};

const ARROW_SCHEMA_METADATA_LIST_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  margin: 0
};

const ARROW_SCHEMA_METADATA_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(5rem, auto) minmax(0, 1fr)',
  gap: '8px',
  alignItems: 'baseline'
};

const ARROW_SCHEMA_METADATA_KEY_STYLE: JSX.CSSProperties = {
  margin: 0,
  font: '700 11px/1.4 ui-sans-serif,system-ui,sans-serif'
};

const ARROW_SCHEMA_METADATA_VALUE_STYLE: JSX.CSSProperties = {
  margin: 0,
  minWidth: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
};
