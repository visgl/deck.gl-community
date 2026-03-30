/** @jsxImportSource preact */
import {useEffect, useMemo, useState} from 'preact/hooks';

import {
  buildInitialCollapsedState,
  clamp,
  getSectionKey,
  mergeCollapsedState,
  normalizeOption,
  resolveSettingValue,
  setValueAtPath
} from '../lib/settings/settings';

import type {
  SettingDescriptor,
  SettingsSchema,
  SettingsSectionDescriptor,
  SettingsState,
  SettingValue
} from '../lib/settings/settings';
import type {WidgetPanel, WidgetPanelTheme} from './widget-containers';
import type {JSX} from 'preact';

type SettingsWidgetPanelChangeHandler = (
  settings: SettingsState,
  changedSettings?: Array<{
    name: string;
    previousValue: unknown;
    nextValue: unknown;
    descriptor?: SettingDescriptor;
  }>
) => void;

/** Settings panel configuration for sidebar/modal container composition. */
export type SettingsWidgetPanelProps = {
  /** Stable panel id used by parent containers. */
  id?: string;
  /** Fallback title used when the schema does not provide one. */
  label?: string;
  /** Descriptor schema rendered by the settings panel. */
  schema?: SettingsSchema;
  /** Current settings values shown and edited by the panel. */
  settings?: SettingsState;
  /** Called when a setting value changes. */
  onSettingsChange?: SettingsWidgetPanelChangeHandler;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
};

const SECTION_TOGGLE_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: 0,
  margin: 0,
  padding: '8px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '12px'
};

const SECTION_CONTENT_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '8px 12px 12px 18px'
};

const SECTION_PANEL_CONTENT_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '10px 12px 12px'
};

const SETTING_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) minmax(200px, 1.4fr)',
  alignItems: 'center',
  gap: '8px'
};

const SETTING_LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--button-text, currentColor)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

const SETTING_CONTROL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center'
};

const INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
  backgroundColor: 'var(--button-background, #fff)',
  backdropFilter: 'var(--button-backdrop-filter, unset)',
  color: 'var(--button-text, currentColor)',
  fontSize: '12px',
  padding: '4px 6px',
  boxSizing: 'border-box'
};

const STRING_CONTROL_STYLE: JSX.CSSProperties = {
  ...INPUT_STYLE,
  flex: 1
};

const STRING_APPLY_BUTTON_STYLE: JSX.CSSProperties = {
  border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
  backgroundColor: 'var(--button-background, #fff)',
  color: 'var(--button-text, currentColor)',
  fontSize: '11px',
  padding: '4px 8px',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

const RANGE_INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: '120px',
  margin: 0
};

const NUMBER_INPUT_STYLE: JSX.CSSProperties = {
  ...INPUT_STYLE,
  width: '84px',
  flexShrink: 0
};

const CHECKBOX_STYLE: JSX.CSSProperties = {
  width: '14px',
  height: '14px',
  margin: 0,
  accentColor: 'var(--button-icon-hover, currentColor)'
};

function stopPropagation(event: Event) {
  event.stopPropagation();
}

function stopPropagationForInput(event: Event) {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation?.();
  }
}

type SettingsControlProps = {
  setting: SettingDescriptor;
  value: SettingValue;
  onValueChange: (nextValue: SettingValue) => void;
};

type StringSettingControlProps = {
  inputId: string;
  label: string;
  value: string;
  onApply: (nextValue: string) => void;
};

function StringSettingControl({inputId, label, value, onApply}: StringSettingControlProps) {
  const [pendingValue, setPendingValue] = useState(value);
  const [recentValues, setRecentValues] = useState<string[]>(() => (value ? [value] : []));

  const isDirty = pendingValue !== value;

  useEffect(() => {
    setPendingValue(value);
  }, [value]);

  useEffect(() => {
    if (!value) {
      return;
    }
    setRecentValues((previous) =>
      previous.includes(value) ? previous : [value, ...previous].slice(0, 8)
    );
  }, [value]);

  const handlePendingTextChange: JSX.GenericEventHandler<HTMLInputElement> = (event) => {
    setPendingValue(event.currentTarget.value);
  };

  const applyPendingText = () => {
    if (pendingValue === value) {
      return;
    }
    onApply(pendingValue);
    setRecentValues((previous) =>
      [pendingValue, ...previous.filter((entry) => entry !== pendingValue)].slice(0, 8)
    );
  };

  const handleTextCommit = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPendingText();
    }
    stopPropagationForInput(event);
  };

  return (
    <div style={SETTING_CONTROL_STYLE}>
      <input
        id={inputId}
        type="text"
        value={pendingValue}
        onInput={handlePendingTextChange}
        list={`${inputId}-recent-values`}
        onKeyDown={handleTextCommit}
        onKeyUp={stopPropagationForInput}
        onPointerDown={stopPropagationForInput}
        aria-label={label}
        style={STRING_CONTROL_STYLE}
      />
      {recentValues.length > 0 && (
        <datalist id={`${inputId}-recent-values`}>
          {recentValues.map((recentValue) => (
            <option key={`${inputId}-${recentValue}`} value={recentValue} />
          ))}
        </datalist>
      )}
      <button
        type="button"
        disabled={!isDirty}
        style={{
          ...STRING_APPLY_BUTTON_STYLE,
          opacity: isDirty ? 1 : 0.55,
          cursor: isDirty ? 'pointer' : 'default',
          marginLeft: '6px'
        }}
        onClick={applyPendingText}
        onPointerDown={stopPropagationForInput}
        onKeyDown={stopPropagationForInput}
        onKeyUp={stopPropagationForInput}
      >
        {isDirty ? '✓' : '✅'}
      </button>
    </div>
  );
}

// eslint-disable-next-line complexity
function SettingsControl({setting, value, onValueChange}: SettingsControlProps) {
  const label = setting.label ?? setting.name;
  const tooltip = setting.description?.trim();
  const inputId = `settings-widget-input-${setting.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const handleBooleanChange: JSX.GenericEventHandler<HTMLInputElement> = (event) => {
    onValueChange(event.currentTarget.checked);
  };

  const handleNumberChange = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) {
      return;
    }
    onValueChange(clamp(nextValue, setting.min, setting.max));
  };

  const handleSelectChange: JSX.GenericEventHandler<HTMLSelectElement> = (event) => {
    const selectedRaw = event.currentTarget.value;
    const selectedValue = (setting.options ?? []).map(normalizeOption).find((option) => {
      return String(option.value) === selectedRaw;
    });
    onValueChange(selectedValue ? selectedValue.value : selectedRaw);
  };

  let control: JSX.Element;

  if (setting.type === 'boolean') {
    control = (
      <input
        id={inputId}
        type="checkbox"
        checked={Boolean(value)}
        onInput={handleBooleanChange}
        onChange={handleBooleanChange}
        aria-label={label}
        style={CHECKBOX_STYLE}
      />
    );
  } else if (setting.type === 'number') {
    const numericValue = Number(value);
    const showRange = Number.isFinite(setting.min) && Number.isFinite(setting.max);

    control = showRange ? (
      <div style={{display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%'}}>
        <input
          id={inputId}
          type="range"
          min={String(setting.min)}
          max={String(setting.max)}
          step={String(setting.step ?? 1)}
          value={String(numericValue)}
          onInput={(event) => handleNumberChange(Number(event.currentTarget.value))}
          onChange={(event) => handleNumberChange(Number(event.currentTarget.value))}
          aria-label={label}
          style={RANGE_INPUT_STYLE}
        />
        <input
          type="number"
          min={Number.isFinite(setting.min) ? String(setting.min) : undefined}
          max={Number.isFinite(setting.max) ? String(setting.max) : undefined}
          step={String(setting.step ?? 1)}
          value={String(numericValue)}
          onInput={(event) => handleNumberChange(Number(event.currentTarget.value))}
          onChange={(event) => handleNumberChange(Number(event.currentTarget.value))}
          aria-label={`${label} numeric value`}
          style={NUMBER_INPUT_STYLE}
        />
      </div>
    ) : (
      <input
        id={inputId}
        type="number"
        step={String(setting.step ?? 1)}
        value={String(numericValue)}
        onInput={(event) => handleNumberChange(Number(event.currentTarget.value))}
        onChange={(event) => handleNumberChange(Number(event.currentTarget.value))}
        aria-label={label}
        style={INPUT_STYLE}
      />
    );
  } else if (setting.type === 'select') {
    const normalizedOptions = (setting.options ?? []).map(normalizeOption);

    control = (
      <select
        id={inputId}
        value={String(value)}
        onInput={handleSelectChange}
        onChange={handleSelectChange}
        onPointerDown={stopPropagationForInput}
        onKeyDown={stopPropagationForInput}
        onKeyUp={stopPropagationForInput}
        aria-label={label}
        style={INPUT_STYLE}
      >
        {normalizedOptions.map((option, index) => (
          <option
            key={`${setting.name}-${index}-${String(option.value)}`}
            value={String(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <StringSettingControl
        inputId={inputId}
        label={label}
        value={String(value)}
        onApply={onValueChange}
      />
    );
  }

  return (
    <div data-setting-row-for={setting.name} style={SETTING_ROW_STYLE} title={tooltip}>
      <label htmlFor={inputId} style={SETTING_LABEL_STYLE}>
        {label}
      </label>
      <div style={SETTING_CONTROL_STYLE}>{control}</div>
    </div>
  );
}

type SettingsPanelContentProps = {
  schema: SettingsSchema;
  settings: SettingsState;
  onSettingsChange?: SettingsWidgetPanelChangeHandler;
};

type SettingsSectionBodyProps = {
  contentStyle: JSX.CSSProperties;
  onValueChange: (path: string, nextValue: SettingValue) => void;
  section: SettingsSectionDescriptor;
  settings: SettingsState;
};

type SettingsSectionPanelContentProps = {
  onSettingsChange?: SettingsWidgetPanelChangeHandler;
  section: SettingsSectionDescriptor;
  settings: SettingsState;
};

/**
 * Renders the controls for one settings schema section without section heading chrome.
 */
function SettingsSectionBody({
  contentStyle,
  onValueChange,
  section,
  settings
}: SettingsSectionBodyProps) {
  return (
    <div style={contentStyle}>
      {section.settings.map((setting) => (
        <SettingsControl
          key={setting.name}
          setting={setting}
          value={resolveSettingValue(setting, settings)}
          onValueChange={(nextValue) => onValueChange(setting.name, nextValue)}
        />
      ))}
    </div>
  );
}

/**
 * Renders one settings schema section as direct panel content for generic widget containers.
 */
function SettingsSectionPanelContent({
  onSettingsChange,
  section,
  settings
}: SettingsSectionPanelContentProps) {
  const [localSettings, setLocalSettings] = useState<SettingsState>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const updateSetting = (path: string, nextValue: SettingValue) => {
    setLocalSettings((previous) => {
      const nextSettings = setValueAtPath(previous, path, nextValue);
      onSettingsChange?.(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div
      style={{overflowY: 'auto', paddingBottom: '8px'}}
      onPointerMove={(event) => stopPropagation(event as unknown as Event)}
      onMouseMove={(event) => stopPropagation(event as unknown as Event)}
      onPointerDown={(event) => stopPropagation(event as unknown as Event)}
      onMouseDown={(event) => stopPropagation(event as unknown as Event)}
      onWheel={(event) => stopPropagation(event as unknown as Event)}
      onClick={(event) => stopPropagation(event as unknown as Event)}
    >
      <SettingsSectionBody
        contentStyle={SECTION_PANEL_CONTENT_STYLE}
        onValueChange={updateSetting}
        section={section}
        settings={localSettings}
      />
    </div>
  );
}

const DEFAULT_SETTINGS_PANEL_SCHEMA: SettingsSchema = {sections: []};
const DEFAULT_SETTINGS_PANEL_STATE: SettingsState = {};

/**
 * Shared settings body used by both the legacy popover widget and panel-based containers.
 */
function SettingsPanelContent({schema, settings, onSettingsChange}: SettingsPanelContentProps) {
  const [localSettings, setLocalSettings] = useState<SettingsState>(settings);
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(() =>
    buildInitialCollapsedState(schema.sections)
  );

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setCollapsedState((previous) => mergeCollapsedState(previous, schema.sections));
  }, [schema.sections]);

  const sectionEntries = useMemo(
    () =>
      schema.sections.map((section, index) => ({
        key: getSectionKey(section, index),
        section
      })),
    [schema.sections]
  );

  const updateSetting = (path: string, nextValue: SettingValue) => {
    setLocalSettings((previous) => {
      const nextSettings = setValueAtPath(previous, path, nextValue);
      onSettingsChange?.(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div
      style={{overflowY: 'auto', paddingBottom: '8px'}}
      onPointerMove={(event) => stopPropagation(event as unknown as Event)}
      onMouseMove={(event) => stopPropagation(event as unknown as Event)}
      onPointerDown={(event) => stopPropagation(event as unknown as Event)}
      onMouseDown={(event) => stopPropagation(event as unknown as Event)}
      onWheel={(event) => stopPropagation(event as unknown as Event)}
      onClick={(event) => stopPropagation(event as unknown as Event)}
    >
      {sectionEntries.map(({key, section}) => {
        const isCollapsed = collapsedState[key] ?? false;
        return (
          <div
            key={key}
            style={{
              borderBottom: '1px solid var(--menu-item-hover, rgba(128, 128, 128, 0.22))'
            }}
          >
            <button
              type="button"
              style={SECTION_TOGGLE_STYLE}
              onClick={() =>
                setCollapsedState((previous) => ({
                  ...previous,
                  [key]: !isCollapsed
                }))
              }
              aria-expanded={!isCollapsed}
            >
              <span style={{display: 'grid', gap: '2px', textAlign: 'left'}}>
                <span style={{fontWeight: 700, fontSize: '12px'}}>{section.name}</span>
                {section.description && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--button-icon-idle, currentColor)'
                    }}
                  >
                    {section.description}
                  </span>
                )}
              </span>
              <span aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
            </button>

            {!isCollapsed && (
              <SettingsSectionBody
                contentStyle={SECTION_CONTENT_STYLE}
                onValueChange={updateSetting}
                section={section}
                settings={localSettings}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A reusable settings panel that can be mounted inside modal and sidebar widget containers.
 */
export class SettingsWidgetPanel implements WidgetPanel {
  id: string;
  title: string;
  theme?: WidgetPanelTheme;
  content: JSX.Element;

  /**
   * Creates one widget panel per top-level settings schema section for generic composition.
   */
  static createSectionPanels({
    label = 'Settings',
    schema = DEFAULT_SETTINGS_PANEL_SCHEMA,
    settings = DEFAULT_SETTINGS_PANEL_STATE,
    onSettingsChange,
    theme = 'inherit'
  }: Omit<SettingsWidgetPanelProps, 'id'>): Record<string, WidgetPanel> {
    return schema.sections.reduce<Record<string, WidgetPanel>>((panels, section, index) => {
      const panelId = getSectionKey(section, index);

      panels[panelId] = {
        id: panelId,
        title: section.name || label,
        theme,
        content: (
          <SettingsSectionPanelContent
            onSettingsChange={onSettingsChange}
            section={section}
            settings={settings}
          />
        )
      };

      return panels;
    }, {});
  }

  constructor({
    id = 'settings-panel',
    label = 'Settings',
    schema = DEFAULT_SETTINGS_PANEL_SCHEMA,
    settings = DEFAULT_SETTINGS_PANEL_STATE,
    onSettingsChange,
    theme = 'inherit'
  }: SettingsWidgetPanelProps = {}) {
    this.id = id;
    this.title = schema.title ?? label;
    this.theme = theme;
    this.content = (
      <SettingsPanelContent
        schema={schema}
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    );
  }
}
