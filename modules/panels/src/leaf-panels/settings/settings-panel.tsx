/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';

import {
  buildInitialCollapsedState,
  clamp,
  getSectionKey,
  mergeCollapsedState,
  normalizeOption,
  resolveSettingValue,
  setValueAtPath
} from '../../lib/settings/settings';
import {SelectComponent} from '../../preact/select-component';

import type {
  SettingDescriptor,
  SettingsSchema,
  SettingsSectionDescriptor,
  SettingsState,
  SettingValue
} from '../../lib/settings/settings';
import {Panel} from '../../panels/panel';

import type {PanelTheme} from '../../panels/panel';
import type {JSX} from 'preact';

type SettingsPanelChangeHandler = (
  settings: SettingsState,
  changedSettings?: Array<{
    name: string;
    previousValue: unknown;
    nextValue: unknown;
    descriptor?: SettingDescriptor;
  }>
) => void;

/** CSS font-size value accepted by settings panel controls. */
export type SettingsPanelFontSize = number | string;

/** Settings panel configuration for sidebar/modal container composition. */
export type SettingsPanelProps = {
  /** Stable panel id used by parent containers. */
  id?: string;
  /** Fallback title used when the schema does not provide one. */
  label?: string;
  /** Descriptor schema rendered by the settings panel. */
  schema?: SettingsSchema;
  /** Current settings values shown and edited by the panel. */
  settings?: SettingsState;
  /** Called when a setting value changes. */
  onSettingsChange?: SettingsPanelChangeHandler;
  /** Optional text size used by setting labels and text, number, and select controls. */
  fontSize?: SettingsPanelFontSize;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
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
  flexShrink: 0,
  height: '28px',
  lineHeight: '16px',
  padding: '2px 6px'
};

const CHECKBOX_STYLE: JSX.CSSProperties = {
  width: '14px',
  height: '14px',
  margin: 0,
  accentColor: 'var(--button-icon-hover, currentColor)'
};

function withFontSize(
  style: JSX.CSSProperties,
  fontSize: SettingsPanelFontSize | undefined
): JSX.CSSProperties {
  return fontSize === undefined ? style : {...style, fontSize};
}

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
  fontSize?: SettingsPanelFontSize;
  setting: SettingDescriptor;
  value: SettingValue;
  onValueChange: (nextValue: SettingValue) => void;
};

type StringSettingControlProps = {
  fontSize?: SettingsPanelFontSize;
  inputId: string;
  label: string;
  value: string;
  onApply: (nextValue: string) => void;
};

type NumberSettingControlProps = {
  fontSize?: SettingsPanelFontSize;
  inputId: string;
  label: string;
  setting: SettingDescriptor;
  value: number;
  onValueChange: (nextValue: SettingValue) => void;
};

function StringSettingControl({
  fontSize,
  inputId,
  label,
  value,
  onApply
}: StringSettingControlProps) {
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
    setRecentValues(previous =>
      previous.includes(value) ? previous : [value, ...previous].slice(0, 8)
    );
  }, [value]);

  const handlePendingTextChange: JSX.GenericEventHandler<HTMLInputElement> = event => {
    setPendingValue(event.currentTarget.value);
  };

  const applyPendingText = () => {
    if (pendingValue === value) {
      return;
    }
    onApply(pendingValue);
    setRecentValues(previous =>
      [pendingValue, ...previous.filter(entry => entry !== pendingValue)].slice(0, 8)
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
        style={withFontSize(STRING_CONTROL_STYLE, fontSize)}
      />
      {recentValues.length > 0 && (
        <datalist id={`${inputId}-recent-values`}>
          {recentValues.map(recentValue => (
            <option key={`${inputId}-${recentValue}`} value={recentValue} />
          ))}
        </datalist>
      )}
      <button
        type="button"
        disabled={!isDirty}
        style={{
          ...withFontSize(STRING_APPLY_BUTTON_STYLE, fontSize),
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

function NumberSettingControl({
  fontSize,
  inputId,
  label,
  setting,
  value,
  onValueChange
}: NumberSettingControlProps) {
  const showRange = Number.isFinite(setting.min) && Number.isFinite(setting.max);
  const numericValue = clamp(value, setting.min, setting.max);
  const sliderDebounceMs = getSliderDebounceMs(setting);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftValue, setDraftValue] = useState(numericValue);

  useEffect(() => {
    setDraftValue(numericValue);
  }, [numericValue]);

  useEffect(
    () => () => {
      clearPendingSliderChange(debounceTimerRef);
    },
    []
  );

  const commitValue = (nextValue: number): void => {
    if (!Number.isFinite(nextValue)) {
      return;
    }
    const clampedValue = clamp(nextValue, setting.min, setting.max);
    clearPendingSliderChange(debounceTimerRef);
    setDraftValue(clampedValue);
    onValueChange(clampedValue);
  };

  const scheduleSliderValue = (nextValue: number): void => {
    if (!Number.isFinite(nextValue)) {
      return;
    }
    const clampedValue = clamp(nextValue, setting.min, setting.max);
    setDraftValue(clampedValue);
    if (sliderDebounceMs <= 0) {
      onValueChange(clampedValue);
      return;
    }

    clearPendingSliderChange(debounceTimerRef);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      onValueChange(clampedValue);
    }, sliderDebounceMs);
  };

  if (!showRange) {
    return (
      <input
        id={inputId}
        type="number"
        step={String(setting.step ?? 1)}
        value={String(draftValue)}
        onInput={event => commitValue(Number(event.currentTarget.value))}
        onChange={event => commitValue(Number(event.currentTarget.value))}
        aria-label={label}
        style={withFontSize(INPUT_STYLE, fontSize)}
      />
    );
  }

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%'}}>
      <input
        id={inputId}
        type="range"
        min={String(setting.min)}
        max={String(setting.max)}
        step={String(setting.step ?? 1)}
        value={String(draftValue)}
        onInput={event => scheduleSliderValue(Number(event.currentTarget.value))}
        aria-label={label}
        style={RANGE_INPUT_STYLE}
      />
      <input
        type="number"
        min={Number.isFinite(setting.min) ? String(setting.min) : undefined}
        max={Number.isFinite(setting.max) ? String(setting.max) : undefined}
        step={String(setting.step ?? 1)}
        value={String(draftValue)}
        onInput={event => commitValue(Number(event.currentTarget.value))}
        onChange={event => commitValue(Number(event.currentTarget.value))}
        aria-label={`${label} numeric value`}
        style={withFontSize(NUMBER_INPUT_STYLE, fontSize)}
      />
    </div>
  );
}

function getSliderDebounceMs(setting: SettingDescriptor): number {
  if (!Number.isFinite(setting.sliderDebounceMs)) {
    return 0;
  }
  return Math.max(0, setting.sliderDebounceMs as number);
}

function clearPendingSliderChange(timerRef: {current: ReturnType<typeof setTimeout> | null}): void {
  if (timerRef.current == null) {
    return;
  }
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

// eslint-disable-next-line complexity
function SettingsControl({fontSize, setting, value, onValueChange}: SettingsControlProps) {
  const label = setting.label ?? setting.name;
  const tooltip = setting.description?.trim();
  const inputId = `settings-panel-input-${setting.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const handleBooleanChange: JSX.GenericEventHandler<HTMLInputElement> = event => {
    onValueChange(event.currentTarget.checked);
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
    control = (
      <NumberSettingControl
        fontSize={fontSize}
        inputId={inputId}
        label={label}
        setting={setting}
        value={Number(value)}
        onValueChange={onValueChange}
      />
    );
  } else if (setting.type === 'select') {
    const normalizedOptions = (setting.options ?? []).map(normalizeOption);

    control = (
      <SelectComponent
        id={inputId}
        value={value}
        label={label}
        options={normalizedOptions}
        onValueChange={onValueChange}
        fontSize={fontSize}
      />
    );
  } else {
    control = (
      <StringSettingControl
        fontSize={fontSize}
        inputId={inputId}
        label={label}
        value={String(value)}
        onApply={onValueChange}
      />
    );
  }

  return (
    <div data-setting-row-for={setting.name} style={SETTING_ROW_STYLE} title={tooltip}>
      <label
        htmlFor={setting.type === 'select' ? undefined : inputId}
        style={withFontSize(SETTING_LABEL_STYLE, fontSize)}
      >
        {label}
      </label>
      <div style={SETTING_CONTROL_STYLE}>{control}</div>
    </div>
  );
}

type SettingsPanelContentProps = {
  fontSize?: SettingsPanelFontSize;
  schema: SettingsSchema;
  settings: SettingsState;
  onSettingsChange?: SettingsPanelChangeHandler;
};

type SettingsSectionBodyProps = {
  contentStyle: JSX.CSSProperties;
  fontSize?: SettingsPanelFontSize;
  onValueChange: (path: string, nextValue: SettingValue) => void;
  section: SettingsSectionDescriptor;
  settings: SettingsState;
};

type SettingsSectionPanelContentProps = {
  fontSize?: SettingsPanelFontSize;
  onSettingsChange?: SettingsPanelChangeHandler;
  section: SettingsSectionDescriptor;
  settings: SettingsState;
};

/**
 * Renders the controls for one settings schema section without section heading chrome.
 */
function SettingsSectionBody({
  contentStyle,
  fontSize,
  onValueChange,
  section,
  settings
}: SettingsSectionBodyProps) {
  return (
    <div style={contentStyle}>
      {section.settings.map(setting => (
        <SettingsControl
          key={setting.name}
          fontSize={fontSize}
          setting={setting}
          value={resolveSettingValue(setting, settings)}
          onValueChange={nextValue => onValueChange(setting.name, nextValue)}
        />
      ))}
    </div>
  );
}

/**
 * Renders one settings schema section as direct panel content for composite panel renderers.
 */
function SettingsSectionPanelContent({
  fontSize,
  onSettingsChange,
  section,
  settings
}: SettingsSectionPanelContentProps) {
  const [localSettings, setLocalSettings] = useState<SettingsState>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const updateSetting = (path: string, nextValue: SettingValue) => {
    setLocalSettings(previous => {
      const nextSettings = setValueAtPath(previous, path, nextValue);
      onSettingsChange?.(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div
      style={{overflowY: 'auto', paddingBottom: '8px'}}
      onPointerMove={event => stopPropagation(event as unknown as Event)}
      onMouseMove={event => stopPropagation(event as unknown as Event)}
      onPointerDown={event => stopPropagation(event as unknown as Event)}
      onMouseDown={event => stopPropagation(event as unknown as Event)}
      onWheel={event => stopPropagation(event as unknown as Event)}
      onClick={event => stopPropagation(event as unknown as Event)}
    >
      <SettingsSectionBody
        contentStyle={SECTION_PANEL_CONTENT_STYLE}
        fontSize={fontSize}
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
 * Shared settings body used by schema-driven settings UIs and panel containers.
 */
export function SettingsPanelContent({
  fontSize,
  schema,
  settings,
  onSettingsChange
}: SettingsPanelContentProps) {
  const [localSettings, setLocalSettings] = useState<SettingsState>(settings);
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(() =>
    buildInitialCollapsedState(schema.sections)
  );

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setCollapsedState(previous => mergeCollapsedState(previous, schema.sections));
  }, [schema.sections]);

  const sectionEntries = useMemo(
    () =>
      schema.sections.map((section, index) => ({
        key: getSectionKey(section, index),
        section
      })),
    [schema.sections]
  );
  const renderInlineSingleSection =
    sectionEntries.length === 1 &&
    !sectionEntries[0].section.name &&
    !sectionEntries[0].section.description;

  const updateSetting = (path: string, nextValue: SettingValue) => {
    setLocalSettings(previous => {
      const nextSettings = setValueAtPath(previous, path, nextValue);
      onSettingsChange?.(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div
      style={{overflowY: 'auto', paddingBottom: '8px'}}
      onPointerMove={event => stopPropagation(event as unknown as Event)}
      onMouseMove={event => stopPropagation(event as unknown as Event)}
      onPointerDown={event => stopPropagation(event as unknown as Event)}
      onMouseDown={event => stopPropagation(event as unknown as Event)}
      onWheel={event => stopPropagation(event as unknown as Event)}
      onClick={event => stopPropagation(event as unknown as Event)}
    >
      {renderInlineSingleSection ? (
        <SettingsSectionBody
          contentStyle={SECTION_CONTENT_STYLE}
          fontSize={fontSize}
          onValueChange={updateSetting}
          section={sectionEntries[0].section}
          settings={localSettings}
        />
      ) : (
        sectionEntries.map(({key, section}) => {
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
                  setCollapsedState(previous => ({
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
                  fontSize={fontSize}
                  onValueChange={updateSetting}
                  section={section}
                  settings={localSettings}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * A reusable settings panel that can be mounted inside modal and sidebar panel containers.
 */
export class SettingsPanel extends Panel {
  /**
   * Creates one panel per top-level settings schema section for generic composition.
   */
  static createSectionPanels({
    label = 'Settings',
    schema = DEFAULT_SETTINGS_PANEL_SCHEMA,
    settings = DEFAULT_SETTINGS_PANEL_STATE,
    onSettingsChange,
    fontSize,
    theme = 'inherit'
  }: Omit<SettingsPanelProps, 'id'>): Panel[] {
    return schema.sections.map((section, index) => {
      const panelId = getSectionKey(section, index);
      return new SettingsSectionPanel({
        id: panelId,
        title: section.name || label,
        theme,
        content: (
          <SettingsSectionPanelContent
            fontSize={fontSize}
            onSettingsChange={onSettingsChange}
            section={section}
            settings={settings}
          />
        )
      });
    });
  }

  constructor({
    id = 'settings-panel',
    label = 'Settings',
    schema = DEFAULT_SETTINGS_PANEL_SCHEMA,
    settings = DEFAULT_SETTINGS_PANEL_STATE,
    onSettingsChange,
    fontSize,
    theme = 'inherit'
  }: SettingsPanelProps = {}) {
    super({
      id,
      title: schema.title ?? label,
      theme,
      content: (
        <SettingsPanelContent
          fontSize={fontSize}
          schema={schema}
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
      )
    });
  }
}

class SettingsSectionPanel extends Panel {}
