/** @jsxImportSource preact */
import {useState} from 'preact/hooks';
import {Panel} from '../../panels/panel';
import type {JSX} from 'preact';
import type {PanelTheme} from '../../panels/panel';

/** A named source URL offered by a source picker. */
export type SourcePickerPreset = {
  /** Unique option identifier. */
  id: string;
  /** Visible option label. */
  label: string;
  /** URL copied into the URL field when selected. */
  url: string;
};

/** Configuration for a source picker that delegates loading to its host. */
export type SourcePickerPanelProps = {
  /** Stable panel identifier. */
  id: string;
  /** Visible panel title. */
  title: string;
  /** Named source URLs; source discovery remains the host's responsibility. */
  presets?: ReadonlyArray<SourcePickerPreset>;
  /** Controlled URL field value. */
  url?: string;
  /** Initial URL when the field is uncontrolled. */
  defaultUrl?: string;
  /** Called when the URL field or selected preset changes. */
  onUrlChange?: (url: string) => void;
  /** Called when the user submits a nonempty URL. No fetch is performed by the panel. */
  onLoadUrl: (url: string) => void;
  /** Enables file selection and dropping; files are passed through without reading. */
  onSelectFiles?: (files: ReadonlyArray<File>) => void;
  /** File input accept hint. Hosts validate file types themselves. */
  accept?: string;
  /** Whether file selection permits more than one file. Defaults to false. */
  multiple?: boolean;
  /** Disables source controls, for example while the host loads a source. */
  disabled?: boolean;
  /** Optional panel theme override. */
  theme?: PanelTheme;
};

/** URL, preset, and local-file controls independent of any loader or catalog. */
export class SourcePickerPanel extends Panel {
  /** Creates a source picker whose callbacks are owned by its host. */
  constructor(props: SourcePickerPanelProps) {
    super({
      id: props.id,
      title: props.title,
      theme: props.theme,
      content: <SourcePickerContent {...props} />
    });
  }
}

/** Renders source controls while keeping uncontrolled URL state local. */
function SourcePickerContent({
  id,
  presets = [],
  url,
  defaultUrl = '',
  onUrlChange,
  onLoadUrl,
  onSelectFiles,
  accept,
  multiple = false,
  disabled = false
}: SourcePickerPanelProps) {
  const [localUrl, setLocalUrl] = useState(defaultUrl);
  const currentUrl = url ?? localUrl;
  const isLoadDisabled = disabled || !currentUrl.trim();
  const selectedPreset = presets.find(preset => preset.url === currentUrl)?.id ?? '';
  /** Updates the field and notifies the host without starting a load. */
  function changeUrl(nextUrl: string): void {
    if (url === undefined) setLocalUrl(nextUrl);
    onUrlChange?.(nextUrl);
  }
  /** Passes selected files to the host, respecting the selection limit. */
  function selectFiles(files: FileList | null): void {
    if (disabled || !files?.length) return;
    onSelectFiles?.(Array.from(files).slice(0, multiple ? files.length : 1));
  }
  return (
    <div
      style={{display: 'grid', gap: '8px'}}
      onDragOver={event => {
        if (onSelectFiles && !disabled && event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
        }
      }}
      onDrop={event => {
        if (onSelectFiles && event.dataTransfer?.files.length) {
          event.preventDefault();
          selectFiles(event.dataTransfer?.files ?? null);
        }
      }}
    >
      {presets.length > 0 ? (
        <label>
          Preset
          <select
            style={getSourceControlStyle(disabled)}
            aria-label="Preset"
            value={selectedPreset}
            disabled={disabled}
            onChange={event => {
              const preset = presets.find(candidate => candidate.id === event.currentTarget.value);
              if (preset) changeUrl(preset.url);
            }}
          >
            <option value="">Custom URL</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <form
        style={{display: 'grid', gap: '8px'}}
        onSubmit={event => {
          event.preventDefault();
          if (!disabled && currentUrl.trim()) onLoadUrl(currentUrl.trim());
        }}
      >
        <label htmlFor={`${id}-url`}>Source URL</label>
        <input
          id={`${id}-url`}
          style={getSourceControlStyle(disabled)}
          type="url"
          required
          value={currentUrl}
          disabled={disabled}
          onInput={event => changeUrl(event.currentTarget.value)}
        />
        <button
          style={getSourceControlStyle(isLoadDisabled)}
          type="submit"
          disabled={isLoadDisabled}
        >
          Load URL
        </button>
      </form>
      {onSelectFiles ? (
        <label>
          Choose files or drop them here
          <input
            style={getSourceControlStyle(disabled)}
            aria-label="Choose files"
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            onChange={event => {
              selectFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

/** Shared theme-aware appearance for native source controls. */
const SOURCE_CONTROL_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
  backgroundColor: 'var(--button-background, #fff)',
  color: 'var(--button-text, currentColor)',
  fontSize: '12px',
  padding: '4px 6px',
  boxSizing: 'border-box'
};

/** Preserves theme colors while making unavailable native controls visibly disabled. */
function getSourceControlStyle(isDisabled: boolean): JSX.CSSProperties {
  return {
    ...SOURCE_CONTROL_STYLE,
    opacity: isDisabled ? 0.5 : 1,
    cursor: isDisabled ? 'not-allowed' : undefined
  };
}
