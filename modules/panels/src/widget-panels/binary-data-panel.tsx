/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useMemo} from 'preact/hooks';

import {useEffectiveWidgetPanelThemeMode} from './widget-containers';

import type {WidgetPanel, WidgetPanelTheme} from './widget-containers';
import type {JSX} from 'preact';

/** Default byte count rendered on each hex preview row. */
const DEFAULT_ROW_BYTE_LENGTH = 8;
/** Default preview cap used to avoid rendering very large binary files in full. */
const DEFAULT_MAX_BYTE_LENGTH = 10_000;

/**
 * Props for {@link BinaryDataPanel}.
 *
 * `byteOffset` and `byteLength` first select the source range from `data`.
 * `maxByteLength` then caps how many selected bytes are rendered.
 */
export type BinaryDataPanelProps = {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Binary data rendered by this panel as offset, hex, and optional ASCII rows. */
  data: ArrayBuffer | ArrayBufferView;
  /** Byte offset, relative to `data`, where the preview starts. Defaults to `0`. */
  byteOffset?: number;
  /** Maximum source byte length, before preview limiting, to include from `data`. Defaults to all remaining bytes. */
  byteLength?: number;
  /** Number of bytes rendered per row. Defaults to `8`. */
  rowByteLength?: number;
  /** Maximum number of bytes rendered before omitting the remainder. Defaults to `10_000`. */
  maxByteLength?: number;
  /** If `true`, show printable ASCII characters below each byte. Defaults to `true`. */
  showAscii?: boolean;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
};

/** Widget panel that renders binary data as offset, hex, and ASCII rows. */
export class BinaryDataPanel implements WidgetPanel {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
  /** Rendered Preact content for this panel. */
  content: JSX.Element;

  /** Creates a binary data panel for caller-supplied bytes. */
  constructor(props: BinaryDataPanelProps) {
    this.id = props.id;
    this.title = props.title;
    this.theme = props.theme ?? 'inherit';
    this.content = <BinaryDataPanelContent {...props} />;
  }
}

type BinaryPreview = {
  /** Source range selected from the input bytes before preview limiting. */
  sourceBytes: Uint8Array;
  /** Rendered prefix of `sourceBytes` after applying `maxByteLength`. */
  previewBytes: Uint8Array;
  /** Effective input offset shown in the first rendered row. */
  byteOffset: number;
  /** Effective row width after clamping invalid values to at least one byte. */
  rowByteLength: number;
};

/** Renders the byte preview used by {@link BinaryDataPanel}. */
function BinaryDataPanelContent({
  data,
  byteOffset = 0,
  byteLength,
  rowByteLength = DEFAULT_ROW_BYTE_LENGTH,
  maxByteLength = DEFAULT_MAX_BYTE_LENGTH,
  showAscii = true,
  className
}: BinaryDataPanelProps): JSX.Element {
  const themeMode = useEffectiveWidgetPanelThemeMode();
  const preview = useMemo(
    () => createBinaryPreview(data, byteOffset, byteLength, rowByteLength, maxByteLength),
    [byteLength, byteOffset, data, maxByteLength, rowByteLength]
  );
  const colors =
    themeMode === 'dark'
      ? {
          text: '#f8fafc',
          muted: 'rgba(226, 232, 240, 0.78)',
          background: 'rgba(15, 23, 42, 0.26)',
          divider: 'rgba(148, 163, 184, 0.22)'
        }
      : {
          text: '#0f172a',
          muted: 'rgba(15, 23, 42, 0.72)',
          background: 'rgba(248, 250, 252, 0.82)',
          divider: 'rgba(15, 23, 42, 0.12)'
        };

  return (
    <div
      className={className}
      style={{
        ...BINARY_PANEL_STYLE,
        color: colors.text,
        background: colors.background
      }}
      data-binary-data-panel=""
    >
      <div
        style={{
          ...BINARY_HEADER_STYLE,
          color: colors.muted,
          borderBottom: `1px solid ${colors.divider}`
        }}
      >
        <span>Offset</span>
        <span>{showAscii ? 'ASCII / Hex bytes' : 'Hex bytes'}</span>
      </div>
      {Array.from(
        {length: Math.ceil(preview.previewBytes.length / preview.rowByteLength)},
        (_row, rowIndex) => {
          const offset = rowIndex * preview.rowByteLength;
          const row = preview.previewBytes.subarray(offset, offset + preview.rowByteLength);
          return (
            <div key={offset} style={BINARY_ROW_STYLE} data-binary-data-row="">
              <span style={{...BINARY_OFFSET_STYLE, color: colors.muted}}>
                {(preview.byteOffset + offset).toString(16).padStart(4, '0')}
              </span>
              <span
                style={{
                  ...BINARY_BYTES_STYLE,
                  gridTemplateColumns: `repeat(${preview.rowByteLength}, 2.25rem)`
                }}
              >
                {Array.from(row, (byte, index) => (
                  <span key={`${offset}-${index}`} style={BINARY_BYTE_STYLE}>
                    <span style={BINARY_HEX_STYLE}>{byte.toString(16).padStart(2, '0')}</span>
                    {showAscii ? (
                      <span
                        style={{...BINARY_ASCII_STYLE, color: colors.muted}}
                        data-binary-ascii-byte={byte}
                      >
                        {getAsciiPreviewCharacter(byte)}
                      </span>
                    ) : null}
                  </span>
                ))}
              </span>
            </div>
          );
        }
      )}
      <div style={{...BINARY_SUMMARY_STYLE, color: colors.muted}} data-binary-byte-summary="">
        {formatByteCount(preview.previewBytes.length)} included,{' '}
        {formatByteCount(preview.sourceBytes.length - preview.previewBytes.length)} omitted
      </div>
    </div>
  );
}

/** Normalizes caller input into the bounded byte ranges rendered by the panel. */
function createBinaryPreview(
  data: ArrayBuffer | ArrayBufferView,
  byteOffset: number,
  byteLength: number | undefined,
  rowByteLength: number,
  maxByteLength: number
): BinaryPreview {
  const bytes = toUint8Array(data);
  const start = clampInteger(byteOffset, 0, bytes.byteLength);
  const sourceLength = clampInteger(
    byteLength ?? bytes.byteLength - start,
    0,
    bytes.byteLength - start
  );
  const sourceBytes = bytes.subarray(start, start + sourceLength);
  const previewLength = clampInteger(maxByteLength, 0, sourceBytes.byteLength);

  return {
    sourceBytes,
    previewBytes: sourceBytes.subarray(0, previewLength),
    byteOffset: start,
    rowByteLength: Math.max(1, Math.floor(rowByteLength))
  };
}

/** Returns a byte view over the supplied input without copying its full contents. */
function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Clamps a possibly fractional numeric prop to an integer range. */
function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Returns the display character for one byte in the binary preview. */
function getAsciiPreviewCharacter(byte: number): string {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '';
}

/** Formats byte counts for the bottom summary. */
function formatByteCount(byteLength: number): string {
  return `${byteLength.toLocaleString()} ${byteLength === 1 ? 'byte' : 'bytes'}`;
}

const BINARY_PANEL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  overflow: 'auto',
  borderRadius: '6px',
  padding: '10px 12px',
  font: '700 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace'
};

const BINARY_HEADER_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '4.5rem 1fr',
  gap: '12px',
  paddingBottom: '7px',
  marginBottom: '8px',
  font: '700 11px/1.4 ui-sans-serif,system-ui,sans-serif',
  textTransform: 'uppercase'
};

const BINARY_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '4.5rem 1fr',
  gap: '12px',
  alignItems: 'start',
  marginBottom: '5px'
};

const BINARY_OFFSET_STYLE: JSX.CSSProperties = {
  minWidth: 0
};

const BINARY_BYTES_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '6px 7px',
  overflowX: 'auto'
};

const BINARY_BYTE_STYLE: JSX.CSSProperties = {
  display: 'inline-grid',
  width: '2.25rem',
  minWidth: '2.25rem',
  justifyItems: 'center',
  textAlign: 'center'
};

const BINARY_HEX_STYLE: JSX.CSSProperties = {
  lineHeight: 1.25
};

const BINARY_ASCII_STYLE: JSX.CSSProperties = {
  minHeight: '0.9rem',
  font: '700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace'
};

const BINARY_SUMMARY_STYLE: JSX.CSSProperties = {
  marginTop: '10px',
  font: '600 12px/1.4 ui-sans-serif,system-ui,sans-serif'
};
